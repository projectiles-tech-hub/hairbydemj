// The two free command-line tools the plan names for media: libvips for
// images and ffmpeg for video. They are run as separate programs, never
// through a shell, with a time limit, and only ever on file names we made up
// ourselves.

import { execFile } from 'node:child_process';
import { open } from 'node:fs/promises';

export class ToolError extends Error {
  override name = 'ToolError';
}

export function run(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
        reject(new ToolError(missing ? `${command} is not installed on this server` : `${command} failed: ${(stderr || error.message).trim().split('\n').slice(-2).join(' ').slice(0, 300)}`));
      } else resolve(stdout);
    });
  });
}

/** True when the tools are installed. Used at start-up and to skip tests where they are missing. */
export async function toolsInstalled(): Promise<{ vips: boolean; ffmpeg: boolean }> {
  const works = (command: string, args: string[]): Promise<boolean> => run(command, args, 10_000).then(() => true, () => false);
  const [thumbnail, header, ffmpeg, ffprobe] = await Promise.all([works('vipsthumbnail', ['--version']), works('vipsheader', ['--version']), works('ffmpeg', ['-version']), works('ffprobe', ['-version'])]);
  return { vips: thumbnail && header, ffmpeg: ffmpeg && ffprobe };
}

export type FileKind = 'jpeg' | 'png' | 'webp' | 'heic' | 'mp4' | 'mov' | 'webm';

/**
 * What a file really is, read from its first bytes. The name and the type
 * the browser claims are never trusted.
 */
export async function sniff(path: string): Promise<FileKind | null> {
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, 16, 0);
    if (bytesRead < 12) return null;
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
    if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP') return 'webp';
    if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return 'webm';
    if (head.toString('latin1', 4, 8) === 'ftyp') {
      const brand = head.toString('latin1', 8, 12);
      if (brand === 'qt  ') return 'mov';
      // The format iPhones save photos in.
      if (['heic', 'heix', 'mif1', 'msf1'].includes(brand)) return 'heic';
      if (['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'M4V ', 'MSNV', 'dash', '3gp4', '3gp5'].includes(brand)) return 'mp4';
    }
    return null;
  } finally {
    await handle.close();
  }
}

export const isImage = (kind: FileKind): boolean => kind === 'jpeg' || kind === 'png' || kind === 'webp' || kind === 'heic';

/** Width and height of an image, without decoding the whole picture. */
export async function imageSize(path: string): Promise<{ width: number; height: number }> {
  const [width, height] = await Promise.all([run('vipsheader', ['-f', 'width', path], 20_000), run('vipsheader', ['-f', 'height', path], 20_000)]);
  const size = { width: Number(width.trim()), height: Number(height.trim()) };
  if (!Number.isInteger(size.width) || !Number.isInteger(size.height) || size.width < 1 || size.height < 1) throw new ToolError('The picture could not be read');
  return size;
}

/**
 * Make one smaller copy of an image, never larger than the original. Phone
 * photos are turned the right way up, and everything hidden inside the file
 * (camera, date, GPS location) is removed.
 */
export async function resizeImage(source: string, target: string, width: number, format: 'webp' | 'jpg'): Promise<void> {
  const options = format === 'webp' ? '[Q=80,strip]' : '[Q=82,strip,optimize_coding,interlace]';
  await run('vipsthumbnail', [source, '-s', `${width}x>`, '-o', `${target}${options}`], 60_000);
}

export interface VideoInfo {
  durationMs: number;
  width: number;
  height: number;
}

export async function videoInfo(path: string): Promise<VideoInfo> {
  const out = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', path], 30_000);
  const data = JSON.parse(out) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } };
  const stream = data.streams?.[0];
  const duration = Number(data.format?.duration);
  if (!stream?.width || !stream.height || !Number.isFinite(duration) || duration <= 0) throw new ToolError('The video could not be read');
  return { durationMs: Math.round(duration * 1000), width: stream.width, height: stream.height };
}

/**
 * Turn any video into one MP4 every phone and browser plays: H.264 picture,
 * AAC sound, at most 1280 pixels on its longer side, arranged so it starts
 * playing before it has fully downloaded. Location and device details are removed.
 */
export async function compressVideo(source: string, target: string): Promise<void> {
  await run(
    'ffmpeg',
    ['-v', 'error', '-y', '-i', source, '-map_metadata', '-1', '-map', '0:v:0', '-map', '0:a:0?',
      '-vf', "scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', '30',
      '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', '-f', 'mp4', target],
    15 * 60_000,
  );
}

/** A still picture from the video, to show before it plays. */
export async function videoPoster(source: string, target: string, atMs: number): Promise<void> {
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', (atMs / 1000).toFixed(2), '-i', source, '-frames:v', '1', '-f', 'image2', '-c:v', 'png', target], 60_000);
}

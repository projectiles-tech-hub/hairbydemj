// Downloads MediaPipe's face model to public/vendor/mediapipe, once, when the
// server is set up (`npm run tryon:model`). The file is checked against the
// checksum below, so only the exact, known model is ever served.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const FACE_MODEL = {
  url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  bytes: 3_758_596,
  path: join('public', 'vendor', 'mediapipe', 'face_landmarker.task'),
};

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

async function main(): Promise<void> {
  try {
    if (sha256(await readFile(FACE_MODEL.path)) === FACE_MODEL.sha256) {
      console.log('The face model is already in place.');
      return;
    }
  } catch {
    // Not there yet.
  }
  console.log(`Downloading the face model from ${FACE_MODEL.url}`);
  const res = await fetch(FACE_MODEL.url);
  if (!res.ok) throw new Error(`The download failed (${res.status}).`);
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length !== FACE_MODEL.bytes || sha256(data) !== FACE_MODEL.sha256) throw new Error('The downloaded file is not the expected model. Nothing was saved.');
  await mkdir(join('public', 'vendor', 'mediapipe'), { recursive: true });
  await writeFile(FACE_MODEL.path, data);
  console.log(`Saved ${FACE_MODEL.path}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

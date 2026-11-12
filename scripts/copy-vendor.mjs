// Copies MediaPipe's browser files from node_modules into public/vendor so the
// try-on is served from our own server (docs/try-on.md). Run by `npm run build`.
import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const from = 'node_modules/@mediapipe/tasks-vision';
const to = 'public/vendor/mediapipe';
if (!existsSync(from)) {
  console.log('MediaPipe is not installed (npm ci); the try-on page will not work until it is.');
  process.exit(0);
}
await mkdir(join(to, 'wasm'), { recursive: true });
await copyFile(join(from, 'vision_bundle.mjs'), join(to, 'vision_bundle.mjs'));
// The SIMD build for current browsers, and the plain build for older ones.
for (const name of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  await copyFile(join(from, 'wasm', name), join(to, 'wasm', name));
}

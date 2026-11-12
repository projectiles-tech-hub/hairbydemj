// One-off check (see .github/workflows/try-on-probe.yml): loads MediaPipe from
// public/vendor in Chromium and finds the temples on a public-domain portrait.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const types = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.html': 'text/html' };
const page = `<!doctype html><html><body><canvas id="c" width="640" height="640"></canvas><script type="module">
const v = await import('/vendor/mediapipe/vision_bundle.mjs');
const files = await v.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
const lm = await v.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: '/vendor/mediapipe/face_landmarker.task', delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 1 });
const img = new Image(); img.src = '/face.jpg'; await img.decode();
const r = lm.detect(img);
const f = r.faceLandmarks[0];
window.result = f ? { count: f.length, t162: f[162], t389: f[389] } : { count: 0 };
</script></body></html>`;
const server = createServer(async (req, res) => {
  try {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); return; }
    if (req.url === '/face.jpg') {
      const r = await fetch('https://commons.wikimedia.org/wiki/Special:FilePath/President_Barack_Obama.jpg?width=640', { headers: { 'user-agent': 'hairbydemj-ci-check/1.0' } });
      res.writeHead(200, { 'content-type': 'image/jpeg' }); res.end(Buffer.from(await r.arrayBuffer())); return;
    }
    const file = await readFile(join('public', req.url));
    res.writeHead(200, { 'content-type': types[extname(req.url)] ?? 'application/octet-stream' }); res.end(file);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(8123, r));
const browser = await chromium.launch();
const p = await browser.newPage();
p.on('console', (m) => console.log('browser:', m.text()));
await p.goto('http://localhost:8123/');
await p.waitForFunction(() => window.result, null, { timeout: 120000 });
const result = await p.evaluate(() => window.result);
console.log(JSON.stringify(result));
await browser.close();
server.close();
if (!result.count) process.exit(1);

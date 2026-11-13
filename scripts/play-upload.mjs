// Uploads an Android App Bundle to Google Play (module 21), straight over
// Google's Play Developer API; no extra tools. Used by
// .github/workflows/app-release.yml:
//   node scripts/play-upload.mjs <file.aab> <track> <status>
// track: internal (testers), production; status: completed or draft.
// A production upload is left as a draft, so the owner presses "Release"
// in the Play Console on launch day, together with the website and iPhone app.
// Needs PLAY_SERVICE_ACCOUNT_JSON (the Google Cloud service account's key,
// invited in the Play Console with release rights). The very first upload of
// a new app must be made by hand in the Play Console; Google requires it.

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PACKAGE = 'com.hairbydemj.hairbydemj';
const API = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const UPLOAD = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}`;

const [file, track = 'internal', status = 'completed'] = process.argv.slice(2);
if (!file) throw new Error('usage: node scripts/play-upload.mjs <file.aab> <track> <status>');
if (!['completed', 'draft'].includes(status)) throw new Error('status must be completed or draft');
const account = JSON.parse(process.env.PLAY_SERVICE_ACCOUNT_JSON ?? '');

const b64 = (value) => Buffer.from(value).toString('base64url');

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: account.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const unsigned = `${b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64(JSON.stringify(claims))}`;
  const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`Google sign-in failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

const token = await accessToken();
async function call(method, url, body, type = 'application/json') {
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': type } : {}) }, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url.replace(API, '').replace(UPLOAD, '')}: ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

const edit = await call('POST', `${API}/edits`, '{}');
const bundle = await call('POST', `${UPLOAD}/edits/${edit.id}/bundles?uploadType=media`, readFileSync(file), 'application/octet-stream');
console.log(`Uploaded version code ${bundle.versionCode}`);
await call('PUT', `${API}/edits/${edit.id}/tracks/${track}`, JSON.stringify({ track, releases: [{ versionCodes: [String(bundle.versionCode)], status }] }));
await call('POST', `${API}/edits/${edit.id}:commit`);
console.log(`On the ${track} track as ${status}.`);

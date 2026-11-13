// Tests for the operations tools: the alert email, the database health
// check, and the server scripts in deploy/bin (run for real with bash, with
// stand-ins for systemctl and rclone, in throwaway folders).

import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { accountDeps, type AccountDeps } from '../accounts/deps.js';
import { memoryMailer } from '../accounts/mailer.js';
import { createIdentityVerifier, PROVIDER_DEFAULTS } from '../accounts/oidc.js';
import { createApp } from '../app.js';
import { ConfigError, loadConfig } from '../config.js';
import { migrate } from '../db/migrate.js';
import { createPool, type Db } from '../db/pool.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../db/test-database.js';
import { createLogger } from '../logger.js';
import { alertAddress, alertEmail } from './alert.js';

const REPO = resolve(import.meta.dirname, '..', '..', '..');
const BIN = join(REPO, 'deploy', 'bin');
const skipDb = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

interface Run {
  code: number;
  out: string;
}

function run(script: string, args: string[], env: Record<string, string>): Promise<Run> {
  return new Promise((done) => {
    execFile('bash', [join(BIN, script), ...args], { env: { ...process.env, ...env }, timeout: 60_000 }, (error, stdout, stderr) => {
      done({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` });
    });
  });
}

function deps(db: Db): AccountDeps {
  return accountDeps({
    db,
    config: loadConfig({}),
    mail: memoryMailer(),
    identity: createIdentityVerifier({ google: { ...PROVIDER_DEFAULTS.google, clientIds: [] }, apple: { ...PROVIDER_DEFAULTS.apple, clientIds: [] } }),
  });
}

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((done, fail) => {
    request({ host: '127.0.0.1', port, path, headers: { Host: 'api.localhost' } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    })
      .on('error', fail)
      .end();
  });
}

function listen(server: Server): Promise<number> {
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done((server.address() as AddressInfo).port)));
}

describe('alert email', () => {
  test('reads and checks ALERT_EMAIL', () => {
    assert.equal(alertAddress({}), '');
    assert.equal(alertAddress({ ALERT_EMAIL: ' owner@example.com ' }), 'owner@example.com');
    assert.throws(() => alertAddress({ ALERT_EMAIL: 'a@b.com, c@d.com' }), ConfigError);
  });

  test('says what happened and where from, with the HTML escaped', () => {
    const email = alertEmail(loadConfig({}), 'owner@example.com', 'Backup failed', 'pg_dump said <nothing>');
    assert.equal(email.subject, 'hairbydemj alert: Backup failed');
    assert.match(email.text, /pg_dump said <nothing>/);
    assert.match(email.html, /pg_dump said &lt;nothing&gt;/);
  });
});

describe('health check with the database', () => {
  test('answers 503 when the database does not answer', async () => {
    const pool = createPool('postgres://nobody@127.0.0.1:1/none');
    const server = createServer(createApp(loadConfig({}), createLogger('error', () => {}), { version: 't', accounts: deps(pool) }));
    const port = await listen(server);
    try {
      assert.equal((await get(port, '/health')).status, 200);
      const reply = await get(port, '/health?db=1');
      assert.equal(reply.status, 503);
      assert.equal(JSON.parse(reply.body).database, 'unreachable');
    } finally {
      server.close();
      await pool.end();
    }
  });

  test('answers 200 when it does', { skip: skipDb }, async () => {
    const testDb = await createTestDatabase();
    const pool = createPool(testDb.url);
    const server = createServer(createApp(loadConfig({}), createLogger('error', () => {}), { version: 't', accounts: deps(pool) }));
    const port = await listen(server);
    try {
      assert.equal((await get(port, '/health?db=1')).status, 200);
    } finally {
      server.close();
      await pool.end();
      await testDb.drop();
    }
  });
});

describe('deployment script', () => {
  let root: string;
  let health: Server;
  let healthy = true;
  let env: Record<string, string>;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'hbd-deploy-'));
    health = createServer((req, res) => {
      res.writeHead(healthy && req.url === '/health?db=1' && req.headers.host === 'api.example.test' ? 200 : 500).end();
    });
    const port = await listen(health);
    const base = join(root, 'hairbydemj');
    for (const dir of ['releases', 'incoming', 'shared']) mkdirSync(join(base, dir), { recursive: true });
    writeFileSync(join(base, 'shared', '.env'), `PORT=${port}\nAPI_HOST="api.example.test"\nSECRET_FOR_MIGRATIONS=from-env-file\n`);
    const systemctl = join(root, 'systemctl');
    writeFileSync(systemctl, `#!/usr/bin/env bash\necho "$@" >> "${root}/systemctl.log"\n`);
    chmodSync(systemctl, 0o755);
    env = { HBD_ROOT: root, HBD_SYSTEMCTL: systemctl, HBD_NODE: process.execPath, HBD_HEALTH_TRIES: '2', HBD_HEALTH_WAIT: '0' };
  });

  after(() => {
    health.close();
    rmSync(root, { recursive: true, force: true });
  });

  // A stand-in for a built release: its "migration" writes down the setting it was given.
  function upload(commit: string): void {
    const src = join(root, `src-${commit}`);
    mkdirSync(join(src, 'dist', 'server', 'db'), { recursive: true });
    writeFileSync(join(src, 'dist', 'server', 'db', 'cli.js'), `require('fs').writeFileSync('migrated', process.env.SECRET_FOR_MIGRATIONS + ' ' + process.argv[2]);`);
    writeFileSync(join(src, 'package.json'), '{"type":"commonjs"}');
    execFileSyncTar(src, join(root, 'hairbydemj', 'incoming', `${commit}.tgz`));
  }

  test('unpacks, migrates, switches and restarts', async () => {
    upload('aaaaaaa1');
    const result = await run('release.sh', ['production', 'aaaaaaa1'], env);
    assert.equal(result.code, 0, result.out);
    const current = readlinkSync(join(root, 'hairbydemj', 'current'));
    assert.match(current, /-aaaaaaa$/);
    assert.equal(readFileSync(join(current, 'migrated'), 'utf8'), 'from-env-file migrate');
    assert.equal(readFileSync(join(current, 'COMMIT'), 'utf8').trim(), 'aaaaaaa1');
    assert.equal(readFileSync(join(root, 'systemctl.log'), 'utf8'), 'restart hairbydemj-web\nrestart hairbydemj-worker\n');
    assert.equal(existsSync(join(root, 'hairbydemj', 'incoming', 'aaaaaaa1.tgz')), false);
  });

  test('goes back to the previous version when the health check fails', async () => {
    const before = readlinkSync(join(root, 'hairbydemj', 'current'));
    await new Promise((r) => setTimeout(r, 1100)); // release folders are named by the second
    upload('bbbbbbb2');
    healthy = false;
    const result = await run('release.sh', ['production', 'bbbbbbb2'], env);
    healthy = true;
    assert.notEqual(result.code, 0);
    assert.match(result.out, /did not answer its health check/);
    assert.equal(readlinkSync(join(root, 'hairbydemj', 'current')), before);
  });

  test('refuses bad input and keeps the newest five versions', async () => {
    assert.notEqual((await run('release.sh', ['live', 'aaaaaaa1'], env)).code, 0);
    assert.notEqual((await run('release.sh', ['production', 'not;a;commit'], env)).code, 0);
    for (const n of [3, 4, 5, 6, 7]) {
      await new Promise((r) => setTimeout(r, 1100));
      upload(`ccccccc${n}`);
      assert.equal((await run('release.sh', ['production', `ccccccc${n}`], env)).code, 0);
    }
    const releases = readdirSync(join(root, 'hairbydemj', 'releases'));
    assert.equal(releases.length, 5);
    assert.ok(readlinkSync(join(root, 'hairbydemj', 'current')).endsWith('ccccccc'));
  });

  test('rolls back to the version before', async () => {
    const result = await run('rollback.sh', ['production'], env);
    assert.equal(result.code, 0, result.out);
    const releases = readdirSync(join(root, 'hairbydemj', 'releases')).sort();
    assert.equal(readlinkSync(join(root, 'hairbydemj', 'current')), join(root, 'hairbydemj', 'releases', releases[releases.length - 2]!));
  });
});

function execFileSyncTar(src: string, out: string): void {
  execFileSync('tar', ['-czf', out, '-C', src, '.']);
}

// A stand-in for rclone: "hbd-backup:path" is a folder on disk.
const RCLONE_STUB = `#!/usr/bin/env bash
set -euo pipefail
map() { local p="$1"; if [[ "$p" == hbd-backup:* ]]; then echo "$STUB_REMOTE/\${p#hbd-backup:}"; else echo "$p"; fi; }
cmd="$1"; shift
case "$cmd" in
  listremotes) echo "hbd-backup: \${STUB_TYPE:-crypt}" ;;
  copyto) mkdir -p "$(dirname "$(map "$2")")"; cp "$(map "$1")" "$(map "$2")" ;;
  copy) mkdir -p "$(map "$2")"; cp -R "$(map "$1")/." "$(map "$2")/" ;;
  sync) mkdir -p "$(map "$2")"; cp -R "$(map "$1")/." "$(map "$2")/" ;;
  lsf)
    rec=no; files=no; args=()
    for a in "$@"; do case "$a" in --recursive) rec=yes ;; --files-only) files=yes ;; *) args+=("$a") ;; esac; done
    d="$(map "\${args[0]}")"; [ -d "$d" ] || exit 3
    if [ $rec = yes ]; then (cd "$d" && find . -type f | sed 's#^\\./##'); else (cd "$d" && for f in *; do [ -e "$f" ] || continue; if [ -d "$f" ]; then echo "$f/"; else echo "$f"; fi; done); fi ;;
  deletefile) rm -f "$(map "$1")" ;;
  purge) rm -rf "$(map "$1")" ;;
  *) echo "stub rclone: $cmd not handled" >&2; exit 1 ;;
esac
`;

describe('backups', { skip: skipDb }, () => {
  let root: string;
  let live: TestDatabase;
  let restore: TestDatabase;
  let env: Record<string, string>;
  const remote = (): string => join(root, 'remote');
  const today = new Date().toISOString().slice(0, 10);

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'hbd-backup-'));
    live = await createTestDatabase();
    restore = await createTestDatabase();
    const pool = createPool(live.url);
    await migrate(pool, join(REPO, 'db', 'migrations'));
    await pool.end();
    const shared = join(root, 'hairbydemj', 'shared');
    mkdirSync(join(shared, 'uploads', 'public', 'p1'), { recursive: true });
    writeFileSync(join(shared, 'uploads', 'public', 'p1', 'photo.webp'), 'not really a photo');
    writeFileSync(join(shared, '.env'), [`DATABASE_URL=${live.url}`, `RESTORE_TEST_DATABASE_URL=${restore.url}`, `MEDIA_DIR=${join(shared, 'uploads')}`, 'BACKUP_REMOTE=hbd-backup', ''].join('\n'));
    const rclone = join(root, 'rclone');
    writeFileSync(rclone, RCLONE_STUB);
    chmodSync(rclone, 0o755);
    mkdirSync(join(remote(), 'db', 'daily'), { recursive: true });
    writeFileSync(join(remote(), 'db', 'daily', 'db-2000-01-01.dump'), 'old');
    env = { HBD_ROOT: root, HBD_RCLONE: rclone, STUB_REMOTE: remote(), HBD_NODE: process.execPath };
  });

  after(async () => {
    rmSync(root, { recursive: true, force: true });
    await live.drop();
    await restore.drop();
  });

  test('refuses a remote that is not encrypted', async () => {
    const result = await run('backup.sh', ['production'], { ...env, STUB_TYPE: 'drive' });
    assert.notEqual(result.code, 0);
    assert.match(result.out, /not set up as an encrypted/);
  });

  test('sends the database, settings and uploads, and removes old copies', async () => {
    const result = await run('backup.sh', ['production'], env);
    assert.equal(result.code, 0, result.out);
    assert.ok(existsSync(join(remote(), 'db', 'daily', `db-${today}.dump`)));
    assert.ok(existsSync(join(remote(), 'settings', `env-${today}`)));
    assert.equal(readFileSync(join(remote(), 'uploads', 'current', 'public', 'p1', 'photo.webp'), 'utf8'), 'not really a photo');
    assert.equal(existsSync(join(remote(), 'db', 'daily', 'db-2000-01-01.dump')), false);
    assert.ok(existsSync(join(root, 'hairbydemj', 'shared', 'backups', 'last-success')));
  });

  test('the monthly restore test restores the copy and checks files', async () => {
    const result = await run('restore-test.sh', ['production'], env);
    assert.equal(result.code, 0, result.out);
    assert.match(result.out, /schema_migrations\s+restored [1-9]/);
    assert.match(result.out, /Uploaded files checked: 1/);
    assert.ok(existsSync(join(root, 'hairbydemj', 'shared', 'backups', 'last-restore-test')));
  });

  test('the restore test fails loudly when a file in the backup differs', async () => {
    writeFileSync(join(remote(), 'uploads', 'current', 'public', 'p1', 'photo.webp'), 'changed');
    const result = await run('restore-test.sh', ['production'], env);
    assert.notEqual(result.code, 0);
    assert.match(result.out, /restore test FAILED/);
  });
});

describe('server check', () => {
  let root: string;
  let env: Record<string, string>;

  before(() => {
    root = mkdtempSync(join(tmpdir(), 'hbd-check-'));
    mkdirSync(join(root, 'hairbydemj', 'shared', 'backups'), { recursive: true });
    writeFileSync(join(root, 'hairbydemj', 'shared', '.env'), '');
    const systemctl = join(root, 'systemctl');
    writeFileSync(systemctl, `#!/usr/bin/env bash\n[ "$3" != "$STOPPED" ]\n`);
    chmodSync(systemctl, 0o755);
    env = { HBD_ROOT: root, HBD_SYSTEMCTL: systemctl, HBD_SYSTEM_UNITS: '', HBD_DISK_LIMIT: '100', HBD_NODE: process.execPath, STOPPED: 'hairbydemj-worker' };
  });

  after(() => rmSync(root, { recursive: true, force: true }));

  test('reports a stopped service and a missing backup once, then their clearing', async () => {
    const first = await run('check-server.sh', ['production'], env);
    assert.equal(first.code, 0);
    assert.match(first.out, /ALERT \[production\] Server problem: service-hairbydemj-worker/);
    assert.match(first.out, /ALERT \[production\] Server problem: backup/);
    const again = await run('check-server.sh', ['production'], env);
    assert.doesNotMatch(again.out, /ALERT/);
    writeFileSync(join(root, 'hairbydemj', 'shared', 'backups', 'last-success'), 'now');
    const fixed = await run('check-server.sh', ['production'], { ...env, STOPPED: 'none' });
    assert.match(fixed.out, /Fixed: backup/);
    assert.match(fixed.out, /Fixed: service-hairbydemj-worker/);
    assert.match(fixed.out, /All checks passed/);
  });
});

// Our own migration runner. It applies the numbered SQL files in
// db/migrations/ in order, each inside its own transaction, and records what
// has been applied in the schema_migrations table.

import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Db } from './pool.js';

export interface MigrationFile {
  version: number;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  version: number;
  name: string;
  checksum: string;
  appliedAt: Date;
}

export interface MigrationStatus {
  applied: AppliedMigration[];
  pending: MigrationFile[];
}

export class MigrationError extends Error {
  override name = 'MigrationError';
}

const FILE_PATTERN = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
// Any fixed number: only one migration run may hold this lock at a time.
const LOCK_KEY = 7_412_025;

/** Line endings are ignored so a checkout on Windows gives the same checksum. */
export function checksumOf(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
}

/** Read and check the migration files in a folder. Other files (README.md) are ignored. */
export async function readMigrations(dir: string): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort();
  const files: MigrationFile[] = [];
  for (const file of names) {
    const match = FILE_PATTERN.exec(file);
    if (!match) {
      throw new MigrationError(`"${file}" is not a valid migration name. Use four digits, an underscore and lower-case words, for example 0010_add_wishlist_notes.sql`);
    }
    const sql = await readFile(join(dir, file), 'utf8');
    if (sql.trim() === '') throw new MigrationError(`Migration ${file} is empty`);
    files.push({ version: Number(match[1]), name: match[2] ?? '', file, sql, checksum: checksumOf(sql) });
  }
  files.forEach((m, index) => {
    const expected = index + 1;
    if (m.version !== expected) {
      const previous = files[index - 1];
      throw new MigrationError(
        previous && previous.version === m.version
          ? `Two migrations share the number ${String(m.version).padStart(4, '0')}: ${previous.file} and ${m.file}`
          : `Migration numbers must run 0001, 0002, 0003 with no gaps: expected ${String(expected).padStart(4, '0')} but found ${m.file}`,
      );
    }
  });
  return files;
}

const CREATE_TABLE = `
  create table if not exists schema_migrations (
    version    integer primary key,
    name       text not null,
    checksum   text not null,
    applied_at timestamptz not null default now()
  )`;

interface Queryable {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

async function readApplied(client: Queryable): Promise<AppliedMigration[]> {
  const result = await client.query('select version, name, checksum, applied_at from schema_migrations order by version');
  return result.rows.map((r) => ({ version: Number(r.version), name: String(r.name), checksum: String(r.checksum), appliedAt: r.applied_at as Date }));
}

/** Compare what the database has with the files, and refuse anything that does not line up. */
function plan(files: MigrationFile[], applied: AppliedMigration[]): MigrationFile[] {
  const byVersion = new Map(files.map((f) => [f.version, f]));
  for (const done of applied) {
    const file = byVersion.get(done.version);
    const label = `${String(done.version).padStart(4, '0')}_${done.name}`;
    if (!file) throw new MigrationError(`The database has migration ${label}, but its file is missing from db/migrations/. Restore the file; do not delete applied migrations.`);
    if (file.checksum !== done.checksum || file.name !== done.name) {
      throw new MigrationError(`Migration ${label} was changed after it was applied. Applied migrations must never be edited: undo the edit and put the change in a new migration file.`);
    }
  }
  const last = applied.length ? (applied[applied.length - 1]?.version ?? 0) : 0;
  return files.filter((f) => f.version > last);
}

/** What has been applied and what is waiting. Changes nothing except creating the bookkeeping table. */
export async function migrationStatus(db: Db, dir: string): Promise<MigrationStatus> {
  const files = await readMigrations(dir);
  await db.query(CREATE_TABLE);
  const applied = await readApplied(db);
  return { applied, pending: plan(files, applied) };
}

/**
 * Apply every pending migration, oldest first. Each runs in its own
 * transaction, so a failing migration leaves no half-made changes; the ones
 * before it stay applied. Returns the migrations applied in this run.
 */
export async function migrate(db: Db, dir: string, log: (line: string) => void = () => undefined): Promise<MigrationFile[]> {
  const files = await readMigrations(dir);
  const client = await db.connect();
  const done: MigrationFile[] = [];
  try {
    // Waits here if another process is migrating the same database.
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(CREATE_TABLE);
    const pending = plan(files, await readApplied(client));
    for (const m of pending) {
      try {
        await client.query('begin');
        await client.query(m.sql);
        await client.query('insert into schema_migrations (version, name, checksum) values ($1, $2, $3)', [m.version, m.name, m.checksum]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        const reason = error instanceof Error ? error.message : String(error);
        throw new MigrationError(`Migration ${m.file} failed and was rolled back: ${reason}`, { cause: error });
      }
      done.push(m);
      log(`applied ${m.file}`);
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    client.release();
  }
  return done;
}

// Connection to PostgreSQL through the pg driver. Queries are plain SQL with
// numbered parameters ($1, $2); there is no query builder or ORM.

import pg from 'pg';

export type Db = pg.Pool;
export type DbClient = pg.PoolClient;

// PostgreSQL returns bigint (type 20) as text by default because JavaScript
// numbers cannot hold every bigint. Ids and money in minor units stay far
// below that limit, so they are read as numbers; anything larger is an error
// rather than a silently wrong amount.
pg.types.setTypeParser(20, (text) => {
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new RangeError(`bigint value ${text} is too large to read safely`);
  return value;
});

export function createPool(databaseUrl: string, options: { max?: number } = {}): Db {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'hairbydemj',
  });
  // An idle connection can drop (database restart, network); without a
  // listener that error would stop the whole server.
  pool.on('error', (error) => {
    console.error('Database connection error:', error.message);
  });
  return pool;
}

/** Run a function inside one transaction: commit if it returns, roll back if it throws. */
export async function withTransaction<T>(db: Db, work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Hide the password when a database address is printed. */
export function describeDatabase(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}${url.port ? ':' + url.port : ''}${url.pathname}`;
  } catch {
    return '(unreadable database address)';
  }
}

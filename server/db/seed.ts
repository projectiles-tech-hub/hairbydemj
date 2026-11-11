// Loads sample data for local development from db/seeds/dev.sql.
// It refuses to run in production or on a database that already has products.

import { readFile } from 'node:fs/promises';
import { withTransaction, type Db } from './pool.js';

export class SeedError extends Error {
  override name = 'SeedError';
}

export async function seed(db: Db, file: string, env: string): Promise<void> {
  if (env === 'production') throw new SeedError('Sample data is for local development only and cannot be loaded in production.');
  const existing = await db.query('select count(*)::int as n from products');
  if (Number(existing.rows[0]?.n) > 0) throw new SeedError('This database already has products, so the sample data was not loaded again.');
  const sql = await readFile(file, 'utf8');
  await withTransaction(db, async (client) => {
    await client.query(sql);
  });
}

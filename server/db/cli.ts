// Command line for the database: npm run db:migrate | db:status | db:seed

import { loadConfig } from '../config.js';
import { migrate, migrationStatus, MigrationError } from './migrate.js';
import { createPool, describeDatabase } from './pool.js';
import { seed, SeedError } from './seed.js';

const MIGRATIONS_DIR = 'db/migrations';
const SEED_FILE = 'db/seeds/dev.sql';

async function main(): Promise<number> {
  const command = process.argv[2];
  if (command !== 'migrate' && command !== 'status' && command !== 'seed') {
    console.error('Usage: node dist/server/db/cli.js migrate | status | seed');
    return 2;
  }
  const config = loadConfig();
  if (!config.databaseUrl) {
    console.error('DATABASE_URL is not set. Add it to your .env file; see docs/database.md.');
    return 2;
  }
  const db = createPool(config.databaseUrl, { max: 2 });
  try {
    console.log(`Database: ${describeDatabase(config.databaseUrl)}`);
    if (command === 'status') {
      const { applied, pending } = await migrationStatus(db, MIGRATIONS_DIR);
      for (const m of applied) console.log(`applied  ${String(m.version).padStart(4, '0')}_${m.name}  ${m.appliedAt.toISOString()}`);
      for (const m of pending) console.log(`pending  ${m.file}`);
      console.log(`${applied.length} applied, ${pending.length} pending`);
    } else if (command === 'migrate') {
      const done = await migrate(db, MIGRATIONS_DIR, (line) => console.log(line));
      console.log(done.length ? `${done.length} migration(s) applied` : 'Nothing to do: the database is up to date');
    } else {
      await seed(db, SEED_FILE, config.env);
      console.log('Sample data loaded');
    }
    return 0;
  } catch (error) {
    if (error instanceof MigrationError || error instanceof SeedError) console.error(error.message);
    else console.error(error);
    return 1;
  } finally {
    await db.end();
  }
}

process.exitCode = await main();

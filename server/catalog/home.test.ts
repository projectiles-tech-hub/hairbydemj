import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { migrate } from '../db/migrate.js';
import { createPool, type Db } from '../db/pool.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from '../db/test-database.js';
import { homeLayout } from './public.js';

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

describe('the homepage layout the app reads', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  before(async () => {
    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 2 });
    await migrate(db, 'db/migrations');
  });
  after(async () => {
    await db.end();
    await testDb.drop();
  });

  test('before staff set it up, the website\'s order is used', async () => {
    await db.query('delete from homepage_sections');
    assert.deepEqual((await homeLayout(db)).sections.map((s) => s.kind), ['hero', 'collections', 'best_sellers', 'new_arrivals', 'shop_the_look']);
  });

  test('staff\'s order, hidden sections left out, and the banner\'s words', async () => {
    await db.query(
      `insert into homepage_sections (kind, position, is_shown, settings) values
        ('hero', 2, true, '{"headline":"New season"}'), ('best_sellers', 1, true, '{}'), ('new_arrivals', 3, false, '{}')`,
    );
    const layout = await homeLayout(db);
    assert.deepEqual(layout.sections.map((s) => s.kind), ['best_sellers', 'hero']);
    assert.equal(layout.sections[1]?.settings.headline, 'New season');
  });
});

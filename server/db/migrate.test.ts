import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { checksumOf, migrate, MigrationError, migrationStatus, readMigrations } from './migrate.js';
import { createPool, describeDatabase, withTransaction, type Db } from './pool.js';
import { seed, SeedError } from './seed.js';
import { createTestDatabase, TEST_DATABASE_URL, type TestDatabase } from './test-database.js';

async function folder(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hbd-migrations-'));
  for (const [name, sql] of Object.entries(files)) await writeFile(join(dir, name), sql);
  return dir;
}

describe('reading migration files', () => {
  test('reads files in number order and ignores files that are not SQL', async () => {
    const dir = await folder({ '0002_second.sql': 'select 2;', '0001_first.sql': 'select 1;', 'README.md': 'notes' });
    const files = await readMigrations(dir);
    assert.deepEqual(files.map((f) => [f.version, f.name]), [[1, 'first'], [2, 'second']]);
    assert.equal(files[0]?.checksum, checksumOf('select 1;'));
    await rm(dir, { recursive: true });
  });

  test('rejects a badly named file', async () => {
    const dir = await folder({ '1_first.sql': 'select 1;' });
    await assert.rejects(readMigrations(dir), MigrationError);
    await rm(dir, { recursive: true });
  });

  test('rejects a gap in the numbers', async () => {
    const dir = await folder({ '0001_first.sql': 'select 1;', '0003_third.sql': 'select 3;' });
    await assert.rejects(readMigrations(dir), /no gaps/);
    await rm(dir, { recursive: true });
  });

  test('rejects two files with the same number', async () => {
    const dir = await folder({ '0001_first.sql': 'select 1;', '0001_other.sql': 'select 1;' });
    await assert.rejects(readMigrations(dir), /share the number 0001/);
    await rm(dir, { recursive: true });
  });

  test('rejects an empty file', async () => {
    const dir = await folder({ '0001_first.sql': '  \n' });
    await assert.rejects(readMigrations(dir), /empty/);
    await rm(dir, { recursive: true });
  });

  test('the checksum ignores Windows line endings', () => {
    assert.equal(checksumOf('select 1;\r\nselect 2;\r\n'), checksumOf('select 1;\nselect 2;\n'));
  });

  test('the real migrations are well formed', async () => {
    const files = await readMigrations('db/migrations');
    assert.ok(files.length >= 9);
  });
});

test('describeDatabase never shows the password', () => {
  assert.equal(describeDatabase('postgres://user:s3cret@db.example.com:5432/shop'), 'db.example.com:5432/shop');
  assert.ok(!describeDatabase('not a url s3cret').includes('s3cret'));
});

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

describe('the migration runner against PostgreSQL', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  before(async () => {
    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 4 });
  });
  after(async () => {
    await db.end();
    await testDb.drop();
  });

  test('applies pending migrations once, in order, and records them', async () => {
    const dir = await folder({ '0001_a.sql': 'create table a (id int primary key);', '0002_b.sql': 'create table b (a_id int references a (id)); insert into a values (1); insert into b values (1);' });
    const lines: string[] = [];
    const first = await migrate(db, dir, (l) => lines.push(l));
    assert.deepEqual(first.map((m) => m.file), ['0001_a.sql', '0002_b.sql']);
    assert.deepEqual(lines, ['applied 0001_a.sql', 'applied 0002_b.sql']);
    assert.deepEqual(await migrate(db, dir), [], 'a second run does nothing');
    const status = await migrationStatus(db, dir);
    assert.equal(status.applied.length, 2);
    assert.equal(status.pending.length, 0);

    await writeFile(join(dir, '0003_c.sql'), 'create table c (id int);');
    assert.deepEqual((await migrationStatus(db, dir)).pending.map((m) => m.file), ['0003_c.sql']);
    assert.deepEqual((await migrate(db, dir)).map((m) => m.file), ['0003_c.sql']);

    // A failing migration is rolled back whole; earlier ones stay.
    await writeFile(join(dir, '0004_bad.sql'), 'create table d (id int); insert into no_such_table values (1);');
    await assert.rejects(migrate(db, dir), /0004_bad\.sql failed and was rolled back/);
    const tables = await db.query("select to_regclass('d') as d, to_regclass('c') as c");
    assert.equal(tables.rows[0]?.d, null);
    assert.equal(tables.rows[0]?.c, 'c');
    assert.equal((await migrationStatus(db, dir)).applied.length, 3);

    // Editing or deleting an applied migration is refused.
    await rm(join(dir, '0004_bad.sql'));
    await writeFile(join(dir, '0002_b.sql'), 'create table b (id int); -- edited');
    await assert.rejects(migrate(db, dir), /changed after it was applied/);
    await rm(join(dir, '0003_c.sql'));
    await rm(join(dir, '0002_b.sql'));
    await assert.rejects(migrate(db, dir), /file is missing/);
    await rm(dir, { recursive: true });
  });

  test('two runs at the same time do not apply a migration twice', async () => {
    const other = await createTestDatabase();
    const pool = createPool(other.url, { max: 4 });
    const dir = await folder({ '0001_slow.sql': 'select pg_sleep(0.3); create table slow (id int);' });
    try {
      const [a, b] = await Promise.all([migrate(pool, dir), migrate(pool, dir)]);
      assert.equal(a.length + b.length, 1);
    } finally {
      await pool.end();
      await other.drop();
      await rm(dir, { recursive: true });
    }
  });
});

describe('the store schema', { skip }, () => {
  let testDb: TestDatabase;
  let db: Db;
  before(async () => {
    testDb = await createTestDatabase();
    db = createPool(testDb.url, { max: 4 });
    await migrate(db, 'db/migrations');
  });
  after(async () => {
    await db.end();
    await testDb.drop();
  });

  /** Run SQL that must be refused by a constraint, without leaving the pool in a failed transaction. */
  const refused = (sql: string, values: unknown[] = []): Promise<void> => assert.rejects(db.query(sql, values), (e: Error & { code?: string }) => /^23/.test(e.code ?? ''), sql);

  test('a fresh database is built from the migrations alone and covers the data model', async () => {
    const result = await db.query("select table_name from information_schema.tables where table_schema = 'public'");
    const tables = new Set(result.rows.map((r) => r.table_name as string));
    const expected = [
      'products', 'product_media', 'categories', 'collections', 'variants', 'prices', 'inventory', 'stock_movements',
      'customers', 'addresses', 'customer_sessions', 'wishlist_items', 'carts', 'cart_items', 'orders', 'order_items',
      'payments', 'payment_events', 'refunds', 'shipments', 'shipment_events', 'returns', 'return_items',
      'discounts', 'gift_cards', 'gift_card_transactions', 'referrals', 'loyalty_transactions', 'reviews', 'review_media',
      'staff', 'roles', 'role_permissions', 'activity_log', 'jobs', 'currencies', 'store_settings', 'content_pages', 'chat_messages',
    ];
    for (const name of expected) assert.ok(tables.has(name), `table ${name} exists`);
    const currencies = await db.query('select code, provider from currencies order by code');
    assert.deepEqual(currencies.rows, [{ code: 'EUR', provider: 'stripe' }, { code: 'GBP', provider: 'stripe' }, { code: 'NGN', provider: 'paystack' }, { code: 'USD', provider: 'stripe' }]);
    const owner = await db.query('select count(*)::int as n from role_permissions p join roles r on r.id = p.role_id where r.is_owner and p.can_change');
    assert.equal(owner.rows[0]?.n, 7);
  });

  test('every foreign key has an index, so deletes and joins stay fast', async () => {
    const result = await db.query(`
      select c.conrelid::regclass::text as tbl, a.attname as col
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1])
      order by 1, 2`);
    // Small look-up columns that are never searched by on their own.
    const allowed = new Set([
      'prices.currency', 'customers.preferred_currency', 'customers.loyalty_tier', 'carts.currency', 'orders.currency', 'orders.package_size_id',
      'payments.currency', 'shipments.rate_currency', 'shipments.package_size_id', 'gift_cards.currency', 'discount_amounts.currency',
      'products.package_size_id', 'staff_invites.invited_by', 'discounts.created_by', 'gift_cards.issued_by_staff_id', 'stock_movements.staff_id',
      'stock_movements.order_id', 'order_events.staff_id', 'gift_card_transactions.staff_id', 'returns.decided_by', 'refunds.staff_id', 'refunds.return_id',
      'reviews.replied_by', 'loyalty_transactions.review_id', 'loyalty_transactions.staff_id', 'referrals.first_order_id', 'store_settings.updated_by',
      'content_pages.updated_by', 'chat_conversations.assigned_staff_id', 'chat_conversations.order_id', 'chat_messages.staff_id', 'order_items.gift_card_id',
      'newsletter_subscribers.customer_id', 'product_media.created_by', 'back_in_stock_requests.customer_id', 'refund_items.order_item_id', 'return_items.order_item_id',
    ]);
    const missing = result.rows.map((r) => `${r.tbl}.${r.col}`).filter((x) => !allowed.has(x));
    assert.deepEqual(missing, []);
  });

  test('the sample data loads, once, and never in production', async () => {
    await assert.rejects(seed(db, 'db/seeds/dev.sql', 'production'), SeedError);
    await seed(db, 'db/seeds/dev.sql', 'development');
    await assert.rejects(seed(db, 'db/seeds/dev.sql', 'development'), /already has products/);
    const counts = await db.query('select (select count(*)::int from products) as products, (select count(*)::int from variants) as variants, (select count(*)::int from prices) as prices');
    assert.deepEqual(counts.rows[0], { products: 6, variants: 16, prices: 64 });
    const usd = await db.query("select bool_and(amount_minor % 100 = 0 and amount_minor > 0) as ok from prices where currency = 'USD'");
    assert.equal(usd.rows[0]?.ok, true, 'converted prices are rounded to whole dollars');
  });

  test('money is whole minor units read back as numbers', async () => {
    const row = await db.query("select amount_minor from prices where currency = 'NGN' order by amount_minor desc limit 1");
    assert.equal(typeof row.rows[0]?.amount_minor, 'number');
    assert.ok(Number.isInteger(row.rows[0]?.amount_minor));
    // A fraction sent by the server is refused, not rounded.
    await assert.rejects(db.query("update prices set amount_minor = $1 where currency = 'NGN'", [10.5]), /invalid input syntax for type bigint/);
  });

  test('search finds products by word and forgives typing mistakes', async () => {
    const words = await db.query("select name from products where search @@ websearch_to_tsquery('english', 'straight wig') order by ts_rank(search, websearch_to_tsquery('english', 'straight wig')) desc");
    assert.equal(words.rows[0]?.name, 'Bone straight wig');
    const typo = await db.query("select name from products where name % 'bone striaght wig' order by similarity(name, 'bone striaght wig') desc");
    assert.equal(typo.rows[0]?.name, 'Bone straight wig');
  });

  test('constraints refuse data that cannot be right', async () => {
    const variant = Number((await db.query('select id from variants order by id limit 1')).rows[0]?.id);
    const product = Number((await db.query('select id from products order by id limit 1')).rows[0]?.id);
    await refused("insert into prices (variant_id, currency, amount_minor) values ($1, 'NGN', 1)", [variant]); // one price per currency
    await refused("update prices set amount_minor = -1 where variant_id = $1 and currency = 'NGN'", [variant]);
    await refused("update prices set currency = 'JPY' where variant_id = $1 and currency = 'NGN'", [variant]);
    await refused('update inventory set on_hand = 1, reserved = 2 where variant_id = $1', [variant]);
    await refused('update inventory set on_hand = -1 where variant_id = $1', [variant]);
    await refused("insert into variants (product_id, sku, weight_grams) values ($1, 'acc-bonnet-blk', 10)", [product]); // SKU, any letter case
    await refused("insert into customers (email) values ('CUSTOMER@example.com')"); // email, any letter case
    await refused("insert into staff (name, email, role_id, status) select 'A', 'a@hairbydemj.test', id, 'active' from roles limit 1"); // active needs password and two-step
    await refused("insert into role_permissions (role_id, area, can_view, can_change) select id, 'orders', false, true from roles where name = 'Support'");
    await refused("insert into discounts (name, code, kind) values ('Bad', 'BAD', 'percentage')"); // percentage needs a percent
    await refused("insert into gift_cards (code_hash, code_last4, currency, initial_minor, balance_minor, recipient_email) values ('\\x01', '4F2A', 'NGN', 100, 200, 'a@example.com')");
    await refused("insert into orders (email, currency, subtotal_minor, shipping_minor, total_minor) values ('a@example.com', 'NGN', 1000, 500, 1000)"); // total must add up
    await refused("insert into payments (order_id, provider, reference, amount_minor, currency, status) values (1, 'paystack', 'x', 1, 'NGN', 'succeeded')");
  });

  test('an order gets a number, keeps its own copy of the item, and payment needs the webhook', async () => {
    await withTransaction(db, async (c) => {
      const order = await c.query("insert into orders (email, currency, subtotal_minor, discount_minor, shipping_minor, total_minor) values ('a@example.com', 'NGN', 28500000, 1850000, 1850000, 28500000) returning id, number, status, payment_status");
      const o = order.rows[0] as { id: number; number: string; status: string; payment_status: string };
      assert.match(o.number, /^HBD-1\d{4}$/);
      assert.equal(o.status, 'on_hold');
      assert.equal(o.payment_status, 'awaiting');
      await c.query("insert into order_items (order_id, variant_id, product_name, sku, quantity, unit_price_minor, total_minor) select $1, id, 'Bone straight wig', sku, 1, 28500000, 28500000 from variants order by id limit 1", [o.id]);
      await c.query("insert into payments (order_id, provider, reference, amount_minor, currency) values ($1, 'paystack', 'ref-1', 28500000, 'NGN')", [o.id]);
      await c.query("update payments set status = 'succeeded', webhook_confirmed_at = now() where reference = 'ref-1'");
      const ret = await c.query('insert into returns (order_id) values ($1) returning number', [o.id]);
      assert.match(String(ret.rows[0]?.number), /^RET-\d+$/);
      // Deleting the product later leaves the order line in place.
      await c.query('delete from variants where id = (select variant_id from order_items where order_id = $1)', [o.id]);
      const item = await c.query('select product_name, variant_id from order_items where order_id = $1', [o.id]);
      assert.deepEqual(item.rows[0], { product_name: 'Bone straight wig', variant_id: null });
      throw new Error('undo');
    }).catch((e: Error) => assert.equal(e.message, 'undo'));
    assert.equal((await db.query('select count(*)::int as n from orders')).rows[0]?.n, 0, 'the transaction was rolled back');
  });

  test('updated_at moves when a row changes', async () => {
    const before = await db.query("select updated_at from products where slug = 'silk-bonnet'");
    await db.query("update products set name = 'Silk bonnet (black)' where slug = 'silk-bonnet'");
    const afterRow = await db.query("select updated_at from products where slug = 'silk-bonnet'");
    assert.ok((afterRow.rows[0]?.updated_at as Date) > (before.rows[0]?.updated_at as Date));
  });
});

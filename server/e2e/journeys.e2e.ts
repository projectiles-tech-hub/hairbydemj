// Browser journeys through the real shop (module 20), in Chromium:
// a shopper buying as a guest and paying with Paystack (stand-in), a
// customer creating an account, the owner setting up their admin account,
// adding a product and sending the order, and live chat both ways.
// Run with: npm run test:e2e (needs TEST_DATABASE_URL and Playwright's Chromium).

import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright';
import { inviteOwnerFromServer } from '../accounts/staff.js';
import { totpCode, totpStep } from '../accounts/crypto.js';
import { TEST_DATABASE_URL } from '../db/test-database.js';
import { startShop, type Shop } from './harness.js';

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

function base32Decode(text: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of text.replace(/\s+/g, '')) bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  return Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
}

describe('browser journeys', { skip, timeout: 240_000 }, () => {
  let shop: Shop;
  let browser: Browser;
  const errors: string[] = [];
  let orderNumber = '';
  let ownerSecret: Buffer;
  const ownerPassword = 'owner-password-1';

  let open: Page[] = [];
  let testNumber = 0;

  async function newPage(): Promise<Page> {
    const context = await browser.newContext();
    const page = await context.newPage();
    open.push(page);
    if (process.env.E2E_SHOTS) page.on('requestfailed', (r) => console.log(`  failed ${r.url()} ${r.failure()?.errorText}`));
    if (process.env.E2E_SHOTS) page.on('framenavigated', (f) => f === page.mainFrame() && console.log(`  went to ${f.url()}`));
    page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
    return page;
  }

  /** Waits for the next 30-second step, so a two-step code is never reused. */
  async function freshCode(secret: Buffer): Promise<string> {
    const step = totpStep(new Date());
    while (totpStep(new Date()) === step) await new Promise((r) => setTimeout(r, 500));
    return totpCode(secret, totpStep(new Date()));
  }

  async function staffSignIn(page: Page): Promise<void> {
    await page.goto(`${shop.admin}/sign-in/`);
    await page.getByLabel('Email').fill('owner@example.com');
    await page.getByLabel('Password').fill(ownerPassword);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('main').getByLabel('Code').fill(await freshCode(ownerSecret));
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(`${shop.admin}/`);
  }

  before(async () => {
    shop = await startShop();
    browser = await chromium.launch();
  });

  // With E2E_SHOTS=<folder>, a picture of every page at the end of each test.
  afterEach(async () => {
    testNumber++;
    const folder = process.env.E2E_SHOTS;
    for (const [i, page] of open.entries()) {
      if (folder) await page.screenshot({ path: `${folder}/${testNumber}-${i}.png`, fullPage: true }).catch(() => undefined);
      await page.context().close();
    }
    open = [];
  });

  after(async () => {
    await browser?.close();
    await shop?.stop();
  });

  test('a guest finds a wig, checks out and pays in naira', async () => {
    const page = await newPage();
    await page.goto(shop.site);
    await page.getByRole('searchbox').first().fill('bone straight');
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/search\//);
    await page.getByRole('link', { name: /Bone straight wig/ }).first().click();
    await page.waitForURL(/\/products\/bone-straight-wig\//);
    const added = page.waitForResponse((r) => r.url().includes('/api/cart/items') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Add to bag' }).first().click();
    assert.ok((await added).ok(), 'added to the bag');

    await page.goto(`${shop.site}/cart/`);
    await page.getByText('Bone straight wig').first().waitFor();
    await page.goto(`${shop.site}/checkout/`);
    const form = page.locator('[data-checkout]');
    await form.getByLabel('Email').fill('guest@example.com');
    await form.getByLabel('Phone').fill('+2348031234567');
    await form.getByRole('button', { name: 'Continue to address' }).click();
    await form.getByLabel('Full name').fill('Grace Guest');
    await form.getByLabel('Street address').fill('12 Airport Road');
    await form.getByLabel('Town or city').fill('Benin City');
    await form.getByLabel('State', { exact: true }).selectOption('Edo');
    await form.getByRole('button', { name: 'See delivery options' }).click();
    await page.locator('[data-options] input[name="ship"]').first().waitFor();
    await form.getByRole('button', { name: 'Review your order' }).click();
    await form.getByRole('button', { name: 'Place order and pay' }).click();

    // The stand-in Paystack page sends the browser straight back, paid.
    await page.waitForURL(/\/checkout\/complete\//, { timeout: 30_000 });
    await page.getByText(/thank you|payment received|paid/i).first().waitFor({ timeout: 30_000 });
    const order = (await shop.db.query("select number, status, payment_status from orders where email = 'guest@example.com'")).rows[0] as { number: string; status: string; payment_status: string };
    assert.equal(order.payment_status, 'paid');
    assert.equal(order.status, 'to_fulfil');
    orderNumber = order.number;
    assert.equal([...shop.paystack.values()][0]?.currency, 'NGN');
  });

  test('a customer creates an account with the emailed code', async () => {
    const page = await newPage();
    await page.goto(`${shop.site}/create-account/`);
    const main = page.getByRole('main');
    await main.getByLabel('First name').fill('Ada');
    await page.getByRole('main').getByLabel('Last name').fill('Obi');
    await page.getByRole('main').getByLabel('Email', { exact: true }).fill('ada@example.com');
    await page.getByRole('main').getByLabel('Password', { exact: true }).fill('a-long-password');
    await page.getByRole('main').getByRole('button', { name: /create account/i }).click();
    await page.waitForURL(/\/verify-email\//);
    const code = shop.mail.last('verify_email', 'ada@example.com').data.code ?? '';
    await page.getByRole('main').getByLabel('Code').fill(code);
    await page.getByRole('main').getByRole('button', { name: /verify|confirm|continue/i }).click();
    await page.waitForURL(/\/account\//);
    await page.getByText('Ada').first().waitFor();
  });

  test('the owner sets up their admin account with two-step sign-in', async () => {
    const { token } = await inviteOwnerFromServer(shop.deps, { name: 'Owner', email: 'owner@example.com' });
    const page = await newPage();
    await page.goto(`${shop.admin}/invite/?token=${encodeURIComponent(token)}`);
    await page.getByLabel('Password').fill(ownerPassword);
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('[data-invite-secret]').filter({ hasText: /[A-Z2-7]{4}/ }).waitFor();
    const secretText = (await page.locator('[data-invite-secret]').textContent()) ?? '';
    ownerSecret = base32Decode(secretText);
    await page.getByRole('main').getByLabel('Code').fill(totpCode(ownerSecret, totpStep(new Date())));
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.getByText('Your account is ready.').waitFor();
    await staffSignIn(page);
    await page.getByRole('heading', { level: 1 }).first().waitFor();
  });

  test('staff record the paid order as sent', async () => {
    assert.ok(orderNumber, 'the guest order exists');
    const page = await newPage();
    await staffSignIn(page);
    await page.goto(`${shop.admin}/orders/`);
    await page.getByRole('link', { name: orderNumber }).first().click();
    await page.getByRole('button', { name: 'Record dispatch' }).click();
    await page.getByLabel('Tracking number (optional)').fill('BEN-0001');
    await page.getByRole('button', { name: 'Mark as sent' }).click();
    for (let i = 0; i < 20; i++) {
      const row = (await shop.db.query('select status from orders where number = $1', [orderNumber])).rows[0] as { status: string };
      if (row.status !== 'to_fulfil') break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const sent = (await shop.db.query('select status from orders where number = $1', [orderNumber])).rows[0] as { status: string };
    assert.equal(sent.status, 'shipped');
  });

  test('staff add a product as a draft, which the shop does not show yet', async () => {
    const page = await newPage();
    await staffSignIn(page);
    await page.goto(`${shop.admin}/products/new/`);
    await page.getByLabel('Name', { exact: true }).fill('Water wave wig');
    await page.getByLabel('Description', { exact: true }).first().fill('Loose water waves on a 13x4 lace front.');
    await page.getByRole('button', { name: 'Create product' }).click();
    await page.waitForURL(/\/products\/\d+\//);
    const made = (await shop.db.query("select slug, status from products where name = 'Water wave wig'")).rows[0] as { slug: string; status: string } | undefined;
    assert.equal(made?.status, 'draft');
    const shopper = await newPage();
    const reply = await shopper.goto(`${shop.site}/products/${made?.slug}/`);
    assert.equal(reply?.status(), 404);
  });

  test('live chat works both ways', async () => {
    const visitor = await newPage();
    await visitor.goto(shop.site);
    await visitor.getByRole('button', { name: /chat/i }).first().click();
    const panel = visitor.locator('[data-chat-panel], [data-chat]').first();
    await panel.getByRole('textbox').last().fill('Do you ship to Accra?');
    await panel.getByRole('textbox').last().press('Enter');
    const staff = await newPage();
    await staffSignIn(staff);
    await staff.goto(`${shop.admin}/chat/`);
    await staff.getByText('Do you ship to Accra?').first().click();
    const reply = staff.getByLabel('Type a reply');
    await reply.fill('Yes, by DHL in 3 to 5 days.');
    await reply.press('Enter');
    await visitor.getByText('Yes, by DHL in 3 to 5 days.').waitFor({ timeout: 15_000 });
  });

  test('no page had a script error', () => {
    assert.deepEqual(errors, []);
  });
});

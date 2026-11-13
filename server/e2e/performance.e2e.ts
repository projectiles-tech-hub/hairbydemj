// Speed on a slow phone connection (module 20). Each main page is loaded in
// Chromium at phone size over a throttled connection (the "slow 4G" that
// Google's Lighthouse uses: 150 ms round trips, 1.6 Mbit/s down) with an
// empty cache, and must stay inside the budgets below. The results are
// printed as a table; docs/performance.md keeps the latest ones.

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { chromium, devices, type Browser } from 'playwright';
import { TEST_DATABASE_URL } from '../db/test-database.js';
import { startShop, type Shop } from './harness.js';

const skip = TEST_DATABASE_URL ? false : 'TEST_DATABASE_URL is not set';

/** What a first visit may cost on a slow connection. */
export const BUDGET = { kilobytes: 350, requests: 30, largestPaintMs: 3000, loadMs: 4000 };

interface Result {
  page: string;
  kilobytes: number;
  requests: number;
  largestPaintMs: number;
  loadMs: number;
}

describe('speed on a slow connection', { skip, timeout: 240_000 }, () => {
  let shop: Shop;
  let browser: Browser;
  const results: Result[] = [];

  before(async () => {
    shop = await startShop();
    browser = await chromium.launch();
  });

  after(async () => {
    if (results.length) {
      console.log('\n| Page | Downloaded (KB) | Requests | Largest paint (ms) | Loaded (ms) |\n| --- | --- | --- | --- | --- |');
      for (const r of results) console.log(`| ${r.page} | ${r.kilobytes} | ${r.requests} | ${r.largestPaintMs} | ${r.loadMs} |`);
    }
    await browser?.close();
    await shop?.stop();
  });

  async function measure(path: string): Promise<Result> {
    const context = await browser.newContext({ ...devices['Pixel 7'] });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    let bytes = 0;
    let requests = 0;
    cdp.on('Network.loadingFinished', (e: { encodedDataLength: number }) => {
      bytes += e.encodedDataLength;
      requests++;
    });
    // Runs in the page (as text, since the server code has no browser types).
    await page.addInitScript({ content: "window.__lcp = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });" });
    const started = Date.now();
    await page.goto(`${shop.site}${path}`, { waitUntil: 'load' });
    const loadMs = Date.now() - started;
    await page.waitForTimeout(500);
    const largestPaintMs = Math.round(Number(await page.evaluate('window.__lcp')));
    await context.close();
    return { page: path, kilobytes: Math.round(bytes / 1024), requests, largestPaintMs, loadMs };
  }

  for (const path of ['/', '/c/wigs/', '/products/bone-straight-wig/', '/search/?q=wig', '/cart/', '/checkout/', '/sign-in/']) {
    test(`${path} is quick on slow 4G`, async () => {
      const r = await measure(path);
      results.push(r);
      assert.ok(r.kilobytes <= BUDGET.kilobytes, `${r.kilobytes} KB downloaded (budget ${BUDGET.kilobytes})`);
      assert.ok(r.requests <= BUDGET.requests, `${r.requests} requests (budget ${BUDGET.requests})`);
      assert.ok(r.largestPaintMs <= BUDGET.largestPaintMs, `largest paint at ${r.largestPaintMs} ms (budget ${BUDGET.largestPaintMs})`);
      assert.ok(r.loadMs <= BUDGET.loadMs, `loaded in ${r.loadMs} ms (budget ${BUDGET.loadMs})`);
    });
  }
});

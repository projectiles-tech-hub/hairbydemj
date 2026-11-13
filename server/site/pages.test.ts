import assert from 'node:assert/strict';
import { test } from 'node:test';
import { esc } from './html.js';
import { renderNotFound, renderPage, SITE_PAGES } from './pages.js';
import { naira } from './sample-data.js';

test('every website page renders a complete document', () => {
  for (const p of SITE_PAGES) {
    const html = renderPage(p, { preview: true });
    assert.ok(html.startsWith('<!doctype html>'), `${p.path} starts with a doctype`);
    assert.ok(html.includes('<main id="main">'), `${p.path} has a main landmark`);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${p.path} has exactly one h1`);
    assert.ok(!html.includes('undefined'), `${p.path} has no "undefined" in its output`);
    assert.ok(!html.includes('[object Object]'), `${p.path} has no unrendered object`);
  }
});

test('page addresses are unique and end with a slash', () => {
  const seen = new Set<string>();
  for (const p of SITE_PAGES) {
    assert.ok(p.path.startsWith('/') && p.path.endsWith('/'), `${p.path} is a folder address`);
    assert.ok(!seen.has(p.path), `${p.path} is listed once`);
    seen.add(p.path);
  }
});

test('links between pages point at pages that exist', () => {
  const paths = new Set(SITE_PAGES.map((p) => p.path));
  paths.add('/designs/');
  for (const p of SITE_PAGES) {
    const html = renderPage(p);
    for (const match of html.matchAll(/href="(\/[^"#]*)"/g)) {
      const href = match[1] ?? '';
      if (href.startsWith('/css/') || href.startsWith('/brand/') || href.startsWith('/js/') || href.startsWith('/fonts/')) continue;
      assert.ok(paths.has(href), `${p.path} links to ${href}, which is not a page`);
    }
  }
});

test('the preview flag adds the preview bar and hides the page from search engines', () => {
  const home = SITE_PAGES[0];
  assert.ok(home);
  assert.ok(renderPage(home, { preview: true }).includes('noindex'));
  assert.ok(!renderPage(home).includes('noindex'));
  assert.ok(renderNotFound().includes('Page not found'));
});

test('helpers escape text and format money from minor units', () => {
  assert.equal(esc('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  assert.equal(naira(28500000), '₦285,000');
});

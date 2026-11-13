import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ADMIN_NAV } from './layout.js';
import { ADMIN_DIALOGS, ADMIN_PAGES, renderAdminPage } from './pages.js';

test('every admin page renders a complete document', () => {
  for (const p of ADMIN_PAGES) {
    const html = renderAdminPage(p, { preview: true });
    assert.ok(html.startsWith('<!doctype html>'), `${p.path} starts with a doctype`);
    assert.ok(html.includes('<main id="main"'), `${p.path} has a main landmark`);
    assert.equal((html.match(/<h1[ >]/g) ?? []).length, 1, `${p.path} has exactly one h1`);
    assert.ok(!html.includes('undefined'), `${p.path} has no "undefined" in its output`);
    assert.ok(!html.includes('[object Object]'), `${p.path} has no unrendered object`);
    assert.ok(html.includes('name="robots" content="noindex"'), `${p.path} is hidden from search engines`);
  }
});

test('admin addresses are unique, under /admin/ and end with a slash', () => {
  const seen = new Set<string>();
  for (const p of ADMIN_PAGES) {
    assert.ok(p.path.startsWith('/admin/') && p.path.endsWith('/'), `${p.path} is an admin folder address`);
    assert.ok(!seen.has(p.path), `${p.path} is listed once`);
    seen.add(p.path);
  }
});

test('every sidebar item and every admin link points at an admin page that exists', () => {
  const paths = new Set(ADMIN_PAGES.map((p) => p.path));
  for (const group of ADMIN_NAV) for (const [label, href] of group) assert.ok(paths.has(href), `sidebar item ${label} has a page`);
  for (const p of ADMIN_PAGES) {
    for (const match of renderAdminPage(p).matchAll(/href="(\/admin\/[^"#]*)"/g)) {
      assert.ok(paths.has(match[1] ?? ''), `${p.path} links to ${match[1]}, which is not an admin page`);
    }
  }
});

test('form fields have unique ids on each admin page', () => {
  for (const p of ADMIN_PAGES) {
    const ids = [...renderAdminPage(p).matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(ids).size, ids.length, `${p.path} has no repeated id`);
  }
});

test('each dialog is on the page that opens it', () => {
  const byPath = new Map(ADMIN_PAGES.map((p) => [p.path, p]));
  for (const [title, path, id] of ADMIN_DIALOGS) {
    const p = byPath.get(path);
    assert.ok(p, `${title} has a page`);
    const html = renderAdminPage(p);
    assert.ok(html.includes(`<dialog class="adialog" id="${id}"`), `${title} is in the page`);
    assert.ok(html.includes(`data-dialog-open="${id}"`), `${title} has a button that opens it`);
  }
});

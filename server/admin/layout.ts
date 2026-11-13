// The shell shared by every admin page: sidebar, top bar and the page frame.

import { icon } from '../site/components.js';
import { each, esc } from '../site/html.js';

export interface AdminPageOptions {
  title: string;
  /** Address of the sidebar item that is current. */
  current?: string;
  body: string;
  /** Dialogs and other HTML placed after the main content. */
  after?: string;
  /** False for the sign-in page, which has no sidebar. */
  shell?: boolean;
  preview?: boolean;
}

/** Sidebar groups, in the order of the approved design. */
export const ADMIN_NAV: ReadonlyArray<ReadonlyArray<[label: string, href: string]>> = [
  [['Dashboard', '/admin/']],
  [['Orders', '/admin/orders/'], ['Returns', '/admin/returns/'], ['Customers', '/admin/customers/']],
  [['Products', '/admin/products/'], ['Categories and collections', '/admin/categories/'], ['Inventory', '/admin/inventory/'], ['Reviews', '/admin/reviews/']],
  [['Discounts', '/admin/discounts/'], ['Gift cards', '/admin/gift-cards/'], ['Loyalty and referrals', '/admin/loyalty/']],
  [['Live chat inbox', '/admin/chat/']],
  [['Homepage and banners', '/admin/homepage/'], ['Content pages', '/admin/content/']],
  [['Shipping settings', '/admin/shipping/'], ['Payments and currencies', '/admin/payments/'], ['Reports', '/admin/reports/'], ['Staff and roles', '/admin/staff/'], ['Activity log', '/admin/activity/'], ['Store settings', '/admin/settings/']],
];

function logo(): string {
  return `<a class="aside__logo" href="/admin/" aria-label="hairbydemj admin home"><img src="/brand/wordmark.svg" alt="hairbydemj" width="130" height="26"><span class="small muted">Admin</span></a>`;
}

function sidebar(current?: string): string {
  return (
    `<aside class="aside" id="admin-nav" data-aside><div class="aside__head">${logo()}<button class="icon-btn aside__close" type="button" data-aside-close aria-label="Close the menu">${icon('close')}</button></div>` +
    `<nav aria-label="Admin">${each(ADMIN_NAV, (group) => `<ul>${each(group, ([l, h]) => `<li><a href="${h}"${h === current ? ' aria-current="page"' : ''}>${esc(l)}</a></li>`)}</ul>`)}</nav></aside>`
  );
}

function topBar(): string {
  return (
    `<header class="atop"><button class="icon-btn atop__menu" type="button" data-aside-open aria-controls="admin-nav" aria-label="Open the menu">${icon('menu')}</button>` +
    `<form class="atop__search" action="#" role="search">${icon('search', 20)}<label class="visually-hidden" for="admin-q">Search orders, products, customers</label><input id="admin-q" type="search" placeholder="Search orders, products, customers"></form>` +
    `<span class="spacer"></span><button class="icon-btn" type="button" aria-label="Notifications">${icon('bell')}</button>` +
    `<a class="atop__user small" href="/admin/sign-in/">${icon('account', 20)}<span>Staff name · Manager</span></a></header>`
  );
}

/** A complete HTML document for one admin page. */
export function adminPage(o: AdminPageOptions): string {
  const shell = o.shell !== false;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(o.title)} · hairbydemj admin</title>
<meta name="robots" content="noindex">
<meta name="theme-color" content="#040204">
<link rel="icon" href="/brand/monogram.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/source-sans-3-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/fonts.css">
<link rel="stylesheet" href="/css/site.css">
<link rel="stylesheet" href="/css/admin.css">
</head>
<body id="top" class="admin">
<a class="skip" href="#main">Skip to the content</a>
${o.preview ? '<div class="preview-bar"><span>Design preview of the staff admin. All names and figures are samples; nothing is saved.</span><a class="link" href="/designs/">See every page</a></div>' : ''}
<div class="${shell ? 'ashell' : 'ashell ashell--bare'}">
${shell ? sidebar(o.current) : ''}
<div class="amain">
${shell ? topBar() : `<header class="atop">${logo()}</header>`}
<main id="main" class="acontent stack stack--lg">
${o.body}
</main>
</div>
</div>
${shell ? '<div class="scrim" data-scrim></div>' : ''}
${o.after ?? ''}
<p class="atoast" role="status" aria-live="polite" data-toast-box hidden></p>
<script src="/js/admin.js" type="module"></script>
</body>
</html>
`;
}

// The list of admin pages: address, title and the function that renders it.
// The design preview reads from this list; later the admin routes will too.

import { adminPage } from './layout.js';
import * as catalog from './pages/catalog.js';
import * as marketing from './pages/marketing.js';
import * as sales from './pages/sales.js';
import * as settings from './pages/settings.js';

export interface AdminPage {
  path: string;
  title: string;
  group: 'Pages' | 'States';
  /** Sidebar item that is current; defaults to the page's own address. */
  current?: string;
  render: () => string;
  after?: () => string;
  shell?: boolean;
}

export const ADMIN_PAGES: readonly AdminPage[] = [
  { path: '/admin/sign-in/', title: 'Staff sign-in', group: 'Pages', render: sales.signIn, shell: false },
  { path: '/admin/', title: 'Dashboard', group: 'Pages', render: sales.dashboard },
  { path: '/admin/orders/', title: 'Orders', group: 'Pages', render: sales.orders },
  { path: '/admin/orders/hbd-10432/', title: 'Order detail', group: 'Pages', current: '/admin/orders/', render: sales.orderDetail, after: sales.refundDialog },
  { path: '/admin/returns/', title: 'Returns', group: 'Pages', render: sales.returns },
  { path: '/admin/customers/', title: 'Customers', group: 'Pages', render: sales.customers },
  { path: '/admin/products/', title: 'Products', group: 'Pages', render: catalog.products },
  { path: '/admin/products/new/', title: 'Product editor', group: 'Pages', current: '/admin/products/', render: catalog.productEditor },
  { path: '/admin/categories/', title: 'Categories and collections', group: 'Pages', render: catalog.categories },
  { path: '/admin/inventory/', title: 'Inventory', group: 'Pages', render: catalog.inventory, after: catalog.adjustStockDialog },
  { path: '/admin/reviews/', title: 'Reviews', group: 'Pages', render: catalog.reviews },
  { path: '/admin/discounts/', title: 'Discounts', group: 'Pages', render: marketing.discounts },
  { path: '/admin/gift-cards/', title: 'Gift cards', group: 'Pages', render: marketing.giftCards },
  { path: '/admin/loyalty/', title: 'Loyalty and referrals', group: 'Pages', render: marketing.loyalty },
  { path: '/admin/chat/', title: 'Live chat inbox', group: 'Pages', render: marketing.chat },
  { path: '/admin/homepage/', title: 'Homepage and banners', group: 'Pages', render: marketing.homepage },
  { path: '/admin/content/', title: 'Content pages', group: 'Pages', render: marketing.contentPages },
  { path: '/admin/shipping/', title: 'Shipping settings', group: 'Pages', render: settings.shipping },
  { path: '/admin/payments/', title: 'Payments and currencies', group: 'Pages', render: settings.payments },
  { path: '/admin/reports/', title: 'Reports', group: 'Pages', render: settings.reports },
  { path: '/admin/staff/', title: 'Staff and roles', group: 'Pages', render: settings.staff, after: settings.inviteDialog },
  { path: '/admin/activity/', title: 'Activity log', group: 'Pages', render: settings.activity },
  { path: '/admin/settings/', title: 'Store settings', group: 'Pages', render: settings.storeSettings },
  { path: '/admin/orders/empty/', title: 'Orders: empty', group: 'States', current: '/admin/orders/', render: sales.ordersEmpty },
  { path: '/admin/orders/loading/', title: 'Orders: loading', group: 'States', current: '/admin/orders/', render: sales.ordersLoading },
  { path: '/admin/orders/could-not-load/', title: 'Orders: could not load', group: 'States', current: '/admin/orders/', render: sales.ordersError },
];

/** Dialogs, with the page they open on and the id that opens them. */
export const ADMIN_DIALOGS: ReadonlyArray<[title: string, path: string, id: string]> = [
  ['Order detail: refund dialog', '/admin/orders/hbd-10432/', 'refund'],
  ['Inventory: adjust stock dialog', '/admin/inventory/', 'adjust-stock'],
  ['Staff and roles: invite dialog', '/admin/staff/', 'invite'],
];

/** Render one admin page as a full HTML document. */
export function renderAdminPage(p: AdminPage, options: { preview?: boolean } = {}): string {
  return adminPage({ title: p.title, current: p.current ?? p.path, body: p.render(), after: p.after?.(), shell: p.shell, preview: options.preview });
}

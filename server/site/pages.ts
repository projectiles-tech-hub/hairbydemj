// The list of website pages: address, title and the function that renders it.
// The design preview (preview/build.ts) and, later, the website routes both
// read from this list, so there is one source for every page.

import { page } from './layout.js';
import * as account from './pages/account.js';
import * as info from './pages/info.js';
import * as shop from './pages/shopping.js';

export interface SitePage {
  path: string;
  title: string;
  group: 'Shopping' | 'Account' | 'Information and system';
  nav?: string;
  render: () => string;
  after?: () => string;
}

export const SITE_PAGES: readonly SitePage[] = [
  { path: '/', title: 'hairbydemj', group: 'Shopping', render: shop.home },
  { path: '/wigs/', title: 'Wigs', group: 'Shopping', nav: 'Wigs', render: shop.category, after: shop.filtersPanel },
  { path: '/search/', title: 'Search results', group: 'Shopping', render: shop.search },
  { path: '/product/', title: 'Bone straight wig', group: 'Shopping', nav: 'Wigs', render: shop.product },
  { path: '/shop-the-look/', title: 'Shop the look', group: 'Shopping', render: shop.shopTheLook },
  { path: '/try-on/', title: 'Try it on', group: 'Shopping', render: shop.tryOn },
  { path: '/cart/', title: 'Your bag', group: 'Shopping', render: shop.cart },
  { path: '/checkout/', title: 'Checkout', group: 'Shopping', render: shop.checkout },
  { path: '/order-confirmed/', title: 'Order confirmed', group: 'Shopping', render: shop.orderConfirmed },
  { path: '/payment-failed/', title: 'Payment failed', group: 'Shopping', render: shop.paymentFailed },
  { path: '/gift-cards/', title: 'Gift cards', group: 'Shopping', render: shop.giftCards },
  { path: '/sign-in/', title: 'Sign in', group: 'Account', render: account.signIn },
  { path: '/create-account/', title: 'Create account', group: 'Account', render: account.createAccount },
  { path: '/verify-email/', title: 'Verify your email', group: 'Account', render: account.verifyEmail },
  { path: '/forgot-password/', title: 'Forgot password', group: 'Account', render: account.forgotPassword },
  { path: '/account/', title: 'Account overview', group: 'Account', render: account.overview },
  { path: '/account/orders/', title: 'Orders', group: 'Account', render: account.orders },
  { path: '/account/orders/hbd-10432/', title: 'Order detail and tracking', group: 'Account', render: account.orderDetail },
  { path: '/account/returns/', title: 'Returns', group: 'Account', render: account.returns },
  { path: '/account/wishlist/', title: 'Wishlist', group: 'Account', render: account.wishlist },
  { path: '/account/loyalty/', title: 'Loyalty and referrals', group: 'Account', render: account.loyalty },
  { path: '/account/addresses/', title: 'Addresses', group: 'Account', render: account.addresses },
  { path: '/account/payment-methods/', title: 'Payment methods', group: 'Account', render: account.paymentMethods },
  { path: '/account/profile/', title: 'Profile and security', group: 'Account', render: account.profile },
  { path: '/account/reviews/', title: 'My reviews', group: 'Account', render: account.reviews },
  { path: '/account/preferences/', title: 'Communication preferences', group: 'Account', render: account.preferences },
  { path: '/track-order/', title: 'Track your order', group: 'Account', render: account.trackOrder },
  { path: '/about/', title: 'About', group: 'Information and system', render: info.about },
  { path: '/contact/', title: 'Contact', group: 'Information and system', render: info.contact },
  { path: '/faq/', title: 'Questions and answers', group: 'Information and system', nav: 'Help', render: info.faq },
  { path: '/guides/', title: 'Hair guides', group: 'Information and system', nav: 'Guides', render: info.guides },
  { path: '/guides/length-and-density/', title: 'Length and density guide', group: 'Information and system', nav: 'Guides', render: info.lengthGuide },
  { path: '/shipping/', title: 'Shipping and delivery', group: 'Information and system', render: info.shipping },
  { path: '/returns/', title: 'Returns and refunds', group: 'Information and system', render: info.returnsPolicy },
  { path: '/privacy/', title: 'Privacy, Terms, Cookies', group: 'Information and system', render: info.legal },
  { path: '/system/', title: 'System pages', group: 'Information and system', render: info.system },
  { path: '/form-errors/', title: 'Form error states', group: 'Information and system', render: account.formErrors },
];

/** Render one page as a full HTML document. */
export function renderPage(p: SitePage, options: { preview?: boolean } = {}): string {
  return page({ title: p.title, nav: p.nav, body: p.render(), after: p.after?.(), preview: options.preview });
}

/** The "page not found" document. */
export function renderNotFound(options: { preview?: boolean } = {}): string {
  return page({ title: 'Page not found', body: info.notFound(), preview: options.preview });
}

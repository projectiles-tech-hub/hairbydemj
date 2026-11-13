// Every email the store sends: its wording, and the page layout around it.
// Staff can change the subject and the opening paragraph of each in the admin
// (message_templates); everything else is here. Words in {{double braces}}
// are filled in from the email's details and are always escaped.

import { escapeHtml } from '../http.js';

export type Category =
  /** Sign-in and security: always sent. */
  | 'account'
  /** For staff: always sent. */
  | 'staff'
  /** About an order the customer placed: always sent. */
  | 'order'
  /** Delivery progress: the customer can turn these off (orders_email). */
  | 'order_update'
  /** Asked for by the customer: back_in_stock_email. */
  | 'stock'
  /** Offers and reminders: only with marketing consent, and offers_email on. */
  | 'marketing';

export interface Links {
  site: string;
  admin: string;
}

export interface Rendered {
  subject: string;
  heading: string;
  paragraphs: string[];
  /** A code or list shown in a box, kept as typed. */
  block?: string;
  button?: { label: string; url: string };
}

export interface TemplateDef {
  key: string;
  name: string;
  category: Category;
  subject: string;
  intro: string;
  /** Turns the email's details into the finished words. `intro` and `subject` are already filled in. */
  build(data: Record<string, string>, links: Links, filled: { subject: string; intro: string }): Rendered;
}

/** Fill {{words}} from the details. Unknown words become empty. */
export function fill(text: string, data: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => data[key] ?? '');
}

const q = encodeURIComponent;

const RETURN_STATUS: Record<string, string> = {
  requested: 'we have your request',
  approved: 'approved, please send the items back',
  rejected: 'not approved',
  received: 'received, we are checking it',
  refunded: 'refunded',
};

export const TEMPLATES: TemplateDef[] = [
  {
    key: 'verify_email',
    name: 'Verify email code',
    category: 'account',
    subject: 'Your hairbydemj code: {{code}}',
    intro: 'Enter this code to finish setting up your account. It works for {{minutes}} minutes.',
    build: (d, _l, f) => ({ subject: f.subject, heading: 'Verify your email', paragraphs: [f.intro, 'If you did not ask for this, you can ignore this email.'], block: d.code ?? '' }),
  },
  {
    key: 'reset_password',
    name: 'Reset password',
    category: 'account',
    subject: 'Reset your hairbydemj password',
    intro: 'Someone asked to reset the password for your account. If it was you, choose a new password. The link works for {{minutes}} minutes.',
    build: (d, l, f) => ({ subject: f.subject, heading: 'Reset your password', paragraphs: [f.intro, 'If it was not you, ignore this email and your password stays the same.'], button: { label: 'Choose a new password', url: `${l.site}/reset-password/?token=${q(d.token ?? '')}` } }),
  },
  {
    key: 'password_changed',
    name: 'Password changed',
    category: 'account',
    subject: 'Your hairbydemj password was changed',
    intro: 'The password for your account was just changed.',
    build: (_d, l, f) => ({ subject: f.subject, heading: 'Your password was changed', paragraphs: [f.intro, 'If this was not you, reset your password now and contact us.'], button: { label: 'Reset password', url: `${l.site}/forgot-password/` } }),
  },
  {
    key: 'staff_invite',
    name: 'Staff invitation',
    category: 'staff',
    subject: 'You are invited to the hairbydemj admin',
    intro: '{{invitedBy}} has invited you to help run hairbydemj. Set up your sign-in within {{hours}} hours.',
    build: (d, l, f) => ({ subject: f.subject, heading: `Welcome, ${d.name ?? ''}`.trim(), paragraphs: [f.intro, 'You will choose a password and set up an authenticator app for the second step of signing in.'], button: { label: 'Accept the invitation', url: `${l.admin}/invite/?token=${q(d.token ?? '')}` } }),
  },
  {
    key: 'low_stock',
    name: 'Low stock alert (staff)',
    category: 'staff',
    subject: '{{count}} items are running low',
    intro: 'These items are at or below their low-stock level:',
    build: (d, l, f) => ({ subject: f.subject, heading: 'Running low', paragraphs: [f.intro], block: d.items ?? '', button: { label: 'Open products', url: `${l.admin}/products/` } }),
  },
  {
    key: 'order_confirmation',
    name: 'Order received',
    category: 'order',
    subject: 'Order {{orderNumber}} received',
    intro: 'We have your order {{orderNumber}}. We will email you when the payment is confirmed and again when it is on its way.',
    build: (d, l, f) => ({ subject: f.subject, heading: 'Thank you for your order', paragraphs: [f.intro], button: { label: 'View your order', url: `${l.site}/track-order/?order=${q(d.orderNumber ?? '')}&token=${q(d.orderToken ?? '')}` } }),
  },
  {
    key: 'order_update',
    name: 'Order progress (paid, on its way, delivered)',
    category: 'order_update',
    subject: 'Order {{orderNumber}}: {{title}}',
    intro: '{{summary}}',
    build: (d, l, f) => ({ subject: f.subject, heading: d.title ?? 'Your order', paragraphs: [f.intro], button: { label: 'Track your order', url: `${l.site}/track-order/?order=${q(d.orderNumber ?? '')}` } }),
  },
  {
    key: 'order_cancelled',
    name: 'Order cancelled',
    category: 'order',
    subject: 'Order {{orderNumber}} has been cancelled',
    intro: 'Your order {{orderNumber}} has been cancelled: {{reason}}',
    build: (_d, _l, f) => ({ subject: f.subject, heading: 'Your order was cancelled', paragraphs: [f.intro, 'Any payment goes back the way you paid. It can take a few working days to show. Gift card money is back on the card already.'] }),
  },
  {
    key: 'return_update',
    name: 'Return progress',
    category: 'order',
    subject: 'Return {{returnNumber}}: {{statusText}}',
    intro: 'Your return {{returnNumber}} for order {{orderNumber}} is {{statusText}}.',
    build: (d, l, f) => ({ subject: f.subject, heading: 'Your return', paragraphs: [f.intro, ...(d.status === 'approved' ? ['Pack the items with the return number inside and send them back to us.'] : []), ...(d.status === 'refunded' ? ['The money goes back the way you paid. It can take a few working days to show.'] : [])], button: { label: 'View your order', url: `${l.site}/track-order/?order=${q(d.orderNumber ?? '')}` } }),
  },
  {
    key: 'store_credit',
    name: 'Store credit',
    category: 'order',
    subject: 'Your hairbydemj store credit',
    intro: 'Here is your store credit of {{amount}} for return {{returnNumber}}. Use this code at checkout:',
    build: (d, l, f) => ({ subject: f.subject, heading: 'Your store credit', paragraphs: [f.intro, 'Keep this email: the code is like money.'], block: d.code ?? '', button: { label: 'Start shopping', url: `${l.site}/` } }),
  },
  {
    key: 'gift_card',
    name: 'Gift card (to the person receiving it)',
    category: 'order',
    subject: 'A hairbydemj gift card for you',
    intro: '{{from}} sent you a hairbydemj gift card of {{amount}}. Use this code at checkout, on the website or in the app:',
    build: (d, l, f) => ({ subject: f.subject, heading: 'A gift card for you', paragraphs: [f.intro, ...(d.message ? [`Their message: "${d.message}"`] : []), 'Keep this email: the code is like money. You can check the balance on our gift cards page.'], block: d.code ?? '', button: { label: 'Start shopping', url: `${l.site}/` } }),
  },
  {
    key: 'review_reply',
    name: 'Reply to a review',
    category: 'order',
    subject: 'We replied to your review',
    intro: 'Thank you for reviewing {{productName}}. We have replied:',
    build: (d, l, f) => ({ subject: f.subject, heading: 'Our reply to your review', paragraphs: [f.intro, `"${d.reply ?? ''}"`], button: { label: 'See your reviews', url: `${l.site}/account/reviews/` } }),
  },
  {
    key: 'back_in_stock',
    name: 'Back in stock',
    category: 'stock',
    subject: '{{productName}} is back in stock',
    intro: 'Good news: {{productName}} {{variant}} is back. Stock is limited.',
    build: (d, l, f) => ({ subject: f.subject, heading: 'It is back', paragraphs: [f.intro], button: { label: 'Shop now', url: `${l.site}/products/${q(d.slug ?? '')}/` } }),
  },
  {
    key: 'abandoned_cart',
    name: 'Bag reminder',
    category: 'marketing',
    subject: 'You left something in your bag',
    intro: 'Hi {{firstName}}, your bag is still waiting with {{itemCount}} items. Stock moves quickly.',
    build: (_d, l, f) => ({ subject: f.subject, heading: 'Still thinking it over?', paragraphs: [f.intro], button: { label: 'Go to your bag', url: `${l.site}/cart/` } }),
  },
  {
    key: 'newsletter_welcome',
    name: 'Newsletter welcome',
    category: 'marketing',
    subject: 'Welcome to hairbydemj',
    intro: 'You will hear about new hair, offers and hair guides first.',
    build: (_d, l, f) => ({ subject: f.subject, heading: 'You are on the list', paragraphs: [f.intro, 'You can unsubscribe at any time with the link below.'], button: { label: 'Shop new arrivals', url: `${l.site}/` } }),
  },
];

export const TEMPLATE_KEYS = TEMPLATES.map((t) => t.key);

export function templateFor(key: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.key === key);
}

export function returnStatusText(status: string): string {
  return RETURN_STATUS[status] ?? status;
}

/** The email page: a dark band with the name in gold, a light card with the words, a quiet footer. */
export function layoutHtml(r: Rendered, footer: { address: string; unsubscribeUrl: string | null; preferencesUrl: string }): string {
  const e = escapeHtml;
  const p = r.paragraphs.filter(Boolean).map((t) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:#2f2119">${e(t)}</p>`).join('');
  const block = r.block ? `<div style="margin:8px 0 20px;padding:16px;background:#f3ebe0;border-radius:8px;font-family:Menlo,Consolas,monospace;font-size:${r.block.length <= 24 ? '24px;letter-spacing:2px' : '14px'};color:#040204;white-space:pre-wrap">${e(r.block)}</div>` : '';
  const button = r.button ? `<p style="margin:24px 0 8px"><a href="${e(r.button.url)}" style="display:inline-block;background:#cfa262;color:#040204;text-decoration:none;font-weight:600;font-size:16px;padding:14px 24px;border-radius:999px">${e(r.button.label)}</a></p>` : '';
  const unsubscribe = footer.unsubscribeUrl ? ` <a href="${e(footer.unsubscribeUrl)}" style="color:#80766a">Unsubscribe</a>.` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${e(r.subject)}</title></head>
<body style="margin:0;padding:0;background:#faf6f0;font-family:'Source Sans 3',Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf6f0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px">
<tr><td style="background:#040204;border-radius:12px 12px 0 0;padding:20px 28px"><span style="font-family:'Cormorant Garamond',Georgia,serif;font-size:26px;color:#cfa262;letter-spacing:1px">hairbydemj</span></td></tr>
<tr><td style="background:#ffffff;border-radius:0 0 12px 12px;padding:28px">
<h1 style="margin:0 0 16px;font-family:'Cormorant Garamond',Georgia,serif;font-weight:600;font-size:28px;line-height:1.2;color:#040204">${e(r.heading)}</h1>
${p}${block}${button}
</td></tr>
<tr><td style="padding:20px 8px;font-size:13px;line-height:1.5;color:#80766a">${e(footer.address)}. <a href="${e(footer.preferencesUrl)}" style="color:#80766a">Email preferences</a>.${unsubscribe}</td></tr>
</table></td></tr></table></body></html>`;
}

export function layoutText(r: Rendered, footer: { address: string; unsubscribeUrl: string | null; preferencesUrl: string }): string {
  return [
    r.heading,
    '',
    ...r.paragraphs.filter(Boolean).flatMap((t) => [t, '']),
    ...(r.block ? [r.block, ''] : []),
    ...(r.button ? [`${r.button.label}: ${r.button.url}`, ''] : []),
    '--',
    footer.address,
    `Email preferences: ${footer.preferencesUrl}`,
    ...(footer.unsubscribeUrl ? [`Unsubscribe: ${footer.unsubscribeUrl}`] : []),
  ].join('\n');
}

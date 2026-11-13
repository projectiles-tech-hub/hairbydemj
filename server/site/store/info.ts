// Information pages (about, help, policies), the sitemap, robots.txt and the
// "not found" page. Each information page shows what staff wrote for it in
// the admin (content_pages) once published; until then, the starting text here.

import { esc } from '../html.js';
import { button, card } from '../components.js';
import { returnSettings } from '../../orders/orders.js';
import type { SiteContext } from './view.js';

interface Starting {
  title: string;
  description: string;
  nav?: string;
  /** Paragraphs; a line starting with "## " is a heading; "Q: ...\nA: ..." pairs make questions. */
  body: (vars: { windowDays: number; email: string }) => string;
}

/** Starting text for each page, written from the owner's decisions so far. Staff replace it in the admin. */
const PAGES: Record<string, Starting> = {
  about: {
    title: 'Our story',
    description: 'hairbydemj sells human hair wigs, bundles and closures from Benin City to customers everywhere.',
    body: () => `hairbydemj sells human hair wigs, bundles, closures and frontals, chosen and checked in Benin City, Nigeria, and sent to customers wherever they live.

## What we promise
Hair that is what we say it is: the length, density, texture and origin on every product page. Exact stock, so what you order is on the shelf. Clear prices, with delivery worked out for your address before you pay.

## Where we send
Anywhere in Nigeria by local courier, and around the world with DHL, UPS and FedEx.`,
  },
  contact: {
    title: 'Contact us',
    description: 'How to reach hairbydemj about an order, a return or a product.',
    nav: 'Help',
    body: (v) => `We are glad to help with orders, returns and choosing the right hair.

## Email
${v.email}

## Your order
Find your order with its number and email on the track-an-order page, or sign in to see all your orders.

## Hours
Monday to Saturday, 9:00 to 18:00, Lagos time.`,
  },
  faq: {
    title: 'Questions and answers',
    description: 'Delivery, duties, payment, returns and choosing hair at hairbydemj.',
    nav: 'Help',
    body: (v) => `Q: How long does delivery take?
A: The time for your address shows at checkout before you pay. Inside Nigeria it depends on your state; abroad it depends on the carrier and service you choose.

Q: Do I pay customs duties?
A: If your parcel goes outside Nigeria, your country may charge import duties or taxes. They are not in our price; the carrier asks you for them when the parcel arrives.

Q: How can I pay?
A: In naira: card, bank transfer or USSD through Paystack. In dollars, pounds or euros: card, Apple Pay or Google Pay through Stripe. Gift cards work in both.

Q: How do I return something?
A: Ask from your order page within ${v.windowDays} days of delivery. Choose money back or store credit with a bonus. Final-sale items can only come back if they arrived wrong or damaged.

Q: Is the stock shown real?
A: Yes. The number you see is what is on our shelf right now, less what other customers are paying for.`,
  },
  guides: {
    title: 'Hair guides',
    description: 'Guides to choosing, wearing and caring for human hair.',
    nav: 'Guides',
    body: () => `## Choosing a length and density
See the length and density guide for where each length falls and how full each density looks.

## Caring for human hair
Wash gently with a sulphate-free shampoo, condition from the middle to the ends, and let it dry in the air where you can. Comb from the ends upwards. Sleep in a silk bonnet or on a silk pillowcase.`,
  },
  'length-and-density': {
    title: 'Length and density guide',
    description: 'How long each hair length is and how full each density looks.',
    nav: 'Guides',
    body: () => `## Length
Length is measured straight, from the top of the hair to the end. Curly and wavy hair looks shorter than its length because of the curl.

12 to 14 inches: around the chin to the shoulders.
16 to 18 inches: past the shoulders.
20 to 22 inches: to the middle of the back.
24 inches and longer: to the lower back.

## Density
Density is how full the hair is. 150% looks natural; 180% is fuller; 200% and above is very full and glamorous.`,
  },
  shipping: {
    title: 'Shipping and delivery',
    description: 'How hairbydemj delivers in Nigeria and abroad, and who pays import duties.',
    body: () => `## Inside Nigeria
We deliver to every state with local couriers. The price and time for your state show at checkout.

## Abroad
We send with DHL Express, UPS and FedEx. At checkout you see live prices and delivery times for your address and choose the one you want.

## Import duties and taxes
Our prices and delivery charges do not include import duties or taxes. If your country charges them, the carrier collects them from you when the parcel arrives.

## Tracking
You get the tracking number by email as soon as your parcel leaves us, and you can follow it on your order page.`,
  },
  returns: {
    title: 'Returns and refunds',
    description: 'How to return an item to hairbydemj and how refunds work.',
    body: (v) => `## How long you have
You can ask for a return within ${v.windowDays} days of delivery, from your order page.

## What can come back
Unworn hair in its original packaging. Final-sale items can only come back if they arrived wrong or damaged.

## How it works
We reply to your request, you send the items back, we check them, and then refund you. Money goes back the way you paid; any part paid with a gift card goes back onto the card. You can choose store credit instead, with a bonus.

## Delivery charges
The delivery charge is refunded when the return is because of our mistake.`,
  },
  privacy: {
    title: 'Privacy',
    description: 'What hairbydemj keeps about you and why.',
    body: () => `## What we keep
Your name, email, phone and addresses so we can deliver your orders; your orders and payments' status (never your card number, which stays with Paystack or Stripe); and your choices about emails.

## Who we share it with
Only those who need it to get your order to you: the payment provider, and the courier or carrier delivering it.

## Your choices
You can change what emails you get in your account, unsubscribe from offers from any offers email, and close your account at any time.`,
  },
  terms: {
    title: 'Terms',
    description: 'The terms of buying from hairbydemj.',
    body: () => `## Orders
An order is accepted when the payment is confirmed. If an item sells out before then, we tell you and nothing is charged; if a payment arrives late for an item that has sold out, we refund it in full.

## Prices
Prices are shown in the currency you choose. Delivery is added at checkout. Import duties and taxes abroad are paid by you on delivery.

## Returns
See the returns page.`,
  },
  cookies: {
    title: 'Cookies',
    description: 'The cookies hairbydemj uses.',
    body: () => `We only use cookies that the shop needs to work.

## The cookies
hbd_cart keeps your bag. hbd_session keeps you signed in. hbd_currency remembers the currency you chose. hbd_cookies remembers that you have seen the cookie notice.

We do not use advertising or tracking cookies.`,
  },
};

/** Turn plain page text into HTML: headings, questions and paragraphs, all escaped. */
export function textToHtml(text: string): string {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return blocks
    .map((b) => {
      const qa = /^Q:\s*(.+)\nA:\s*([\s\S]+)$/.exec(b);
      if (qa) return `<details class="acc"><summary>${esc(qa[1] ?? '')}</summary><div class="acc__body"><p>${esc(qa[2] ?? '')}</p></div></details>`;
      const lines = b.split('\n');
      const out: string[] = [];
      let para: string[] = [];
      const flush = (): void => {
        if (para.length) out.push(`<p class="muted">${para.map(esc).join('<br>')}</p>`);
        para = [];
      };
      for (const line of lines) {
        if (line.startsWith('## ')) {
          flush();
          out.push(`<h2 class="h3">${esc(line.slice(3))}</h2>`);
        } else para.push(line);
      }
      flush();
      return `<section class="stack stack--sm">${out.join('')}</section>`;
    })
    .join('');
}

export const INFO_SLUGS = Object.keys(PAGES);

export async function infoPage(sc: SiteContext, slug: string): Promise<{ title: string; description: string; nav?: string; canonical: string; body: string } | null> {
  const start = PAGES[slug];
  const row = (await sc.deps.db.query("select title, body, search_description from content_pages where slug = $1 and status = 'published'", [slug])).rows[0];
  if (!start && !row) return null;
  const store = (await sc.deps.db.query("select value from store_settings where key = 'store'")).rows[0]?.value as { support_email?: string } | undefined;
  const email = store?.support_email || sc.deps.config.mail.replyTo || 'hello@hairbydemj.com';
  const vars = { windowDays: (await returnSettings(sc.deps.db)).windowDays, email: email.replace(/^.*<([^>]+)>.*$/, '$1') };
  const title = String(row?.title ?? start?.title ?? slug);
  const text = row ? String(row.body) : (start?.body(vars) ?? '');
  const path = slug === 'length-and-density' ? '/guides/length-and-density/' : `/${slug}/`;
  const extra =
    slug === 'contact'
      ? card(`${button('Track an order', { kind: 'secondary', href: '/track-order/', full: true })}${button('Questions and answers', { kind: 'secondary', href: '/faq/', full: true })}`, { title: 'Quick help' })
      : slug === 'guides'
        ? card(`<a class="link" href="/guides/length-and-density/">Length and density guide</a>`)
        : '';
  return {
    title,
    description: String(row?.search_description ?? start?.description ?? ''),
    nav: start?.nav,
    canonical: path,
    body: `<h1 class="h1">${esc(title)}</h1><div class="split" style="--side:300px;--side-tablet:260px"><div class="stack stack--lg">${textToHtml(text)}</div><div class="stack">${extra}</div></div>`,
  };
}

/** Every page search engines should know about. */
export async function sitemapXml(sc: SiteContext): Promise<string> {
  const products = await sc.deps.db.query("select slug, updated_at from products where status = 'published' or (status = 'scheduled' and publish_at <= $1) order by id", [sc.now]);
  const looks = await sc.deps.db.query("select slug from collections where status = 'live' and is_look order by id");
  const flat = (nodes: SiteContext['categories']): string[] => nodes.flatMap((n) => [n.slug, ...flat(n.children)]);
  const urls: Array<[string, string | null]> = [
    ['/', null],
    ...flat(sc.categories).map((s): [string, null] => [`/c/${s}/`, null]),
    ...products.rows.map((r): [string, string] => [`/products/${String(r.slug)}/`, (r.updated_at as Date).toISOString().slice(0, 10)]),
    ['/looks/', null],
    ...looks.rows.map((r): [string, null] => [`/looks/${String(r.slug)}/`, null]),
    ...INFO_SLUGS.map((s): [string, null] => [s === 'length-and-density' ? '/guides/length-and-density/' : `/${s}/`, null]),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, d]) => `<url><loc>${esc(sc.origin + u)}</loc>${d ? `<lastmod>${d}</lastmod>` : ''}</url>`).join('\n')}\n</urlset>\n`;
}

export function robotsTxt(origin: string): string {
  return `User-agent: *\nDisallow: /api/\nDisallow: /account/\nDisallow: /cart/\nDisallow: /checkout/\nDisallow: /track-order/\nDisallow: /unsubscribe\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}

export function notFoundBody(): string {
  return `<div class="stack center narrow" style="align-items:center;padding:48px 0"><h1 class="h1">We could not find that page</h1><p class="muted">It may have moved, or the address may be mistyped.</p>${button('Go to the home page', { href: '/' })}<form class="row row--nowrap" action="/search/" role="search" style="width:100%;align-items:flex-end"><div class="field grow"><label class="field__label" for="nf-q">Search the shop</label><input class="field__input" id="nf-q" name="q" type="search"></div>${button('Search', { kind: 'secondary', type: 'submit' })}</form></div>`;
}

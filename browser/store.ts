// Browser script for the live website. Plain TypeScript, no framework.
// Every page works without it; this makes the bag, checkout, search and
// forms quicker and smoother.

export {};

type Json = Record<string, any>;

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => Array.from(root.querySelectorAll<T>(sel));
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const signedIn = document.body.hasAttribute('data-signed-in');
const currency = document.body.dataset.currency ?? 'NGN';

class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly fields: Record<string, string>,
  ) {
    super(message);
  }
}

/** Call our own API. Errors come back as ApiFailure with the server's words. */
async function api(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Json> {
  let response: Response;
  try {
    response = await fetch(path, { method, credentials: 'same-origin', headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiFailure('We could not reach the shop. Check your connection and try again.', 0, 'offline', {});
  }
  const data = (await response.json().catch(() => ({}))) as Json;
  if (!response.ok) {
    const e = (data.error ?? {}) as Json;
    throw new ApiFailure(String(e.message ?? 'Something went wrong. Please try again.'), response.status, String(e.code ?? ''), (e.fields ?? {}) as Record<string, string>);
  }
  return data;
}

function say(el: Element | null, text: string): void {
  if (el) el.textContent = text;
}

// ----- panels: menu, mini-bag, currency, filters -----

const scrim = $('[data-scrim]');
let lastFocus: HTMLElement | null = null;

function closePanels(): void {
  $$('[data-panel].is-open').forEach((p) => p.classList.remove('is-open'));
  scrim?.classList.remove('is-open');
  document.body.style.overflow = '';
  lastFocus?.focus();
  lastFocus = null;
}

function openPanel(id: string, opener: HTMLElement | null): void {
  const panel = document.getElementById(id);
  if (!panel) return;
  closePanels();
  lastFocus = opener;
  panel.classList.add('is-open');
  scrim?.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  ($<HTMLElement>('[data-close]', panel) ?? $<HTMLElement>('input, select, button, a', panel))?.focus();
  if (id === 'mini-cart') void refreshMiniCart();
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const opener = target.closest<HTMLElement>('[data-open]');
  if (opener?.dataset.open) {
    event.preventDefault();
    openPanel(opener.dataset.open, opener);
    return;
  }
  if (target.closest('[data-close]') || target === scrim) closePanels();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closePanels();
    hideSuggest();
  }
});

if (window.matchMedia('(max-width: 1023px)').matches) $$<HTMLDetailsElement>('.site-footer details').forEach((d) => (d.open = false));

// ----- cookie notice -----

const cookieBox = $('[data-cookie]');
if (cookieBox && !document.cookie.split('; ').some((c) => c.startsWith('hbd_cookies='))) cookieBox.hidden = false;
$$('[data-cookie-accept]').forEach((b) =>
  b.addEventListener('click', () => {
    document.cookie = `hbd_cookies=1; Path=/; Max-Age=${365 * 86400}; SameSite=Lax`;
    if (cookieBox) cookieBox.hidden = true;
  }),
);

// ----- currency -----

$<HTMLFormElement>('[data-currency-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const chosen = $<HTMLInputElement>('input[name="currency"]:checked', event.currentTarget as HTMLFormElement)?.value;
  if (!chosen) return;
  document.cookie = `hbd_currency=${encodeURIComponent(chosen)}; Path=/; Max-Age=${365 * 86400}; SameSite=Lax`;
  await api('POST', '/api/cart/currency', { currency: chosen }).catch(() => undefined);
  location.reload();
});

// ----- the bag -----

function setBagCount(count: number): void {
  $$('[data-bag-count]').forEach((el) => {
    el.textContent = String(count);
    el.hidden = count === 0;
  });
  $$('[data-bag-count-text]').forEach((el) => (el.textContent = String(count)));
  $('[data-bag-button]')?.setAttribute('aria-label', `Your bag, ${count} ${count === 1 ? 'item' : 'items'}`);
}

async function refreshMiniCart(): Promise<void> {
  const body = $('[data-mini-cart-body]');
  if (!body) return;
  try {
    const data = await api('GET', '/api/site/mini-cart');
    body.innerHTML = String(data.html);
    setBagCount(Number(data.count));
  } catch (error) {
    body.innerHTML = `<p class="muted">${esc((error as Error).message)}</p>`;
  }
}

async function addToBag(variantId: number, quantity: number): Promise<void> {
  await api('POST', '/api/cart/items', { variantId, quantity });
  openPanel('mini-cart', null);
}

// Quantity and remove, in the mini-bag and on the bag page.
document.addEventListener('change', async (event) => {
  const input = (event.target as HTMLElement).closest<HTMLInputElement>('[data-qty]');
  if (!input) return;
  const quantity = Math.max(1, Math.min(20, Number(input.value) || 1));
  try {
    await api('POST', `/api/cart/items/${input.dataset.qty}`, { quantity });
    if ($('[data-cart]')) location.reload();
    else void refreshMiniCart();
  } catch (error) {
    say($('[data-cart-error]'), (error as Error).message);
    if (!$('[data-cart]')) alertIn($('[data-mini-cart-body]'), (error as Error).message);
  }
});
document.addEventListener('click', async (event) => {
  const remove = (event.target as HTMLElement).closest<HTMLElement>('[data-remove]');
  if (!remove) return;
  await api('POST', `/api/cart/items/${remove.dataset.remove}/delete`, {}).catch(() => undefined);
  if ($('[data-cart]')) location.reload();
  else void refreshMiniCart();
});

function alertIn(where: Element | null, text: string): void {
  if (!where) return;
  const p = document.createElement('p');
  p.className = 'small';
  p.setAttribute('role', 'alert');
  p.textContent = text;
  where.prepend(p);
}

// Codes on the bag page.
$<HTMLFormElement>('[data-code-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = (new FormData(event.currentTarget as HTMLFormElement).get('code') ?? '').toString().trim();
  try {
    await api('POST', '/api/cart/discount', { code });
    location.reload();
  } catch (error) {
    say($('[data-cart-error]'), (error as Error).message);
  }
});
$('[data-remove-code]')?.addEventListener('click', async () => {
  await api('POST', '/api/cart/discount/delete', {}).catch(() => undefined);
  location.reload();
});
$<HTMLFormElement>('[data-gift-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = (new FormData(event.currentTarget as HTMLFormElement).get('code') ?? '').toString().trim();
  try {
    await api('POST', '/api/cart/gift-cards', { code });
    location.reload();
  } catch (error) {
    say($('[data-cart-error]'), (error as Error).message);
  }
});
$$('[data-remove-gift]').forEach((b) =>
  b.addEventListener('click', async () => {
    await api('POST', `/api/cart/gift-cards/${b.dataset.removeGift}/delete`, {}).catch(() => undefined);
    location.reload();
  }),
);

// ----- product page: choosing a variant and adding it -----

interface Variant {
  id: number;
  lengthInches: number | null;
  densityPercent: number | null;
  laceType: string | null;
  colour: string | null;
  price: string;
  was: string | null;
  available: number;
  lowStock: boolean;
}

const productForm = $<HTMLFormElement>('[data-product-form]');
if (productForm) {
  const variants = JSON.parse($('#variants')?.textContent ?? '[]') as Variant[];
  const dims = $$<HTMLFieldSetElement>('[data-dim]', productForm).map((f) => f.dataset.dim as keyof Variant);
  const current = (): Variant | undefined => {
    const picked: Record<string, string> = {};
    for (const d of dims) picked[d] = $<HTMLInputElement>(`input[name="${d}"]:checked`, productForm)?.value ?? '';
    return variants.find((v) => dims.every((d) => String(v[d] ?? '') === picked[d]));
  };
  const update = (): void => {
    const v = current();
    const add = $<HTMLButtonElement>('[data-add]', productForm);
    const hidden = $<HTMLInputElement>('[data-variant-id]', productForm);
    if (!v) {
      say($('[data-stock]', productForm), 'This combination is not made. Choose another.');
      if (add) add.disabled = true;
      return;
    }
    if (hidden) hidden.value = String(v.id);
    say($('[data-price]', productForm), v.price);
    say($('[data-price-sticky]'), v.price);
    const was = $('[data-was]', productForm);
    if (was) {
      was.hidden = !v.was;
      was.textContent = v.was ?? '';
    }
    say($('[data-stock]', productForm), v.available === 0 ? 'Sold out' : v.lowStock ? `Only ${v.available} left` : `${v.available} in stock`);
    if (add) add.disabled = v.available === 0;
    const qty = $<HTMLInputElement>('input[name="quantity"]', productForm);
    if (qty) qty.max = String(Math.max(1, Math.min(20, v.available)));
  };
  productForm.addEventListener('change', update);
  update();
  productForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const v = current();
    if (!v) return;
    const quantity = Number($<HTMLInputElement>('input[name="quantity"]', productForm)?.value || 1);
    try {
      say($('[data-add-status]', productForm), '');
      await addToBag(v.id, quantity);
    } catch (error) {
      say($('[data-add-status]', productForm), (error as Error).message);
    }
  });
  $('[data-add-sticky]')?.addEventListener('click', () => productForm.requestSubmit());
  // Gallery: a thumbnail becomes the big photo.
  const gallery = $('[data-gallery]');
  $$('[data-thumb]', gallery ?? document).forEach((thumb) =>
    thumb.addEventListener('click', () => {
      const main = gallery?.firstElementChild;
      const pic = $('picture', thumb);
      if (!main || !pic) return;
      const copy = pic.cloneNode(true) as HTMLElement;
      $$('source, img', copy).forEach((el) => el.setAttribute('sizes', '(max-width: 1023px) 100vw, 50vw'));
      const img = $<HTMLImageElement>('img', copy);
      if (img) img.alt = `Photo ${Number(thumb.dataset.thumb) + 1}`;
      copy.setAttribute('style', main.getAttribute('style') ?? '');
      main.replaceWith(copy);
    }),
  );
}

// Shop the look: the whole set in one go.
$$('[data-add-set]').forEach((b) =>
  b.addEventListener('click', async () => {
    const ids = JSON.parse(b.dataset.addSet ?? '[]') as number[];
    try {
      for (const id of ids) await api('POST', '/api/cart/items', { variantId: id, quantity: 1 });
      openPanel('mini-cart', b);
    } catch (error) {
      say($('[data-add-status]'), (error as Error).message);
    }
  }),
);

// ----- wishlist -----

document.addEventListener('click', async (event) => {
  const wish = (event.target as HTMLElement).closest<HTMLElement>('[data-wish]');
  if (wish) {
    event.preventDefault();
    if (!signedIn) {
      location.href = `/sign-in/?next=${encodeURIComponent(location.pathname)}`;
      return;
    }
    const on = wish.getAttribute('aria-pressed') === 'true';
    try {
      if (on) await api('POST', `/api/wishlist/${wish.dataset.wish}/delete`, {});
      else await api('POST', '/api/wishlist', { productId: Number(wish.dataset.wish) });
      wish.setAttribute('aria-pressed', on ? 'false' : 'true');
    } catch {
      // the button stays as it was
    }
    return;
  }
  const unwish = (event.target as HTMLElement).closest<HTMLElement>('[data-unwish]');
  if (unwish) {
    await api('POST', `/api/wishlist/${unwish.dataset.unwish}/delete`, {}).catch(() => undefined);
    unwish.closest('article')?.remove();
  }
});

// ----- search suggestions -----

const searchForm = $<HTMLFormElement>('[data-search]');
const searchInput = $<HTMLInputElement>('input[name="q"]', searchForm ?? document);
const suggestBox = $('#suggest');
let suggestTimer = 0;
let suggestIndex = -1;

function hideSuggest(): void {
  if (suggestBox) suggestBox.hidden = true;
  searchInput?.setAttribute('aria-expanded', 'false');
  suggestIndex = -1;
}

searchInput?.addEventListener('input', () => {
  window.clearTimeout(suggestTimer);
  const q = searchInput.value.trim();
  if (q.length < 2) return hideSuggest();
  suggestTimer = window.setTimeout(async () => {
    try {
      const s = await api('GET', `/api/catalog/search/suggest?q=${encodeURIComponent(q)}&currency=${encodeURIComponent(currency)}`);
      if (!suggestBox) return;
      const items: string[] = [
        ...(s.terms as string[]).map((t) => `<a role="option" href="/search/?q=${encodeURIComponent(t)}">${esc(t)}</a>`),
        ...(s.categories as Json[]).map((c) => `<a role="option" href="/c/${encodeURIComponent(c.slug)}/">${esc(c.name)} <span class="small muted">category</span></a>`),
        ...(s.products as Json[]).map((p) => `<a role="option" href="/products/${encodeURIComponent(p.slug)}/">${esc(p.name)}</a>`),
      ];
      suggestBox.innerHTML = items.join('');
      suggestBox.hidden = items.length === 0;
      searchInput.setAttribute('aria-expanded', items.length ? 'true' : 'false');
      suggestIndex = -1;
    } catch {
      hideSuggest();
    }
  }, 200);
});
searchInput?.addEventListener('keydown', (event) => {
  const options = $$<HTMLAnchorElement>('[role="option"]', suggestBox ?? document);
  if (!options.length || suggestBox?.hidden) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    suggestIndex = (suggestIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options.forEach((o, i) => o.setAttribute('aria-selected', i === suggestIndex ? 'true' : 'false'));
  } else if (event.key === 'Enter' && suggestIndex >= 0) {
    event.preventDefault();
    options[suggestIndex]?.click();
  }
});
document.addEventListener('click', (event) => {
  if (!(event.target as HTMLElement).closest('[data-search]')) hideSuggest();
});

// ----- product lists: filters apply on change; more products without leaving the page -----

$$<HTMLFormElement>('[data-filters]').forEach((form) =>
  form.addEventListener('change', (event) => {
    const t = event.target as HTMLInputElement;
    if (t.type === 'checkbox' || t.tagName === 'SELECT') form.requestSubmit();
  }),
);

document.addEventListener('click', async (event) => {
  const more = (event.target as HTMLElement).closest<HTMLAnchorElement>('[data-more]');
  if (!more) return;
  event.preventDefault();
  const params = new URLSearchParams(location.search);
  params.set('cursor', more.dataset.more ?? '');
  const category = /^\/c\/([^/]+)\//.exec(location.pathname)?.[1];
  if (category) params.set('category', category);
  more.setAttribute('aria-busy', 'true');
  try {
    const data = await api('GET', `/api/site/products?${params.toString()}`);
    $('#product-list')?.insertAdjacentHTML('beforeend', String(data.html));
    if (data.nextCursor) {
      more.dataset.more = String(data.nextCursor);
      params.set('cursor', String(data.nextCursor));
      more.href = `${location.pathname}?${params.toString()}`;
    } else more.closest('[data-more-wrap]')?.remove();
  } catch (error) {
    alertIn(more.parentElement, (error as Error).message);
  } finally {
    more.removeAttribute('aria-busy');
  }
});

// ----- forms sent as JSON (account pages) -----

function formValues(form: HTMLFormElement): Json {
  const out: Json = {};
  $$<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea', form).forEach((el) => {
    const key = el.dataset.key ?? el.name;
    if (!key || (el instanceof HTMLInputElement && el.type === 'radio' && !el.checked)) return;
    if (el instanceof HTMLInputElement && el.type === 'checkbox') out[key] = el.checked;
    else out[key] = el.value;
  });
  return out;
}

function showErrors(form: HTMLFormElement, error: ApiFailure): void {
  $$('[data-error-for]', form).forEach((el) => {
    el.hidden = true;
    el.textContent = '';
  });
  let shown = false;
  for (const [field, message] of Object.entries(error.fields)) {
    const el = $(`[data-error-for="${CSS.escape(field)}"]`, form) ?? $$('[data-error-for]', form).find((e) => (e.dataset.errorFor ?? '').startsWith(`${field}-`)) ?? null;
    if (el) {
      el.textContent = message;
      el.hidden = false;
      shown = true;
    }
  }
  say($('[data-form-error]', form), shown ? 'Check the highlighted details.' : error.message);
}

$$<HTMLFormElement>('[data-json-form]').forEach((form) =>
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) return;
    const values = formValues(form);
    const button = $<HTMLButtonElement>('button[type="submit"]', form);
    if (button) button.disabled = true;
    say($('[data-form-error]', form), '');
    try {
      await api('POST', form.dataset.jsonForm ?? '', values);
      if (form.dataset.next) location.href = form.dataset.next.replace('{email}', encodeURIComponent(String(values.email ?? '')));
      else if (form.hasAttribute('data-reload')) location.reload();
      else {
        say($('[data-form-ok]', form), 'Done.');
        const okText = form.nextElementSibling;
        if (okText instanceof HTMLElement && okText.hasAttribute('data-ok-text')) okText.hidden = false;
      }
    } catch (error) {
      if (error instanceof ApiFailure) showErrors(form, error);
    } finally {
      if (button) button.disabled = false;
    }
  }),
);

$$('[data-sign-out]').forEach((b) =>
  b.addEventListener('click', async () => {
    await api('POST', '/api/auth/sign-out', {}).catch(() => undefined);
    location.href = '/';
  }),
);
$$('[data-delete-address]').forEach((b) =>
  b.addEventListener('click', async () => {
    if (!window.confirm('Remove this address?')) return;
    await api('POST', `/api/account/addresses/${b.dataset.deleteAddress}/delete`, {}).catch(() => undefined);
    location.reload();
  }),
);

// Google sign-in: Google calls this with a signed token, which our server checks.
(window as unknown as { hbdGoogle: (r: { credential: string }) => void }).hbdGoogle = async (r) => {
  try {
    await api('POST', '/api/auth/google', { idToken: r.credential });
    location.href = $('#g_id_onload')?.dataset.next ?? '/account/';
  } catch (error) {
    say($('[data-form-error]'), (error as Error).message);
  }
};

// Newsletter.
$<HTMLFormElement>('[data-newsletter]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const email = (new FormData(form).get('email') ?? '').toString().trim();
  try {
    await api('POST', '/api/newsletter', { email });
    say($('[data-newsletter-status]', form), 'Thank you. You are on the list.');
    form.reset();
  } catch (error) {
    say($('[data-newsletter-status]', form), (error as Error).message);
  }
});

// ----- paying -----

interface StripeLike {
  elements(o: { clientSecret: string; appearance?: unknown }): { create(kind: string): { mount(el: Element): void } };
  confirmPayment(o: { elements: unknown; confirmParams: { return_url: string } }): Promise<{ error?: { message?: string } }>;
}

const orderHeaders = (token: string | null): Record<string, string> => (token ? { 'X-Order-Token': token } : {});

/** Start paying for an order: Paystack goes to its payment page; Stripe shows its form here. */
async function pay(number: string, token: string | null, place: Element | null, errorBox: Element | null): Promise<void> {
  const start = (await api('POST', `/api/orders/${encodeURIComponent(number)}/pay`, {}, orderHeaders(token))).payment as Json;
  if (start.provider === 'paystack') {
    location.assign(String(start.authorizationUrl));
    return;
  }
  const StripeFn = (window as unknown as { Stripe?: (key: string) => StripeLike }).Stripe;
  if (!StripeFn || !place) throw new ApiFailure('The card form could not load. Refresh the page and try again.', 0, 'no_stripe', {});
  const stripe = StripeFn(String(start.publicKey));
  const elements = stripe.elements({ clientSecret: String(start.clientSecret), appearance: { theme: 'night', variables: { colorPrimary: '#cfa262' } } });
  (place as HTMLElement).hidden = false;
  place.innerHTML = '';
  const holder = document.createElement('div');
  place.append(holder);
  elements.create('payment').mount(holder);
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = 'btn btn--primary';
  confirm.textContent = 'Pay now';
  place.append(confirm);
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    const result = await stripe.confirmPayment({ elements, confirmParams: { return_url: `${location.origin}/checkout/complete/?order=${encodeURIComponent(number)}` } });
    if (result.error) say(errorBox, result.error.message ?? 'The payment did not go through.');
    confirm.disabled = false;
  });
}

const remember = (number: string, token: string): void => {
  try {
    sessionStorage.setItem(`hbd-order-${number}`, token);
  } catch {
    // private browsing: the email link still works
  }
};
const recall = (number: string): string | null => {
  try {
    return sessionStorage.getItem(`hbd-order-${number}`);
  } catch {
    return null;
  }
};

// Order page buttons.
$$('[data-pay-order]').forEach((b) =>
  b.addEventListener('click', async () => {
    const box = document.createElement('div');
    b.closest('.row')?.after(box);
    try {
      await pay(b.dataset.payOrder ?? '', b.dataset.token ?? null, box, $('[data-order-error]'));
    } catch (error) {
      say($('[data-order-error]'), (error as Error).message);
    }
  }),
);
$$('[data-cancel-order]').forEach((b) =>
  b.addEventListener('click', async () => {
    if (!window.confirm('Cancel this order?')) return;
    try {
      await api('POST', `/api/orders/${encodeURIComponent(b.dataset.cancelOrder ?? '')}/cancel`, {}, orderHeaders(b.dataset.token ?? null));
      location.reload();
    } catch (error) {
      say($('[data-order-error]'), (error as Error).message);
    }
  }),
);
$$('[data-cancel-return]').forEach((b) =>
  b.addEventListener('click', async () => {
    try {
      await api('POST', `/api/orders/${encodeURIComponent(b.dataset.order ?? '')}/returns/${b.dataset.cancelReturn}/cancel`, {}, orderHeaders(b.dataset.token ?? null));
      location.reload();
    } catch (error) {
      say($('[data-order-error]'), (error as Error).message);
    }
  }),
);
$$<HTMLFormElement>('[data-return-form]').forEach((form) =>
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const items = $$<HTMLInputElement>('input[name="item"]:checked', form).map((c) => ({
      orderItemId: Number(c.value),
      quantity: Number($<HTMLInputElement>(`[data-return-qty="${c.value}"]`, form)?.value || 1),
      reason: $<HTMLSelectElement>(`[data-return-reason="${c.value}"]`, form)?.value ?? 'other',
    }));
    if (!items.length) return say($('[data-form-error]', form), 'Tick at least one item.');
    try {
      await api('POST', `/api/orders/${encodeURIComponent(form.dataset.returnForm ?? '')}/returns`, { items, resolution: $<HTMLInputElement>('input[name="resolution"]:checked', form)?.value, note: $<HTMLTextAreaElement>('textarea', form)?.value }, orderHeaders(form.dataset.token ?? null));
      location.reload();
    } catch (error) {
      say($('[data-form-error]', form), (error as Error).message);
    }
  }),
);

// ----- checkout -----

const checkout = $<HTMLFormElement>('[data-checkout]');
if (checkout) {
  let quoteId = '';
  let options: Json[] = [];
  const error = $('[data-checkout-error]', checkout);
  const value = (name: string): string => ($<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`, checkout)?.value ?? '').trim();
  const fieldError = (name: string, message: string): void => {
    const el = $(`[data-error-for="${name}"]`, checkout);
    if (el) {
      el.textContent = message;
      el.hidden = !message;
    }
  };
  const show = (n: number): void => {
    $$<HTMLElement>('[data-step]', checkout).forEach((s) => (s.hidden = Number(s.dataset.step) !== n));
    $$('[data-step-label]').forEach((l) => (Number(l.dataset.stepLabel) === n ? l.setAttribute('aria-current', 'step') : l.removeAttribute('aria-current')));
    const heading = $<HTMLElement>(`#step-${n}-h`);
    heading?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    heading?.focus({ preventScroll: true });
  };
  const address = (): Json => ({
    name: value('name'),
    phone: value('phone'),
    line1: value('line1'),
    line2: value('line2'),
    city: value('city'),
    region: value('country') === 'NG' ? value('state') : value('region'),
    postalCode: value('postalCode'),
    country: value('country'),
  });
  const countrySelect = $<HTMLSelectElement>('[name="country"]', checkout);
  countrySelect?.addEventListener('change', () => {
    const ng = countrySelect.value === 'NG';
    const a = $('[data-region-ng]', checkout);
    const b = $('[data-region-other]', checkout);
    if (a) a.hidden = !ng;
    if (b) b.hidden = ng;
  });
  $$<HTMLInputElement>('[name="saved"]', checkout).forEach((r) =>
    r.addEventListener('change', () => {
      if (!r.checked || !r.dataset.saved) return;
      const a = JSON.parse(r.dataset.saved) as Json;
      for (const k of ['name', 'line1', 'line2', 'city', 'postalCode']) {
        const el = $<HTMLInputElement>(`[name="${k}"]`, checkout);
        if (el) el.value = String(a[k] ?? '');
      }
      if (countrySelect) {
        countrySelect.value = String(a.country);
        countrySelect.dispatchEvent(new Event('change'));
      }
      const state = $<HTMLSelectElement>('[name="state"]', checkout);
      const region = $<HTMLInputElement>('[name="region"]', checkout);
      if (a.country === 'NG' && state) state.value = String(a.region);
      else if (region) region.value = String(a.region);
    }),
  );
  const summaryTotal = $('[data-summary-total]');
  const fmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' });
  const minorUnits = currency === 'NGN' || currency === 'USD' || currency === 'GBP' || currency === 'EUR' ? 2 : 2;
  const showMoney = (minor: number): string => fmt.format(minor / 10 ** minorUnits).replace(/\.00$/, '');
  const chosenOption = (): Json | undefined => options.find((o) => o.id === $<HTMLInputElement>('input[name="ship"]:checked', checkout)?.value);
  const updateTotal = (): void => {
    const o = chosenOption();
    if (!summaryTotal || !o) return;
    const base = Number(summaryTotal.getAttribute('data-base-total'));
    const gift = Number(summaryTotal.getAttribute('data-gift'));
    say($('[data-summary-shipping]'), o.priceMinor === 0 ? 'Free' : showMoney(Number(o.priceMinor)));
    say(summaryTotal, showMoney(Math.max(0, base + Number(o.priceMinor) - gift)));
  };

  checkout.addEventListener('click', async (event) => {
    const next = (event.target as HTMLElement).closest<HTMLElement>('[data-next]');
    if (!next) return;
    event.preventDefault();
    say(error, '');
    const step = Number(next.dataset.next);
    if (step === 2) {
      let ok = true;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value('email'))) (fieldError('email', 'Enter a valid email.'), (ok = false));
      else fieldError('email', '');
      if (!/^\+?[0-9 ()-]{7,30}$/.test(value('phone'))) (fieldError('phone', 'Enter a phone number the courier can call.'), (ok = false));
      else fieldError('phone', '');
      if (ok) show(2);
      return;
    }
    if (step === 3) {
      const box = $('[data-options]', checkout);
      if (box) box.innerHTML = '<p class="muted">Finding delivery options for your address…</p>';
      try {
        const q = (await api('POST', '/api/shipping/quote', { address: address() })).quote as Json;
        quoteId = String(q.id);
        options = q.options as Json[];
        const duties = $('[data-duties]', checkout);
        if (duties) {
          duties.hidden = !q.dutiesNotice;
          duties.textContent = String(q.dutiesNotice ?? '');
        }
        if (box) {
          box.innerHTML = options.length
            ? options.map((o, i) => `<label class="card--select check"><input type="radio" name="ship" value="${esc(o.id)}"${i === 0 ? ' checked' : ''}><span class="stack stack--xs grow"><span class="strong">${esc(o.carrierName)}: ${esc(o.serviceName)}</span><span class="small muted">${esc(o.estimate)}</span></span><span class="strong">${o.priceMinor === 0 ? `Free${o.originalPriceMinor ? ` <s class="muted small">${esc(showMoney(Number(o.originalPriceMinor)))}</s>` : ''}` : esc(showMoney(Number(o.priceMinor)))}</span></label>`).join('')
            : `<p>${esc(q.message ?? 'We could not find a delivery option for this address.')}</p>`;
        }
        $$('[data-error-for]', checkout).forEach((el) => (el.hidden = true));
        updateTotal();
        show(3);
      } catch (e) {
        if (e instanceof ApiFailure) {
          for (const [f, m] of Object.entries(e.fields)) fieldError(f === 'region' && value('country') === 'NG' ? 'state' : f, m);
          say(error, e.message);
        }
      }
      return;
    }
    if (step === 4) {
      const o = chosenOption();
      if (!o) return say(error, 'Choose a delivery option.');
      const a = address();
      const review = $('[data-review]', checkout);
      if (review) review.innerHTML = `<div class="kv"><span>Contact</span><span>${esc(value('email'))}, ${esc(value('phone'))}</span></div><div class="kv"><span>Deliver to</span><span>${esc(a.name)}, ${esc(a.line1)}, ${esc(a.city)}${a.region ? `, ${esc(a.region)}` : ''}, ${esc(a.country)}</span></div><div class="kv"><span>Delivery</span><span>${esc(o.carrierName)}: ${esc(o.serviceName)}, ${esc(o.estimate)}</span></div>`;
      show(4);
    }
  });
  checkout.addEventListener('change', (event) => {
    if ((event.target as HTMLInputElement).name === 'ship') updateTotal();
  });
  checkout.addEventListener('submit', async (event) => {
    event.preventDefault();
    say(error, '');
    const payButton = $<HTMLButtonElement>('[data-pay]', checkout);
    if (payButton) payButton.disabled = true;
    let placedNumber = '';
    let placedToken = '';
    try {
      const placed = await api('POST', '/api/checkout', {
        email: value('email'),
        address: address(),
        quoteId,
        shippingOption: chosenOption()?.id,
        note: value('note'),
        saveAddress: $<HTMLInputElement>('[name="saveAddress"]', checkout)?.checked === true,
      });
      const number = String(placed.order.number);
      placedNumber = number;
      placedToken = String(placed.orderToken);
      remember(number, placedToken);
      if (Number(placed.amountDueMinor) === 0) {
        location.assign(`/checkout/complete/?order=${encodeURIComponent(number)}`);
        return;
      }
      if (payButton) payButton.hidden = true;
      await pay(number, String(placed.orderToken), $('[data-stripe-element]', checkout), error);
    } catch (e) {
      // The order exists but paying could not start: the order page has a "Pay now" button for later.
      if (placedNumber) {
        if (error) error.innerHTML = `${esc((e as Error).message)} Your order ${esc(placedNumber)} is saved and your items are kept for 30 minutes. <a class="link" href="/track-order/?order=${encodeURIComponent(placedNumber)}&token=${encodeURIComponent(placedToken)}">Go to your order to pay</a>.`;
        return;
      }
      if (e instanceof ApiFailure) {
        say(error, e.message);
        if (e.code === 'quote_expired') show(3);
        if (e.code === 'cart_not_ready' || e.code === 'out_of_stock') say(error, `${e.message} Go back to your bag to check it.`);
      }
      if (payButton) payButton.disabled = false;
    }
  });
}

// ----- the page after paying -----

const complete = $('[data-complete]');
if (complete) {
  const number = complete.dataset.complete ?? '';
  const token = recall(number);
  const stateTo = (s: string): void => $$<HTMLElement>('[data-state]', complete).forEach((el) => (el.hidden = el.dataset.state !== s));
  const link = signedIn ? `/account/orders/${number.toLowerCase()}/` : token ? `/track-order/?order=${encodeURIComponent(number)}&token=${encodeURIComponent(token)}` : '/track-order/';
  $$<HTMLAnchorElement>('[data-order-link]', complete).forEach((a) => (a.href = link));
  let tries = 0;
  const failedNow = new URLSearchParams(location.search).get('redirect_status') === 'failed';
  const poll = async (): Promise<void> => {
    tries += 1;
    try {
      const s = await api('GET', `/api/orders/${encodeURIComponent(number)}/payment${token ? `?token=${encodeURIComponent(token)}` : ''}`);
      if (s.paymentStatus === 'paid' || s.paymentStatus === 'partly_refunded') {
        setBagCount(0);
        return stateTo('paid');
      }
      if (s.paymentStatus === 'failed' || (failedNow && tries > 2)) {
        say($('[data-failure]', complete), String(s.lastFailure ?? 'Nothing was charged.'));
        return stateTo('failed');
      }
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 404) return stateTo('slow');
    }
    if (tries >= 40) return stateTo('slow');
    window.setTimeout(() => void poll(), 2000);
  };
  void poll();
  $('[data-retry]', complete)?.addEventListener('click', async () => {
    const box = document.createElement('div');
    $('[data-retry]', complete)?.after(box);
    try {
      await pay(number, token, box, $('[data-failure]', complete));
    } catch (e) {
      say($('[data-failure]', complete), (e as Error).message);
    }
  });
}

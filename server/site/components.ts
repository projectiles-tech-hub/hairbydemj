// Reusable pieces of the website, matching the design system components.

import { cls, each, esc, slug } from './html.js';
import { ICONS, type IconName } from './icons.js';
import { naira, type Product } from './sample-data.js';

/** An inline icon. Decorative unless a label is given. */
export function icon(name: IconName, size = 24, label?: string): string {
  const a11y = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 256 256" fill="currentColor" ${a11y}>${ICONS[name]}</svg>`;
}

export interface ButtonOptions {
  kind?: 'primary' | 'secondary' | 'text';
  href?: string;
  full?: boolean;
  fullPhone?: boolean;
  type?: 'button' | 'submit';
  icon?: IconName;
  attrs?: string;
}

export function button(label: string, o: ButtonOptions = {}): string {
  const c = cls('btn', `btn--${o.kind ?? 'primary'}`, o.full && 'btn--full', o.fullPhone && 'btn--full-phone');
  const inner = (o.icon ? icon(o.icon, 20) : '') + esc(label);
  const extra = o.attrs ? ' ' + o.attrs : '';
  if (o.href) return `<a class="${c}" href="${esc(o.href)}"${extra}>${inner}</a>`;
  return `<button class="${c}" type="${o.type ?? 'button'}"${extra}>${inner}</button>`;
}

export interface FieldOptions {
  type?: string;
  value?: string;
  placeholder?: string;
  help?: string;
  error?: string;
  autocomplete?: string;
  inputmode?: string;
  options?: readonly string[];
  textarea?: boolean;
  inputClass?: string;
  id?: string;
}

let fieldCount = 0;

/** A labelled form field. With `error`, shows the message with an icon. */
export function field(label: string, o: FieldOptions = {}): string {
  fieldCount += 1;
  const id = o.id ?? `f-${slug(label)}-${fieldCount}`;
  const describedBy = o.error ? `${id}-error` : o.help ? `${id}-help` : '';
  const common =
    `id="${id}" name="${id}" class="${cls('field__input', o.inputClass)}"` +
    (o.placeholder ? ` placeholder="${esc(o.placeholder)}"` : '') +
    (o.autocomplete ? ` autocomplete="${o.autocomplete}"` : '') +
    (o.inputmode ? ` inputmode="${o.inputmode}"` : '') +
    (describedBy ? ` aria-describedby="${describedBy}"` : '') +
    (o.error ? ' aria-invalid="true"' : '');
  let control: string;
  if (o.options) {
    control = `<select ${common}>${each(o.options, (x) => `<option${x === o.value ? ' selected' : ''}>${esc(x)}</option>`)}</select>`;
  } else if (o.textarea) {
    control = `<textarea ${common} rows="4">${esc(o.value ?? '')}</textarea>`;
  } else {
    control = `<input ${common} type="${o.type ?? 'text'}"${o.value ? ` value="${esc(o.value)}"` : ''}>`;
  }
  return (
    `<div class="${cls('field', o.error && 'field--error')}">` +
    `<label class="field__label" for="${id}">${esc(label)}</label>${control}` +
    (o.help ? `<p class="field__help" id="${id}-help">${esc(o.help)}</p>` : '') +
    (o.error ? `<p class="field__error" id="${id}-error">${icon('warning', 20)}<span>${esc(o.error)}</span></p>` : '') +
    `</div>`
  );
}

export interface ChoiceOptions {
  type?: 'radio' | 'checkbox';
  selected?: readonly string[];
  legend?: string;
}

/** A group of chips that work as radio buttons or checkboxes. */
export function chipGroup(name: string, options: readonly string[], o: ChoiceOptions = {}): string {
  const type = o.type ?? 'radio';
  const chips = each(
    options,
    (x) =>
      `<label class="chip"><input type="${type}" name="${esc(name)}" value="${esc(x)}"${
        o.selected?.includes(x) ? ' checked' : ''
      }><span>${esc(x)}</span></label>`,
  );
  return (
    `<fieldset class="stack stack--sm">` +
    (o.legend ? `<legend class="strong small" style="margin-bottom:8px">${esc(o.legend)}</legend>` : '') +
    `<div class="chips">${chips}</div></fieldset>`
  );
}

/** A row of link chips, for example category shortcuts. */
export function chipLinks(items: ReadonlyArray<[label: string, href: string, on?: boolean]>): string {
  return `<div class="chips">${each(items, ([l, h, on]) => `<a class="${cls('chip', on && 'chip--on')}" href="${esc(h)}">${esc(l)}</a>`)}</div>`;
}

export function check(label: string, o: { type?: 'checkbox' | 'radio'; name?: string; checked?: boolean; disabled?: boolean; help?: string } = {}): string {
  return (
    `<label class="check"><input type="${o.type ?? 'checkbox'}"${o.name ? ` name="${esc(o.name)}"` : ''}${o.checked ? ' checked' : ''}${
      o.disabled ? ' disabled' : ''
    }><span>${esc(label)}${o.help ? `<br><span class="small muted">${esc(o.help)}</span>` : ''}</span></label>`
  );
}

/** A photo placeholder that says what photo belongs there. */
export function photo(label: string, o: { ratio?: string; thumb?: number; className?: string } = {}): string {
  const style = join2(o.ratio ? `--ratio:${o.ratio}` : '', o.thumb ? `--w:${o.thumb}px` : '');
  return `<div class="${cls('photo', o.thumb ? 'photo--thumb' : '', o.className)}" role="img" aria-label="${esc(label || 'Photo')}"${style ? ` style="${style}"` : ''}>${o.thumb ? '' : esc(label)}</div>`;
}

function join2(a: string, b: string): string {
  return [a, b].filter(Boolean).join(';');
}

export function tag(label: string): string {
  return `<span class="tag">${esc(label)}</span>`;
}

export function productCard(p: Product, o: { panel?: boolean; ratio?: string } = {}): string {
  return (
    `<article class="${cls('product-card', o.panel && 'product-card--panel')}">` +
    `<div class="product-card__media">${photo('Product photo', { ratio: o.ratio })}` +
    (p.badge ? tag(p.badge) : '') +
    `<button class="icon-btn product-card__wish" type="button" aria-pressed="false" aria-label="Save ${esc(p.name)} to your wishlist" data-wish>${icon('heart', 22)}</button></div>` +
    `<div class="product-card__body"><a class="product-card__name" href="/product/">${esc(p.name)}</a>` +
    `<span class="small muted">${esc(p.details)}</span><span class="price">${naira(p.priceMinor)}</span></div></article>`
  );
}

export function productGrid(products: readonly Product[], o: { cols?: number; colsTablet?: number; colsPhone?: number; panel?: boolean; id?: string } = {}): string {
  const style = `--cols:${o.cols ?? 4};--cols-tablet:${o.colsTablet ?? 3};--cols-phone:${o.colsPhone ?? 2}`;
  return `<div class="grid"${o.id ? ` id="${o.id}"` : ''} style="${style}">${each(products, (p) => productCard(p, { panel: o.panel }))}</div>`;
}

export function stepper(label: string, value = 1): string {
  return (
    `<div class="stepper" data-stepper><button type="button" aria-label="Decrease ${esc(label)}" data-step="-1">${icon('minus', 20)}</button>` +
    `<output aria-live="polite" aria-label="${esc(label)}">${value}</output>` +
    `<button type="button" aria-label="Increase ${esc(label)}" data-step="1">${icon('plus', 20)}</button></div>`
  );
}

export function kv(a: string, b: string, o: { strong?: boolean; price?: boolean } = {}): string {
  return `<div class="${cls('kv', o.strong && 'strong')}"><span>${esc(a)}</span><span class="${cls(o.price && 'price')}">${esc(b)}</span></div>`;
}

export function card(inner: string, o: { outline?: boolean; title?: string; className?: string } = {}): string {
  return `<section class="${cls('card', o.outline && 'card--outline', 'stack', o.className)}">${o.title ? `<h2 class="h3">${esc(o.title)}</h2>` : ''}${inner}</section>`;
}

/** Star rating with the number in words for screen readers and sighted users. */
export function rating(value: number, text: string): string {
  const full = Math.round(value);
  let s = '';
  for (let i = 1; i <= 5; i += 1) s += icon(i <= full ? 'star' : 'starEmpty', 16);
  return `<p class="rating small"><span class="stars" aria-hidden="true">${s}</span><span class="muted">${esc(text)}</span></p>`;
}

export function sectionHead(title: string, action?: [label: string, href: string]): string {
  return `<div class="section-head"><h2 class="h3">${esc(title)}</h2>${action ? `<a class="link small" href="${esc(action[1])}">${esc(action[0])}</a>` : ''}</div>`;
}

/** A question that opens in place. */
export function accordion(title: string, body: string, open = false): string {
  return `<details class="acc"${open ? ' open' : ''}><summary>${esc(title)}${icon('plus', 20)}</summary><div class="acc__body">${body}</div></details>`;
}

export function divider(): string {
  return '<hr class="divider">';
}

/** The three endless-scrolling states at the end of a list. */
export function listLoader(total: number, noun: string): string {
  return (
    `<div class="loader" data-loader-loading aria-hidden="true"><div class="grid" style="--cols:4;--cols-tablet:3;--cols-phone:2;width:100%">${'<div class="skeleton"></div>'.repeat(4)}</div><p class="small muted">Loading more ${esc(noun)}…</p></div>` +
    `<div class="loader" data-loader-end hidden><hr class="divider" style="width:100%"><p class="strong">You have seen all ${total} ${esc(noun)}</p>${button('Back to top', { kind: 'secondary', href: '#top' })}</div>` +
    `<div class="loader" data-loader-error hidden><p>We could not load more ${esc(noun)}. Check your connection.</p>${button('Try again', { kind: 'secondary', attrs: 'data-loader-retry' })}</div>` +
    `<p class="visually-hidden" role="status" aria-live="polite" data-loader-status></p>`
  );
}

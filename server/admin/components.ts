// Reusable pieces of the staff admin. They build on the website components
// so both follow the same design system.

import { button, icon, type ButtonOptions } from '../site/components.js';
import { cls, each, esc, slug } from '../site/html.js';

export type Cell = string | { html: string } | { num: string };

/** Mark a string as ready-made HTML so the table does not escape it. */
export const raw = (html: string): { html: string } => ({ html });
/** A right-aligned number cell. */
export const num = (text: string | number): { num: string } => ({ num: String(text) });

function cell(c: Cell, tagName: 'td' | 'th', scope = ''): string {
  if (typeof c === 'string') return `<${tagName}${scope}>${esc(c)}</${tagName}>`;
  if ('num' in c) return `<${tagName}${scope} class="num">${esc(c.num)}</${tagName}>`;
  return `<${tagName}${scope}>${c.html}</${tagName}>`;
}

export interface TableOptions {
  caption: string;
  /** Adds a tick box to each row and a "select all" box in the header. */
  select?: boolean;
  /** Index of the column that names the row, used for the tick box labels. Default 0. */
  nameColumn?: number;
  minWidth?: number;
}

/** A plain data table. Wide tables scroll sideways inside their own box. */
export function table(head: readonly Cell[], rows: ReadonlyArray<readonly Cell[]>, o: TableOptions): string {
  const nameOf = (r: readonly Cell[]): string => {
    const c = r[o.nameColumn ?? 0];
    return typeof c === 'string' ? c : c && 'num' in c ? c.num : 'row';
  };
  return (
    `<div class="table-wrap" tabindex="0" role="region" aria-label="${esc(o.caption)}">` +
    `<table class="atable"${o.minWidth ? ` style="min-width:${o.minWidth}px"` : ''}><caption class="visually-hidden">${esc(o.caption)}</caption><thead><tr>` +
    (o.select ? `<th class="atable__tick">${tick('Select all rows', false, 'data-check-all')}</th>` : '') +
    each(head, (h) => cell(h, 'th', ' scope="col"')) +
    `</tr></thead><tbody>` +
    each(rows, (r) => `<tr>${o.select ? `<td class="atable__tick">${tick('Select ' + nameOf(r))}</td>` : ''}${each(r, (c) => cell(c, 'td'))}</tr>`) +
    `</tbody></table></div>`
  );
}

/** A tick box with a label that only screen readers hear. */
export function tick(label: string, checked = false, attrs = ''): string {
  return `<label class="tick"><input type="checkbox"${checked ? ' checked' : ''}${attrs ? ' ' + attrs : ''}><span class="visually-hidden">${esc(label)}</span></label>`;
}

/** A flat outlined panel with an optional heading. */
export function panel(title: string, inner: string, o: { className?: string; level?: 2 | 3 } = {}): string {
  const h = o.level ?? 2;
  return `<section class="${cls('apanel', o.className)}">${title ? `<h${h} class="apanel__title">${esc(title)}</h${h}>` : ''}${inner}</section>`;
}

/** Page heading with its action buttons on the right. */
export function pageHead(title: string, actions = '', crumb = ''): string {
  return `<div class="ahead"><div class="ahead__row"><h1 class="h2">${esc(title)}</h1>${actions ? `<div class="ahead__actions">${actions}</div>` : ''}</div>${crumb ? `<p class="small muted">${crumb}</p>` : ''}</div>`;
}

/** A button at the admin's smaller size. */
export function abutton(label: string, o: ButtonOptions = {}): string {
  return button(label, o);
}

/** A row of filter drop-downs. Each entry is a label and its choices. */
export function filters(items: ReadonlyArray<[label: string, options: readonly string[]]>, extra = ''): string {
  return (
    `<form class="afilters" action="#" role="search" aria-label="Filters">` +
    each(items, ([label, options]) => {
      const id = 'flt-' + slug(label);
      return `<label class="afilter" for="${id}"><span class="visually-hidden">${esc(label)}</span><select id="${id}">${each(options, (x, i) => `<option>${esc(i === 0 ? `${label}: ${x}` : x)}</option>`)}</select></label>`;
    }) +
    extra +
    `</form>`
  );
}

/** Tabs that are links; the current one is marked. */
export function tabs(label: string, items: ReadonlyArray<[label: string, href: string, current?: boolean]>): string {
  return `<nav class="atabs" aria-label="${esc(label)}">${each(items, ([l, h, on]) => `<a href="${esc(h)}"${on ? ' aria-current="page"' : ''}>${esc(l)}</a>`)}</nav>`;
}

/** One headline number on the dashboard or a report. */
export function stat(label: string, value: string, note = '', strong = false): string {
  return `<div class="astat"><p class="small muted">${esc(label)}</p><p class="${cls('astat__value', strong && 'astat__value--gold')}">${esc(value)}</p>${note ? `<p class="small muted">${esc(note)}</p>` : ''}</div>`;
}

/** "Showing 1 to 25 of 132" with page links. */
export function pager(total = 132): string {
  return `<nav class="apager small muted" aria-label="Pages"><span>Showing 1 to 25 of ${total}</span><span class="apager__links"><a href="#" aria-label="Previous page">‹</a><a href="#" aria-current="page">1</a>${each([2, 3, 4, 5, 6], (n) => `<a href="#">${n}</a>`)}<a href="#" aria-label="Next page">›</a></span></nav>`;
}

/** A status word with a dot whose colour also carries the meaning. */
export function status(text: string, tone: 'good' | 'wait' | 'bad' | 'off' = 'off'): { html: string } {
  return raw(`<span class="astatus astatus--${tone}">${esc(text)}</span>`);
}

/** A small square where a product photo goes. */
export function thumb(label = 'Product photo', size = 40): { html: string } {
  return raw(`<span class="athumb" role="img" aria-label="${esc(label)}" style="--w:${size}px"></span>`);
}

/** A dialog that opens over the page. Open it with data-dialog-open="id". */
export function dialog(id: string, title: string, body: string, foot: string): string {
  return (
    `<dialog class="adialog" id="${id}" aria-labelledby="${id}-h"><form method="dialog" class="adialog__in">` +
    `<div class="adialog__head"><h2 class="h3" id="${id}-h">${esc(title)}</h2><button class="icon-btn" type="submit" value="cancel" aria-label="Close">${icon('close')}</button></div>` +
    `<div class="stack">${body}</div><div class="adialog__foot">${foot}</div></form></dialog>`
  );
}

/** A message in the middle of an empty or failed list. */
export function emptyState(title: string, text: string, action: string, warn = false): string {
  return `<div class="aempty" ${warn ? 'role="alert"' : ''}>${warn ? icon('warning', 32) : ''}<h2 class="h3">${esc(title)}</h2><p class="muted">${esc(text)}</p>${action}</div>`;
}

/** A line chart drawn as SVG, with the same numbers in a hidden table for screen readers. */
export function lineChart(title: string, points: ReadonlyArray<[label: string, value: number]>, yLabels: readonly string[], max: number, xEvery = 1): string {
  const w = 640;
  const h = 220;
  const step = w / (points.length - 1);
  const xy = points.map(([, v], i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`);
  const last = xy[xy.length - 1]?.split(',') ?? ['0', '0'];
  const grid = yLabels.map((_, i) => `<line x1="0" x2="${w}" y1="${(i * h) / (yLabels.length - 1)}" y2="${(i * h) / (yLabels.length - 1)}"/>`).join('');
  return (
    `<figure class="achart"><div class="achart__body"><div class="achart__y small muted" aria-hidden="true">${each(yLabels, (l) => `<span>${esc(l)}</span>`)}</div>` +
    `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(title)}. The numbers are in the table that follows."><g class="achart__grid">${grid}</g><polyline points="${xy.join(' ')}"/><circle cx="${last[0]}" cy="${last[1]}" r="4"/></svg></div>` +
    `<div class="achart__x small muted" aria-hidden="true">${each(points, ([l], i) => (i % xEvery === 0 || i === points.length - 1 ? `<span>${esc(l)}</span>` : ''))}</div>` +
    `<table class="visually-hidden"><caption>${esc(title)}</caption><tbody>${each(points, ([l, v]) => `<tr><th scope="row">${esc(l)}</th><td>₦${v.toLocaleString('en-NG')}</td></tr>`)}</tbody></table></figure>`
  );
}

/** A label and value pair on one line. */
export function pair(label: string, value: string): string {
  return `<div class="kv small"><span class="muted">${esc(label)}</span><span>${esc(value)}</span></div>`;
}

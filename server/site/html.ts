// Small helpers for building HTML as plain strings. No template engine.

/** Escape text so it is safe inside HTML content and attribute values. */
export function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Join class names, skipping empty ones. */
export function cls(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Join pieces of HTML. */
export function join(parts: Array<string | false | null | undefined>, separator = ''): string {
  return parts.filter(Boolean).join(separator);
}

/** Repeat a piece of HTML for each item. */
export function each<T>(items: readonly T[], render: (item: T, index: number) => string): string {
  return items.map(render).join('');
}

/** Turn a label into an id-safe slug. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

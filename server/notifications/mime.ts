// Writing an email the way mail servers expect it (RFC 5322 and MIME), and
// signing it with DKIM (RFC 6376) so inboxes can check it really came from
// hairbydemj.com. No library: the format is small and fixed.

import { createHash, createSign, randomBytes } from 'node:crypto';

export interface Message {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, such as List-Unsubscribe. */
  headers?: Record<string, string>;
  date: Date;
  /** Domain for the Message-ID. */
  domain: string;
}

/** A header value with non-ASCII characters (₦, é, emoji) is written as RFC 2047 encoded words. */
export function encodeHeader(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  // Split into chunks so no encoded word passes 75 characters.
  const words: string[] = [];
  let chunk = '';
  for (const ch of value) {
    if (Buffer.byteLength(chunk + ch) > 40) {
      words.push(chunk);
      chunk = '';
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w).toString('base64')}?=`).join('\r\n ');
}

/** "Name <address>" with the name encoded when needed. */
export function encodeAddress(value: string): string {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value);
  if (!m) return value.trim();
  const name = m[1]?.replace(/^"|"$/g, '') ?? '';
  if (!name) return `<${m[2]}>`;
  return /^[\x20-\x7e]*$/.test(name) ? `"${name.replace(/["\\]/g, '\\$&')}" <${m[2]}>` : `${encodeHeader(name)} <${m[2]}>`;
}

/** The bare address out of "Name <address>". */
export function addressOf(value: string): string {
  const m = /<([^>]+)>/.exec(value);
  return (m ? m[1] : value)?.trim() ?? '';
}

function base64Lines(text: string): string {
  return (Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}

/** The whole message, headers and body, with CRLF line ends. */
export function buildMessage(m: Message): string {
  const boundary = `hbd-${randomBytes(12).toString('hex')}`;
  const headers: Array<[string, string]> = [
    ['From', encodeAddress(m.from)],
    ['To', encodeAddress(m.to)],
    ...(m.replyTo ? ([['Reply-To', encodeAddress(m.replyTo)]] as Array<[string, string]>) : []),
    ['Subject', encodeHeader(m.subject)],
    ['Date', m.date.toUTCString().replace('GMT', '+0000')],
    ['Message-ID', `<${randomBytes(16).toString('hex')}@${m.domain}>`],
    ['MIME-Version', '1.0'],
    ...Object.entries(m.headers ?? {}),
    ['Content-Type', `multipart/alternative; boundary="${boundary}"`],
  ];
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(m.text),
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(m.html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return `${headers.map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n${body}`;
}

// ----- DKIM -----

/** Relaxed body canonicalisation: spaces squeezed, line-end spaces and trailing empty lines removed. */
export function relaxedBody(body: string): string {
  const lines = body.split('\r\n').map((l) => l.replace(/[ \t]+/g, ' ').replace(/ $/, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.length ? `${lines.join('\r\n')}\r\n` : '';
}

/** Relaxed header canonicalisation: lower-case name, unfolded value with spaces squeezed. */
export function relaxedHeader(name: string, value: string): string {
  return `${name.toLowerCase().trim()}:${value.replace(/\r\n(?=[ \t])/g, '').replace(/[ \t]+/g, ' ').trim()}`;
}

/** Headers of a message as [name, value] pairs, folded lines joined back. */
function parseHeaders(head: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const line of head.split(/\r\n(?![ \t])/)) {
    const i = line.indexOf(':');
    if (i > 0) out.push([line.slice(0, i), line.slice(i + 1)]);
  }
  return out;
}

const SIGNED = ['from', 'to', 'reply-to', 'subject', 'date', 'message-id', 'mime-version', 'content-type', 'list-unsubscribe', 'list-unsubscribe-post'];

/**
 * Add a DKIM-Signature header (rsa-sha256, relaxed/relaxed) signed with the
 * domain's private key. The public half is published in DNS at
 * <selector>._domainkey.<domain>.
 */
export function dkimSign(message: string, options: { domain: string; selector: string; privateKey: string; now: Date }): string {
  const split = message.indexOf('\r\n\r\n');
  const head = message.slice(0, split);
  const body = message.slice(split + 4);
  const headers = parseHeaders(head);
  const present = headers.map(([n]) => n.toLowerCase());
  const names = SIGNED.filter((n) => present.includes(n));
  const bh = createHash('sha256').update(relaxedBody(body)).digest('base64');
  const tags = `v=1; a=rsa-sha256; c=relaxed/relaxed; d=${options.domain}; s=${options.selector}; t=${Math.floor(options.now.getTime() / 1000)}; h=${names.join(':')}; bh=${bh}; b=`;
  // Each named header, last occurrence first as the standard says (each appears once here).
  const canon = names.map((n) => {
    const found = [...headers].reverse().find(([h]) => h.toLowerCase() === n) as [string, string];
    return relaxedHeader(found[0], found[1]);
  });
  canon.push(relaxedHeader('DKIM-Signature', tags));
  const signature = createSign('RSA-SHA256').update(canon.join('\r\n')).sign(options.privateKey, 'base64');
  // Folded only between tags and inside b=, where line breaks are allowed and ignored.
  const folded = tags.replace(/; /g, ';\r\n\t') + (signature.match(/.{1,64}/g) ?? []).join('\r\n\t');
  return `DKIM-Signature: ${folded}\r\n${message}`;
}

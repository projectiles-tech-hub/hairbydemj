// The live admin's script (admin.hairbydemj.com). Pages are built on the
// server; this sends their forms and buttons to the /api addresses as JSON,
// shows errors next to the right field, and handles signing in.
export {};

const $ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document): T | null => root.querySelector<T>(s);
const $$ = <T extends Element = HTMLElement>(s: string, root: ParentNode = document): T[] => Array.from(root.querySelectorAll<T>(s));

interface ApiAnswer {
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}

async function api(path: string, body?: unknown): Promise<ApiAnswer> {
  try {
    const res = await fetch(path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      headers: body === undefined ? { Accept: 'application/json' } : { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { error: { message: 'We could not reach the server. Check the connection and try again.' } } };
  }
}

function errorOf(answer: ApiAnswer): { message: string; fields: Record<string, string> } {
  const e = (answer.data.error ?? {}) as { message?: string; fields?: Record<string, string> };
  if (answer.status === 401) return { message: 'You have been signed out. Sign in again to carry on.', fields: {} };
  return { message: e.message ?? 'That did not work. Try again.', fields: e.fields ?? {} };
}

// ----- toasts -----

let toastTimer = 0;
function toast(message: string): void {
  const box = $('[data-toast-box]');
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (box.hidden = true), 4000);
}
// A message carried over a reload.
try {
  const carried = sessionStorage.getItem('hbd-toast');
  if (carried) {
    sessionStorage.removeItem('hbd-toast');
    toast(carried);
  }
} catch {
  // Storage can be blocked; the message is simply not shown.
}
function reloadWith(message: string, next?: string): void {
  try {
    sessionStorage.setItem('hbd-toast', message);
  } catch {
    // ignore
  }
  if (next) window.location.assign(next);
  else window.location.reload();
}

// ----- the menu on small screens -----

const aside = $('[data-aside]');
const scrim = $('[data-scrim]');
const opener = $('[data-aside-open]');
function setAside(open: boolean): void {
  aside?.classList.toggle('is-open', open);
  scrim?.classList.toggle('is-open', open);
  opener?.setAttribute('aria-expanded', String(open));
  if (open) $('[data-aside-close]')?.focus();
  else if (document.activeElement && aside?.contains(document.activeElement)) opener?.focus();
}
opener?.addEventListener('click', () => setAside(true));
$('[data-aside-close]')?.addEventListener('click', () => setAside(false));
scrim?.addEventListener('click', () => setAside(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && aside?.classList.contains('is-open')) setAside(false);
});

// ----- dialogs -----

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const open = target.closest<HTMLElement>('[data-dialog-open]');
  if (open) {
    const d = document.getElementById(open.dataset.dialogOpen ?? '');
    if (d instanceof HTMLDialogElement) {
      // The stock dialog is shared by every row: point it at this one.
      if (open.dataset.adjust) {
        const f = $<HTMLFormElement>('[data-adjust-form]', d);
        if (f) f.dataset.jsonForm = `/api/inventory/${open.dataset.adjust}/adjust`;
        const title = $('[data-adjust-title]', d);
        if (title) title.textContent = open.dataset.adjustName ?? '';
      }
      if (!d.open) d.showModal();
      $<HTMLElement>('input, select, textarea', d)?.focus();
    }
    return;
  }
  const close = target.closest('[data-dialog-close]');
  if (close) close.closest('dialog')?.close();
});

// ----- reading a form into JSON -----

/** Put `value` at a dotted key, making objects on the way: "prices.NGN" → { prices: { NGN: value } }. */
function setPath(out: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let at = out;
  for (const part of parts.slice(0, -1)) {
    if (typeof at[part] !== 'object' || at[part] === null) at[part] = {};
    at = at[part] as Record<string, unknown>;
  }
  at[parts[parts.length - 1] ?? key] = value;
}

function valueOf(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): unknown {
  const type = el.dataset.type;
  if (type === 'bool') return (el as HTMLInputElement).checked;
  const raw = el.value.trim();
  if (type === 'number') return raw === '' ? null : Number(raw.replace(/,/g, ''));
  // Money is typed in whole units (₦25,000 or 49.99) and sent in the smallest unit.
  if (type === 'minor') return raw === '' ? null : Math.round(Number(raw.replace(/[^0-9.]/g, '')) * 100);
  if (type === 'list') return raw === '' ? [] : raw.split(',').map((s) => s.trim()).filter(Boolean);
  return raw;
}

function readForm(form: HTMLElement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const el of $$<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[data-key]', form)) {
    const key = el.dataset.key ?? '';
    // A value inside a nested form belongs to that form.
    if (el.closest('[data-json-form]') !== form) continue;
    const v = valueOf(el);
    // Empty money and number fields are left out, so the server keeps what it has (or applies its default).
    if (v === null) continue;
    setPath(out, key, v);
  }
  // Ticked boxes that share a list key: data-list-key="restock" value="12" → { restock: [12] }.
  const lists = new Map<string, unknown[]>();
  for (const box of $$<HTMLInputElement>('input[data-list-key]', form)) {
    if (box.closest('[data-json-form]') !== form) continue;
    const key = box.dataset.listKey ?? '';
    if (!lists.has(key)) lists.set(key, []);
    if (box.checked) lists.get(key)!.push(/^\d+$/.test(box.value) ? Number(box.value) : box.value);
  }
  for (const [key, values] of lists) setPath(out, key, values);
  return out;
}

function showErrors(form: HTMLElement, message: string, fields: Record<string, string>): void {
  for (const p of $$('[data-error-for]', form)) {
    p.hidden = true;
    p.textContent = '';
  }
  for (const el of $$('[aria-invalid]', form)) el.removeAttribute('aria-invalid');
  let first: HTMLElement | null = null;
  for (const [key, text] of Object.entries(fields)) {
    const p = $(`[data-error-for="${CSS.escape(key)}"]`, form) ?? $$('[data-error-for]', form).find((x) => x.dataset.errorFor?.endsWith(`.${key}`)) ?? null;
    if (!p) continue;
    p.textContent = text;
    p.hidden = false;
    const field = p.closest('.field')?.querySelector<HTMLElement>('[data-key]');
    field?.setAttribute('aria-invalid', 'true');
    if (field && p.id === '') p.id = `err-${Math.random().toString(36).slice(2)}`;
    field?.setAttribute('aria-describedby', p.id);
    first ??= field ?? null;
  }
  const box = $('[data-form-error]', form);
  if (box) box.textContent = message;
  first?.focus();
}

/** Fill {id} or {product.id} in a next address from the answer. */
function fill(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{([a-zA-Z.]+)\}/g, (_, path: string) => {
    let at: unknown = data;
    for (const part of path.split('.')) at = at && typeof at === 'object' ? (at as Record<string, unknown>)[part] : undefined;
    return encodeURIComponent(String(at ?? ''));
  });
}

document.addEventListener('submit', async (event) => {
  const form = event.target as HTMLFormElement;
  if (!form.dataset.jsonForm) return;
  event.preventDefault();
  if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) return;
  const button = $<HTMLButtonElement>('button[type="submit"]', form);
  if (button?.disabled) return;
  if (button) button.disabled = true;
  const answer = await api(form.dataset.jsonForm, readForm(form));
  if (button) button.disabled = false;
  if (!answer.ok) {
    const e = errorOf(answer);
    showErrors(form, e.message, e.fields);
    if (answer.status === 401) window.setTimeout(() => window.location.assign(`/sign-in/?next=${encodeURIComponent(location.pathname)}`), 1200);
    return;
  }
  showErrors(form, '', {});
  const next = form.dataset.next ? fill(form.dataset.next, answer.data) : undefined;
  if (next || form.dataset.reload !== undefined) reloadWith('Saved.', next);
  else toast('Saved.');
});

// ----- one-click buttons -----

document.addEventListener('click', async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-post]');
  if (!button) return;
  if (button.dataset.confirm && !window.confirm(button.dataset.confirm)) return;
  button.disabled = true;
  const answer = await api(button.dataset.post ?? '', button.dataset.body ? JSON.parse(button.dataset.body) : {});
  button.disabled = false;
  if (!answer.ok) {
    toast(errorOf(answer).message);
    return;
  }
  reloadWith('Done.', button.dataset.next);
});

// Filters that apply as soon as they change.
for (const el of $$<HTMLSelectElement>('[data-autosubmit]')) el.addEventListener('change', () => el.form?.requestSubmit());

// ----- signing out -----

$('[data-sign-out]')?.addEventListener('click', async () => {
  await api('/api/auth/sign-out', {});
  window.location.assign('/sign-in/');
});

// ----- signing in: password, then the authenticator code -----

const signIn = $<HTMLFormElement>('[data-sign-in]');
const twoStep = $<HTMLFormElement>('[data-two-step]');
let pending = '';
function nextPage(): string {
  const next = new URLSearchParams(location.search).get('next') ?? '/';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
signIn?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = new FormData(signIn);
  const answer = await api('/api/auth/sign-in', { email: data.get('email'), password: data.get('password') });
  if (!answer.ok) {
    showErrors(signIn, errorOf(answer).message, {});
    return;
  }
  pending = String(answer.data.pending ?? '');
  signIn.hidden = true;
  if (twoStep) {
    twoStep.hidden = false;
    $<HTMLInputElement>('input', twoStep)?.focus();
  }
});
twoStep?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const answer = await api('/api/auth/two-step', { pending, code: new FormData(twoStep).get('code') });
  if (!answer.ok) {
    const e = errorOf(answer);
    showErrors(twoStep, e.message, {});
    // Too slow: back to the password.
    if (answer.status === 401 && signIn) {
      twoStep.hidden = true;
      signIn.hidden = false;
    }
    return;
  }
  window.location.assign(nextPage());
});

// ----- accepting an invitation -----

const invite = $<HTMLFormElement>('[data-invite]');
const inviteConfirm = $<HTMLFormElement>('[data-invite-confirm]');
invite?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const answer = await api('/api/auth/invite/start', { token: invite.dataset.invite, password: new FormData(invite).get('password') });
  if (!answer.ok) {
    showErrors(invite, errorOf(answer).message, {});
    return;
  }
  invite.hidden = true;
  if (inviteConfirm) {
    const secret = $('[data-invite-secret]', inviteConfirm);
    if (secret) secret.textContent = String(answer.data.secret ?? '').replace(/(.{4})/g, '$1 ').trim();
    const link = $<HTMLAnchorElement>('[data-invite-uri]', inviteConfirm);
    if (link) link.href = String(answer.data.uri ?? '#');
    inviteConfirm.hidden = false;
    $<HTMLInputElement>('input', inviteConfirm)?.focus();
  }
});
inviteConfirm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const answer = await api('/api/auth/invite/confirm', { token: inviteConfirm.dataset.inviteConfirm, code: new FormData(inviteConfirm).get('code') });
  if (!answer.ok) {
    showErrors(inviteConfirm, errorOf(answer).message, {});
    return;
  }
  inviteConfirm.innerHTML = '<p class="strong">Your account is ready.</p><p><a class="btn btn--primary" href="/sign-in/">Sign in</a></p>';
});

// ----- uploading photos and videos -----

for (const form of $$<HTMLFormElement>('[data-upload]')) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const files = $<HTMLInputElement>('input[type="file"]', form)?.files;
    const status = $('[data-upload-status]', form);
    if (!files || files.length === 0) {
      if (status) status.textContent = 'Choose a photo or video first.';
      return;
    }
    const alt = $<HTMLInputElement>('[data-upload-alt]', form)?.value.trim() ?? '';
    const colour = $<HTMLInputElement>('[data-upload-colour]', form)?.value.trim() ?? '';
    let done = 0;
    for (const file of Array.from(files)) {
      if (status) status.textContent = `Uploading ${done + 1} of ${files.length}…`;
      const params = new URLSearchParams({ name: file.name });
      if (alt) params.set('alt', alt);
      if (colour) params.set('colour', colour);
      // Other values the address takes, from fields marked data-upload-param="name".
      for (const input of $$<HTMLInputElement>('[data-upload-param]', form)) {
        if (input.value.trim()) params.set(input.dataset.uploadParam ?? '', input.value.trim());
      }
      try {
        const res = await fetch(`${form.dataset.upload}?${params.toString()}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          if (status) status.textContent = `${file.name}: ${data.error?.message ?? 'the upload did not work.'}`;
          return;
        }
      } catch {
        if (status) status.textContent = 'We could not reach the server. Check the connection and try again.';
        return;
      }
      done += 1;
    }
    reloadWith(done === 1 ? 'Uploaded. Sizes are being made.' : `${done} files uploaded. Sizes are being made.`);
  });
}

// ----- live chat inbox (module 18) -----

const chatInbox = $('[data-chat-inbox]');
if (chatInbox) {
  const current = Number(chatInbox.dataset.current) || 0;
  const box = $('[data-chat-messages]');
  const scrollDown = (): void => {
    if (box) box.scrollTop = box.scrollHeight;
  };
  scrollDown();
  const text = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
  interface ChatMessage { id: number; sender: string; staffName: string | null; body: string; at: string }
  const append = (m: ChatMessage): void => {
    if (!box || box.querySelector(`[data-message="${m.id}"]`)) return;
    const at = new Date(m.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    box.insertAdjacentHTML('beforeend', `<div class="achat__msg achat__msg--${text(m.sender)}" data-message="${m.id}"><p>${text(m.body)}</p><span class="small muted">${m.sender === 'staff' ? text(m.staffName ?? 'Staff') : m.sender === 'system' ? '' : 'Customer'} · ${at}</span></div>`);
    scrollDown();
  };
  /** The list of conversations, fetched again when another one changes. */
  const refreshList = async (): Promise<void> => {
    try {
      const html = await (await fetch(location.href, { credentials: 'same-origin' })).text();
      const fresh = new DOMParser().parseFromString(html, 'text/html').querySelector('[data-chat-list]');
      const list = $('[data-chat-list]');
      if (fresh && list) list.replaceWith(fresh);
      else if (fresh && !list) location.reload();
    } catch {
      // Tried again on the next event.
    }
  };
  const events = new EventSource('/api/chat/events');
  events.addEventListener('message', (e) => {
    const data = JSON.parse((e as MessageEvent<string>).data) as { conversationId: number; message?: ChatMessage };
    if (data.conversationId === current && data.message) {
      append(data.message);
      // Seen straight away while it is open.
      if (data.message.sender === 'customer') void fetch(`/api/chat/conversations/${current}`, { credentials: 'same-origin' });
    }
    if (data.conversationId !== current || data.message?.sender === 'customer') void refreshList();
  });
  events.addEventListener('conversation', () => void refreshList());

  for (const b of $$<HTMLButtonElement>('[data-saved-reply]')) {
    b.addEventListener('click', () => {
      const area = $<HTMLTextAreaElement>('[data-chat-text]');
      if (area) {
        area.value = b.dataset.savedReply ?? '';
        area.focus();
      }
    });
  }
  const reply = $<HTMLFormElement>('[data-chat-reply]');
  reply?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const area = $<HTMLTextAreaElement>('[data-chat-text]', reply);
    const body = area?.value.trim() ?? '';
    if (!body) return;
    const answer = await api(`/api/chat/conversations/${reply.dataset.chatReply}/messages`, { body });
    if (!answer.ok) {
      showErrors(reply, errorOf(answer).message, {});
      return;
    }
    if (area) area.value = '';
    append((answer.data as { message: ChatMessage }).message);
  });
  // Enter sends; Shift+Enter makes a new line.
  $<HTMLTextAreaElement>('[data-chat-text]')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      reply?.requestSubmit();
    }
  });
}

// Browser script for the staff admin. Plain TypeScript, no framework.

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => Array.from(root.querySelectorAll<T>(sel));

// ----- sidebar as a drawer on phones and tablets -----
const aside = $('[data-aside]');
const scrim = $('[data-scrim]');
const opener = $('[data-aside-open]');
function setAside(open: boolean): void {
  aside?.classList.toggle('is-open', open);
  scrim?.classList.toggle('is-open', open);
  document.body.style.overflow = open ? 'hidden' : '';
  if (open) $<HTMLElement>('[data-aside-close]')?.focus();
  else opener?.focus();
}
opener?.addEventListener('click', () => setAside(true));
$('[data-aside-close]')?.addEventListener('click', () => setAside(false));
scrim?.addEventListener('click', () => setAside(false));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && aside?.classList.contains('is-open')) setAside(false);
});

// ----- short messages after an action -----
const toastBox = $('[data-toast-box]');
let toastTimer = 0;
function toast(text: string): void {
  if (!toastBox) return;
  toastBox.textContent = text;
  toastBox.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastBox.hidden = true), 5000);
}
document.addEventListener('click', (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-toast]');
  if (el?.dataset.toast) toast(el.dataset.toast);
});

// ----- dialogs: open from a button, or from the address (for example /admin/staff/#invite) -----
function openDialog(id: string): void {
  const d = document.getElementById(id);
  if (d instanceof HTMLDialogElement && !d.open) d.showModal();
}
document.addEventListener('click', (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-dialog-open]');
  if (el?.dataset.dialogOpen) openDialog(el.dataset.dialogOpen);
});
if (window.location.hash.length > 1) openDialog(window.location.hash.slice(1));
$$<HTMLDialogElement>('dialog').forEach((d) =>
  d.addEventListener('click', (event) => {
    if (event.target === d) d.close();
  }),
);

// ----- "select all" in tables -----
$$<HTMLInputElement>('[data-check-all]').forEach((all) => {
  const boxes = (): HTMLInputElement[] => $$<HTMLInputElement>('tbody .atable__tick input', all.closest('table') ?? document);
  all.addEventListener('change', () => boxes().forEach((b) => (b.checked = all.checked)));
});

// ----- stock dialog: work out the new quantity -----
const stockAfter = $('[data-stock-after]');
if (stockAfter) {
  const now = Number($('[data-stock-now]')?.textContent ?? 0);
  const qty = $<HTMLInputElement>('#stock-qty');
  const modes = $$<HTMLInputElement>('[data-stock-mode] input');
  const update = (): void => {
    const n = Math.max(0, Math.floor(Number(qty?.value) || 0));
    const mode = modes.findIndex((m) => m.checked);
    const result = mode === 0 ? now + n : mode === 1 ? Math.max(0, now - n) : n;
    stockAfter.textContent = String(result);
  };
  qty?.addEventListener('input', update);
  modes.forEach((m) => m.addEventListener('change', update));
}

// ----- homepage sections: move up and down -----
$$('[data-sort]').forEach((list) => {
  list.addEventListener('click', (event) => {
    const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-move]');
    const item = btn?.closest('li');
    if (!btn || !item) return;
    if (btn.dataset.move === '-1' && item.previousElementSibling) list.insertBefore(item, item.previousElementSibling);
    if (btn.dataset.move === '1' && item.nextElementSibling) list.insertBefore(item.nextElementSibling, item);
    btn.focus();
  });
});

// ----- saved replies fill the reply box -----
document.addEventListener('click', (event) => {
  const el = (event.target as HTMLElement).closest<HTMLElement>('[data-fill]');
  const input = el?.dataset.fill ? document.getElementById(el.dataset.fill) : null;
  if (el && input instanceof HTMLInputElement) {
    input.value = el.dataset.fillText ?? '';
    input.focus();
  }
});
$$<HTMLFormElement>('[data-chat-form], .afilters').forEach((f) => f.addEventListener('submit', (event) => event.preventDefault()));

export {};

// Browser script for the website. Plain TypeScript, no framework.
// Everything here improves pages that already work as plain HTML.

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] => Array.from(root.querySelectorAll<T>(sel));

// ----- panels: menu, mini-cart, filters -----
const scrim = $('[data-scrim]');
let lastFocus: HTMLElement | null = null;

function closePanels(): void {
  $$('[data-panel].is-open').forEach((p) => p.classList.remove('is-open'));
  scrim?.classList.remove('is-open');
  document.body.style.overflow = '';
  lastFocus?.focus();
  lastFocus = null;
}

function openPanel(id: string, opener: HTMLElement): void {
  const panel = document.getElementById(id);
  if (!panel) return;
  closePanels();
  lastFocus = opener;
  panel.classList.add('is-open');
  scrim?.classList.add('is-open');
  document.body.style.overflow = 'hidden';
  $<HTMLElement>('[data-close]', panel)?.focus();
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
    $('[data-chat]')?.classList.remove('is-open');
  }
});

// ----- footer link groups: closed on phones and tablets, open on desktop -----
if (window.matchMedia('(max-width: 1023px)').matches) {
  $$<HTMLDetailsElement>('.site-footer details').forEach((d) => (d.open = false));
}

// ----- quantity steppers -----
$$('[data-stepper]').forEach((stepper) => {
  const output = $<HTMLOutputElement>('output', stepper);
  if (!output) return;
  $$<HTMLButtonElement>('[data-step]', stepper).forEach((btn) => {
    btn.addEventListener('click', () => {
      const next = Math.max(1, Number(output.value) + Number(btn.dataset.step));
      output.value = String(next);
    });
  });
});

// ----- wishlist hearts (works for cards added later by endless scrolling) -----
document.addEventListener('click', (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-wish]');
  if (btn) btn.setAttribute('aria-pressed', btn.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
});

// ----- account section drop-down on phones -----
$<HTMLSelectElement>('[data-jump]')?.addEventListener('change', (event) => {
  window.location.href = (event.target as HTMLSelectElement).value;
});

// ----- checkout: one step at a time -----
const checkout = $<HTMLFormElement>('[data-checkout]');
if (checkout) {
  const steps = $$('[data-step]', checkout);
  const show = (n: number): void => {
    steps.forEach((s) => (s.hidden = Number(s.dataset.step) !== n));
    $$('[data-step-label]').forEach((l) => {
      if (Number(l.dataset.stepLabel) === n) l.setAttribute('aria-current', 'step');
      else l.removeAttribute('aria-current');
    });
    const heading = $('h2', steps[n - 1] ?? checkout);
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
    window.scrollTo({ top: 0 });
  };
  $$('[data-next]', checkout).forEach((btn) => {
    btn.addEventListener('click', () => {
      const current = Number(btn.closest<HTMLElement>('[data-step]')?.dataset.step ?? 1);
      show(current + 1);
    });
  });
  $$('[data-step-label]').forEach((label) => {
    label.addEventListener('click', () => show(Number(label.dataset.stepLabel)));
    label.style.cursor = 'pointer';
  });
}

// ----- cookie notice -----
const cookie = $('[data-cookie]');
function cookieSeen(): boolean {
  try {
    return window.localStorage.getItem('cookie-choice') !== null;
  } catch {
    return false;
  }
}
if (cookie) {
  if (!cookieSeen()) cookie.classList.add('is-open');
  $$('[data-cookie-accept]', cookie).forEach((btn) =>
    btn.addEventListener('click', () => {
      try {
        window.localStorage.setItem('cookie-choice', 'set');
      } catch {
        // Storage can be blocked; the notice simply closes for this visit.
      }
      cookie.classList.remove('is-open');
    }),
  );
  $('[data-cookie-choose]', cookie)?.addEventListener('click', () => {
    const choices = $('[data-cookie-choices]', cookie);
    if (choices) choices.hidden = !choices.hidden;
  });
  $$('[data-cookie-open]').forEach((btn) => btn.addEventListener('click', () => cookie.classList.add('is-open')));
}

// ----- live chat -----
const chat = $('[data-chat]');
$$('[data-chat-open]').forEach((btn) =>
  btn.addEventListener('click', () => {
    chat?.classList.add('is-open');
    $<HTMLInputElement>('input', chat ?? document)?.focus();
  }),
);
$('[data-chat-close]')?.addEventListener('click', () => chat?.classList.remove('is-open'));
$<HTMLFormElement>('[data-chat-form]')?.addEventListener('submit', (event) => event.preventDefault());

// ----- back to top -----
const topButton = $('[data-top]');
if (topButton) {
  window.addEventListener(
    'scroll',
    () => {
      topButton.hidden = window.scrollY < window.innerHeight * 2;
    },
    { passive: true },
  );
}

// ----- endless scrolling -----
$$('[data-endless]').forEach((box) => {
  const total = Number(box.dataset.total);
  const batch = Number(box.dataset.batch);
  const list = box.dataset.target ? document.getElementById(box.dataset.target) : null;
  const loading = $('[data-loader-loading]', box);
  const end = $('[data-loader-end]', box);
  const status = $('[data-loader-status]', box);
  const count = $('[data-count]');
  const finish = (): void => {
    if (loading) loading.hidden = true;
    if (end) end.hidden = false;
  };
  if (!list || batch === 0 || !loading) {
    finish();
    return;
  }
  const samples = Array.from(list.children);
  let busy = false;
  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting) || busy) return;
      busy = true;
      // In the real site this fetches the next page from the API.
      window.setTimeout(() => {
        for (let i = 0; i < batch && list.children.length < total; i += 1) {
          const sample = samples[i % samples.length];
          if (sample) list.appendChild(sample.cloneNode(true));
        }
        if (count) count.textContent = `Showing ${list.children.length} of ${total}`;
        if (status) status.textContent = `${batch} more products loaded`;
        busy = false;
        if (list.children.length >= total) {
          observer.disconnect();
          finish();
        }
      }, 600);
    },
    { rootMargin: '600px' },
  );
  observer.observe(loading);
});

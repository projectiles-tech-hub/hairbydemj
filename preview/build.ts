// Builds the design preview: every website page as a static HTML file, with
// sample data, plus galleries of the app and admin designs exported from Figma.
// Output goes to preview-dist/, which Vercel serves (see docs/preview.md).
//
// Run with: npm run build:preview

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { each, esc } from '../server/site/html.js';
import { page } from '../server/site/layout.js';
import { renderNotFound, renderPage, SITE_PAGES } from '../server/site/pages.js';

const OUT = 'preview-dist';
const FIGMA = 'https://www.figma.com/design/MWNPPSFbXEmEqS9WtIx78N';

interface Shot {
  file: string;
  title: string;
}

async function shots(folder: string): Promise<Shot[]> {
  try {
    const raw = await readFile(join('preview', 'designs', folder, 'index.json'), 'utf8');
    return JSON.parse(raw) as Shot[];
  } catch {
    return [];
  }
}

async function write(path: string, html: string): Promise<void> {
  const dir = join(OUT, path);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), html);
}

function gallery(title: string, intro: string, folder: string, list: readonly Shot[], min: number): string {
  return page({
    title,
    preview: true,
    body:
      `<p class="small muted"><a class="link" href="/designs/">All pages</a> › ${esc(title)}</p><h1 class="h1">${esc(title)}</h1><p class="muted">${intro}</p>` +
      (list.length
        ? `<div class="gallery" style="--min:${min}px">${each(list, (s) => `<figure><a href="/designs/${folder}/${esc(s.file)}"><img src="/designs/${folder}/${esc(s.file)}" alt="${esc(s.title)} design" loading="lazy"></a><figcaption>${esc(s.title)}</figcaption></figure>`)}</div>`
        : `<p>The images are not exported yet. See the designs in <a class="link" href="${FIGMA}">Figma</a>.</p>`),
  });
}

async function main(): Promise<void> {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp('public', OUT, { recursive: true });

  for (const p of SITE_PAGES) await write(p.path, renderPage(p, { preview: true }));
  await writeFile(join(OUT, '404.html'), renderNotFound({ preview: true }));

  const app = await shots('app');
  const admin = await shots('admin');
  for (const folder of ['app', 'admin']) {
    const src = join('preview', 'designs', folder);
    try {
      const files = (await readdir(src)).filter((f) => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.webp'));
      await mkdir(join(OUT, 'designs', folder), { recursive: true });
      for (const f of files) await cp(join(src, f), join(OUT, 'designs', folder, f));
    } catch {
      // No exported images yet; the gallery page says so.
    }
  }

  const groups = ['Shopping', 'Account', 'Information and system'] as const;
  await write(
    'designs',
    page({
      title: 'Every page',
      preview: true,
      body:
        `<h1 class="h1">Every page in this preview</h1><p class="muted">The website pages below are real pages: open them on a phone, a tablet or a computer and tap through. Products, prices and photos are samples. The app and the staff admin are shown as pictures of the designs.</p>` +
        each(groups, (g) => `<section class="stack"><h2 class="h3">Website: ${g.toLowerCase()}</h2><div class="chips">${each(SITE_PAGES.filter((p) => p.group === g), (p) => `<a class="chip" href="${p.path}">${esc(p.title)}</a>`)}</div></section>`) +
        `<section class="stack"><h2 class="h3">Phone app</h2><p class="muted">${app.length} screens for iPhone and Android.</p><div class="row"><a class="btn btn--primary" href="/designs/app/">See the app screens</a></div></section>` +
        `<section class="stack"><h2 class="h3">Staff admin</h2><p class="muted">${admin.length} pages that staff use to run the store.</p><div class="row"><a class="btn btn--secondary" href="/designs/admin/">See the admin pages</a></div></section>`,
    }),
  );
  await write('designs/app', gallery('Phone app screens', 'Pictures of the app designs. Tap a picture to see it full size.', 'app', app, 220));
  await write('designs/admin', gallery('Staff admin pages', 'Pictures of the admin designs, made for a computer screen. Tap a picture to see it full size.', 'admin', admin, 320));

  console.log(`Preview built: ${SITE_PAGES.length} website pages, ${app.length} app screens, ${admin.length} admin pages, in ${OUT}/`);
}

await main();

// Open a generated PDF with the vendored pdf.js in headless Chromium and report
// what it actually contains: page count, every text item, and whether anything
// sits outside the page margins. Real verification, not a byte-count.
//
//   node tools/pdf-check.mjs <file.pdf> [rightMarginPt]
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const margin = Number(process.argv[3] || 40);
const bytes = [...readFileSync(file)];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('[pageerror]', e.message.slice(0, 160)));
await p.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'domcontentloaded' });
await p.addScriptTag({ url: '/designer/vendor/pdf.min.js' });

const out = await p.evaluate(async ({ data, margin }) => {
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = '/designer/vendor/pdf.worker.min.js';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages = [];
  let overflow = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n);
    const vp = pg.getViewport({ scale: 1 });
    const tc = await pg.getTextContent();
    const items = tc.items.map(i => ({ s: i.str, x: i.transform[4], y: i.transform[5], w: i.width }));
    for (const it of items) {
      if (it.x + it.w > vp.width - margin + 1.5) overflow.push({ page: n, text: it.s, right: (it.x + it.w).toFixed(1) });
      if (it.x < margin - 1.5) overflow.push({ page: n, text: it.s, left: it.x.toFixed(1) });
    }
    pages.push({ n, w: Math.round(vp.width), h: Math.round(vp.height), items: items.length,
                 text: items.map(i => i.s).join(' ') });
  }
  return { numPages: doc.numPages, pages, overflow, meta: (await doc.getMetadata()).info };
}, { data: bytes, margin });

console.log('PAGES     ', out.numPages, '  size', out.pages[0] ? out.pages[0].w + '×' + out.pages[0].h : '—');
console.log('TITLE     ', out.meta?.Title, '| Producer:', out.meta?.Producer);
console.log('TEXT ITEMS', out.pages.reduce((s, p) => s + p.items, 0));
console.log('OVERFLOW  ', out.overflow.length ? out.overflow.slice(0, 8) : 'none — every line sits inside the margins');
for (const pg of out.pages) console.log('\n--- page ' + pg.n + ' ---\n' + pg.text.slice(0, 1400));
await b.close();

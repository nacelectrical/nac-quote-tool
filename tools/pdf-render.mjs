// Render pages of a generated PDF to PNG, so a document can actually be LOOKED
// at rather than just asserted about. Uses the vendored pdf.js in headless
// Chromium, which is the same renderer the browser uses.
//
//   node tools/serve.mjs &
//   node tools/pdf-render.mjs <file.pdf> [pages]    # e.g. 1,2,8
//
// Writes /tmp/page-<n>.png.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-sandbox'] });
const p = await b.newPage({ viewport: { width: 900, height: 1300 } });
await p.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'domcontentloaded' });
await p.addScriptTag({ url: '/designer/vendor/pdf.min.js' });
const data = [...readFileSync(process.argv[2])];
const pageNums = (process.argv[3] || '1').split(',').map(Number);
const pngs = await p.evaluate(async ({ data, pageNums }) => {
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = '/designer/vendor/pdf.worker.min.js';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const out = [];
  for (const n of pageNums) {
    if (n > doc.numPages) continue;
    const pg = await doc.getPage(n);
    const vp = pg.getViewport({ scale: 1.6 });
    const c = document.createElement('canvas');
    c.width = vp.width; c.height = vp.height;
    await pg.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    out.push(c.toDataURL('image/png'));
  }
  return out;
}, { data, pageNums });
pngs.forEach((d, i) => writeFileSync(`/tmp/page-${pageNums[i]}.png`, Buffer.from(d.split(',')[1], 'base64')));
console.log('wrote', pngs.length, 'pages');
await b.close();

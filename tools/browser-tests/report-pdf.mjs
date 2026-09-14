// P6 — the two documents, generated as real PDF files and read back with
// pdf.js. This is the check that matters: not "a file was produced" but "the
// file opens, says what it should, and the customer one says nothing it
// shouldn't".
//
//   node tools/serve.mjs &   node tools/browser-tests/report-pdf.mjs
import { chromium } from 'playwright';
import { signInContext } from './signin.mjs';
import { writeFileSync } from 'node:fs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
let fail = 0;
const say = (n, c, x) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) fail++; };

const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, acceptDownloads: true });
await signInContext(ctx);
await ctx.route('**/rest/v1/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
const p = await ctx.newPage();
p.on('pageerror', e => console.log('   [pageerror]', e.message.slice(0, 160)));
await p.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'load' });
await p.waitForTimeout(1500);

// Build a real costed design through the app, exactly as an estimator would.
await p.locator('button', { hasText: 'Load the sample builder plan' }).first().click();
await p.waitForTimeout(2500);
await p.locator('button.tab', { hasText: 'Rooms' }).first().click();
await p.waitForTimeout(600);
const va = p.locator('button', { hasText: 'Verify all' });
if (await va.count()) await va.last().click();
await p.waitForTimeout(2200);
// Open the Plan tab so the viewer canvas is laid out and a real snapshot exists.
await p.locator('button.tab', { hasText: 'Plan' }).first().click();
await p.waitForTimeout(1500);

const ready = await p.evaluate(() => {
  const d = window.nacDesigner.design;
  return { stage: d.stage, bom: d.bom?.items?.length || 0, cost: d.commercials?.totalJobCost || 0 };
});
say('the design is complete and costed', ready.stage === 'complete' && ready.bom > 0 && ready.cost > 0,
  JSON.stringify(ready));

await p.addScriptTag({ url: '/designer/vendor/pdf.min.js' });

// Generate each PDF in the page and read it back with pdf.js.
async function makeAndRead(kind) {
  return p.evaluate(async (kind) => {
    const R = await import('/designer/ui/reports.mjs');
    // The real plan snapshot, exactly as the Reports button passes it.
    const snap = window.nacDesigner.viewer?.snapshot() || null;
    window.__snapMime = (/^data:([^;,]+)/.exec(snap || '') || [])[1] || 'none';
    const built = R.buildReportPdf(window.nacDesigner.design, kind, { logo: null, planSnapshot: snap });
    const pdfjs = window.pdfjsLib;
    pdfjs.GlobalWorkerOptions.workerSrc = '/designer/vendor/pdf.worker.min.js';
    const doc = await pdfjs.getDocument({ data: built.bytes.slice() }).promise;
    const pages = [];
    const overflow = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const pg = await doc.getPage(n);
      const vp = pg.getViewport({ scale: 1 });
      const items = (await pg.getTextContent()).items;
      for (const it of items) {
        const x = it.transform[4];
        if (x + it.width > vp.width - 38) overflow.push(n + ': ' + it.str);
        if (x < 38) overflow.push(n + ': (left) ' + it.str);
      }
      pages.push({ w: Math.round(vp.width), h: Math.round(vp.height),
                   text: items.map(i => i.str).join(' ') });
    }
    const info = (await doc.getMetadata()).info;
    return { numPages: doc.numPages, pages, overflow, info,
             filename: built.filename, size: built.bytes.length,
             base64: btoa(String.fromCharCode(...built.bytes.slice(0, 0))) };
  }, kind);
}

console.log('\n[internal] DOWNLOAD INTERNAL HVAC DESIGN PDF');
const I = await makeAndRead('internal');
const itext = I.pages.map(p => p.text).join('\n');
say('it is a PDF pdf.js can open', I.numPages >= 1, I.numPages + ' pages, ' + Math.round(I.size / 1024) + ' KB');
say('A4 pages', I.pages.every(p => p.w === 595 && p.h === 842), I.pages[0].w + '×' + I.pages[0].h);
say('every line sits inside the margins', I.overflow.length === 0, I.overflow.slice(0, 3).join(' | ') || 'clean');
say('it carries the NAC identity', /NAC Electrical/.test(itext) && /97 636 392 982/.test(itext));
say('it is titled the internal sheet', /Internal HVAC Design Sheet/.test(itext));
say('it carries the bill of materials', /BILL OF MATERIALS/i.test(itext));
say('it carries the costing', /TOTAL JOB COST/i.test(itext) && /\$[\d,]+\.\d\d/.test(itext));
say('it carries the room schedule', /ROOM SCHEDULE/i.test(itext) && /Living/.test(itext));
say('it carries the design assumptions', /DESIGN ASSUMPTIONS/i.test(itext));
say('the plan snapshot is a JPEG, which is what a PDF can embed directly',
  await p.evaluate(() => window.__snapMime) === 'image/jpeg', await p.evaluate(() => window.__snapMime));
say('the plan overlay went in as a picture, not as an apology',
  /FLOOR PLAN OVERLAY/i.test(itext) && !/could not be included/i.test(itext));
const snapSize = await p.evaluate(() => {
  const s = window.nacDesigner.viewer?.snapshot();
  if (!s) return null;
  return new Promise(r => { const im = new Image(); im.onload = () => r(im.width + '×' + im.height); im.src = s; });
});
say('the snapshot is a real picture, not a 1-pixel canvas',
  !!snapSize && Number(String(snapSize).split('×')[0]) > 200, String(snapSize));
say('every page is numbered', I.pages.every((p, i) => p.text.includes('Page ' + (i + 1) + ' of ' + I.numPages)));
say('the file has a findable name', /^NAC-Internal-HVAC-Design-Sheet-.*\.pdf$/.test(I.filename), I.filename);

console.log('\n[customer] DOWNLOAD CUSTOMER HVAC DESIGN SUMMARY PDF');
const C = await makeAndRead('customer');
const ctext = C.pages.map(p => p.text).join('\n');
say('it is a PDF pdf.js can open', C.numPages >= 1, C.numPages + ' pages, ' + Math.round(C.size / 1024) + ' KB');
say('every line sits inside the margins', C.overflow.length === 0, C.overflow.slice(0, 3).join(' | ') || 'clean');
say('it is titled the customer summary', /HVAC Design Summary/.test(ctext));
say('it says what the system is', /Your system/i.test(ctext) && /reverse cycle ducted/i.test(ctext));
say('it lists the rooms', /ROOMS AND AIRFLOW/i.test(ctext) && /Living/.test(ctext));
say('it says what is included', /WHAT IS INCLUDED/i.test(ctext) && /commissioning/i.test(ctext));

// The whole point of a separate customer document.
const dollars = ctext.match(/\$\s?[\d,]+(\.\d\d)?/g) || [];
say('NO dollar figure appears anywhere in it', dollars.length === 0, dollars.slice(0, 5).join(', ') || 'none');
const leaks = ['supplier', 'margin', 'gross profit', 'unit cost', 'job fee', 'placeholder',
               'bill of materials', 'MMEM', 'GST', 'sell price', 'part code', 'PRICE REQUIRED']
  .filter(w => new RegExp(w, 'i').test(ctext));
say('NO cost, margin or supplier wording appears', leaks.length === 0, leaks.join(', ') || 'none');
const internal = ['STATIC PRESSURE CHECK', 'confidence', 'px/mm', 'NOT ACKNOWLEDGED',
                  'DESIGN ASSUMPTIONS', 'Pressure drop', 'index run']
  .filter(w => new RegExp(w, 'i').test(ctext));
say('NO internal engineering detail appears', internal.length === 0, internal.join(', ') || 'none');
say('the customer file has its own name', /^NAC-HVAC-Design-Summary-.*\.pdf$/.test(C.filename), C.filename);

// And the button the estimator actually presses.
console.log('\n[button] the Reports button, end to end');
await p.locator('button', { hasText: 'Reports' }).first().click();
await p.waitForTimeout(600);
const menu = await p.locator('.dlg-body').innerText();
say('the menu offers both downloads',
  /DOWNLOAD INTERNAL HVAC DESIGN PDF/.test(menu) && /DOWNLOAD CUSTOMER HVAC DESIGN SUMMARY PDF/.test(menu));
say('and keeps the print path as a fallback', /View the internal sheet/.test(menu));

const dl = p.waitForEvent('download', { timeout: 15000 }).catch(() => null);
await p.locator('.dlg-option', { hasText: 'DOWNLOAD CUSTOMER HVAC DESIGN SUMMARY PDF' }).first().click();
const download = await dl;
say('pressing it really downloads a file', !!download, download ? await download.suggestedFilename() : 'no download');
if (download) {
  const path = '/tmp/nac-customer-summary.pdf';
  await download.saveAs(path);
  const { statSync, readFileSync } = await import('node:fs');
  const head = readFileSync(path).subarray(0, 8).toString('latin1');
  say('the saved file is a PDF on disk', head.startsWith('%PDF-'), head.trim() + ', ' + statSync(path).size + ' bytes');
}
await p.waitForTimeout(800);
const toast = await p.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
say('the app says what it saved, not just "done"', /\.pdf/.test(toast) && /KB/.test(toast), toast || '(none)');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
await b.close();
process.exit(fail ? 1 : 0);

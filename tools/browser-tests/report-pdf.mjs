// P6 — the two documents, generated as real PDF files and read back with
// pdf.js. This is the check that matters: not "a file was produced" but "the
// file opens, says what it should, and the customer one says nothing it
// shouldn't".
//
//   node tools/serve.mjs &   node tools/browser-tests/report-pdf.mjs
import { chromium } from 'playwright';
import { ensureAdvanced } from './advanced.mjs';
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
await ensureAdvanced(p); await p.locator('button.tab', { hasText: 'Rooms' }).first().click();
await p.waitForTimeout(600);
const va = p.locator('button', { hasText: 'Verify all' });
if (await va.count()) await va.last().click();
await p.waitForTimeout(2200);
// Open the Plan tab so the viewer canvas is laid out and a real snapshot exists.
await ensureAdvanced(p); await p.locator('button.tab', { hasText: 'Plan' }).first().click();
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
    // The equipment inset goes in the same way the Reports button passes it.
    const inset = window.nacDesigner.viewer?.equipmentInset() || null;
    window.__insetMime = (/^data:([^;,]+)/.exec(inset || '') || [])[1] || 'none';
    // THE SAME FOUR PICTURES THE REPORTS BUTTON PASSES. The landscape sheet
    // takes the plan WITHOUT the key baked in plus the key on its own, so it
    // can give the drawing the full height of the paper; testing with only
    // `planSnapshot` exercised the layout the app no longer uses.
    const plate = window.nacDesigner.viewer?.snapshot({ clean: true, legend: false }) || null;
    const planLegend = window.nacDesigner.viewer?.legendStrip() || null;
    window.__plateMime = (/^data:([^;,]+)/.exec(plate || '') || [])[1] || 'none';
    window.__keyMime = (/^data:([^;,]+)/.exec(planLegend || '') || [])[1] || 'none';
    const built = R.buildReportPdf(window.nacDesigner.design, kind,
      { logo: null, planSnapshot: snap, planPlate: plate, planLegend,
        equipmentInset: inset });
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
                   text: items.map(i => i.str).join(' '),
                   // PDF user space, origin bottom-left — so a bigger y is
                   // higher up the page.
                   items: items.map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5] })) });
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
// A4 EITHER WAY UP. The floor plan gets its own LANDSCAPE sheet — a house plan
// is wider than it is tall, and squeezed onto a portrait page the duct sizes
// stop being readable. Every other page stays portrait.
const portrait = I.pages.filter(p => p.w === 595 && p.h === 842);
const landscape = I.pages.filter(p => p.w === 842 && p.h === 595);
say('every page is A4, portrait or landscape',
  portrait.length + landscape.length === I.pages.length,
  I.pages.map(p => p.w + '×' + p.h).join(' '));
say('the floor plan has a landscape sheet of its own', landscape.length === 1,
  landscape.length + ' landscape page(s)');
say('everything else is portrait', portrait.length === I.pages.length - 1,
  portrait.length + ' portrait page(s)');
say('page 1 opens with the summary', /DESIGN SUMMARY/i.test(I.pages[0].text));
say('every line sits inside the margins', I.overflow.length === 0, I.overflow.slice(0, 3).join(' | ') || 'clean');
say('the equipment inset is embedded and described',
  /EQUIPMENT ARRANGEMENT/i.test(itext) && /RETURN PLENUM/i.test(itext) &&
  /SUPPLY PLENUM/i.test(itext),
  'inset source ' + (await p.evaluate(() => window.__insetMime)));
// ── THE TYPOGRAPHY DEFECTS, READ BACK OUT OF THE FILE ──────────────────────
say('no bullet printed as a question mark', !/\?\s+(Return|Supply|Fan-coil|Each|The)/.test(itext),
  (itext.match(/\?[^\n]{0,40}/g) || []).slice(0, 2).join(' | ') || 'none');
say('the bullet character survived into the text layer', /\u2022/.test(itext),
  (itext.match(/\u2022/g) || []).length + ' bullet(s)');
// THE LANDSCAPE CAPTION MUST CLEAR THE FOOTER. Both are drawn near the bottom
// of the same page, and a fixed allowance for a caption that wrapped to two
// lines put the second one across the footer rule.
const land = I.pages.find(p => p.w === 842);
// The sheet's POSITION is not the test — where it lands depends on how many
// warnings the job carries ahead of it, and a job with more blockers than
// another legitimately pushes it later. What must be true is that the page it
// does land on is captioned and footed like every other page.
const landPageNo = /Page (\d+) of (\d+)/.exec(land.text);
say('the floor-plan page has both a caption and a footer',
  /Duct colour is SIZE/.test(land.text) && !!landPageNo,
  landPageNo ? 'page ' + landPageNo[1] + ' of ' + landPageNo[2] : 'no page number on it');
const capBottom = land.items.filter(i => /Duct colour is SIZE|follows diameter/.test(i.str))
  .reduce((n, i) => Math.min(n, i.y), Infinity);
const footTop = land.items.filter(i => /nacelectrical\.com\.au|Page \d+ of/.test(i.str))
  .reduce((n, i) => Math.max(n, i.y), -Infinity);
say('the caption sits clear above the footer', capBottom - footTop >= 8,
  'caption bottom ' + capBottom.toFixed(1) + ' pt, footer top ' + footTop.toFixed(1) + ' pt');

// ── THE LANDSCAPE SHEET, SIZED ────────────────────────────────────────────
//
// Nick: "The landscape page has excessive unused white space. Increase the
// floor-plan drawing by approximately 25-35% while maintaining margins. Move
// the zone schedule, duct legend and symbol legend into a compact aligned side
// column."
//
// A house plan taller than it is wide is HEIGHT-bound on a landscape sheet, so
// this is measured off the image placement matrix in the file: build the page
// BOTH ways from the same drawing and compare how much paper the plan gets.
const grow = await p.evaluate(async () => {
  const R = await import('/designer/ui/reports.mjs');
  const { REPORT_KIND } = await import('/designer/engines/report-doc.mjs');
  const v = window.nacDesigner.viewer;
  const snap = v.snapshot({ clean: true, legend: true });
  const plate = v.snapshot({ clean: true, legend: false });
  const key = v.legendStrip();
  const dims = (url) => new Promise((res) => { const i = new Image();
    i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight }); i.src = url; });
  const bytesOf = (o) => R.buildReportPdf(window.nacDesigner.design, REPORT_KIND.INTERNAL,
    { logo: null, planSnapshot: snap, equipmentInset: null, ...o }).bytes;
  // `a 0 0 d e f cm /ImN Do` — the landscape plan is the first picture in the
  // file, because page 1 carries none.
  const firstImage = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    const m = /([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\s*\/Im\d+ Do/.exec(s);
    return m ? { w: +m[1], h: +m[2], x: +m[3], y: +m[4] } : null;
  };
  const before = firstImage(bytesOf({}));
  const after = firstImage(bytesOf({ planPlate: plate, planLegend: key }));
  const snapDim = await dims(snap), plateDim = await dims(plate);
  return { before, after, snapDim, plateDim,
           ptPerPxBefore: before && before.h / snapDim.h,
           ptPerPxAfter: after && after.h / plateDim.h };
});
const gain = grow.ptPerPxAfter / grow.ptPerPxBefore - 1;
say('the key is captured apart from the drawing',
  (await p.evaluate(() => window.__keyMime)) === 'image/jpeg' &&
  (await p.evaluate(() => window.__plateMime)) === 'image/jpeg',
  'plate ' + (await p.evaluate(() => window.__plateMime)) +
  ', key ' + (await p.evaluate(() => window.__keyMime)));
// How much is bought depends on the plan: a drawing that is taller than it is
// wide is height-bound on this sheet and gains the most, a wide one gains less.
// So the floor asserted here is the one that must hold for ANY plan, and the
// figure is printed so the gain on the job in front of you is on the record.
say('the plan is drawn materially larger than on the one-bitmap page',
  gain >= 0.12,
  (gain * 100).toFixed(1) + '% linear — ' +
  grow.before.w.toFixed(0) + 'x' + grow.before.h.toFixed(0) + ' pt becomes ' +
  grow.after.w.toFixed(0) + 'x' + grow.after.h.toFixed(0) + ' pt');
say('the height it gained is what the column bought it',
  grow.after.h > grow.before.h * 1.1,
  grow.before.h.toFixed(0) + ' pt of page height becomes ' + grow.after.h.toFixed(0) + ' pt');
say('the column carries the page title, so the drawing keeps the full height',
  /FLOOR PLAN . DUCT LAYOUT/.test(land.text), 'title on the landscape sheet');
say('the plan and the key are two separate pictures on that sheet',
  grow.after.x + grow.after.w < 842 - 24,
  'plan ends at ' + (grow.after.x + grow.after.w).toFixed(0) + ' pt of 842');
// ── NO PAGE IS THROWN AWAY ────────────────────────────────────────────────
//
// Nick: "Page 5 is mostly blank. Allow tables to continue naturally so the
// internal report does not contain an unnecessarily empty page." A hard break
// before every major section did that — the room loads ran a few rows onto a
// fresh page and the break after threw the rest of it away.
const filled = I.pages.map((pg, i) => {
  const rows = pg.items.filter(it => !/^Page \d+ of|NAC Electrical|nacelectrical/.test(it.str));
  const top = rows.reduce((n, it) => Math.max(n, it.y), 0);
  const bot = rows.reduce((n, it) => Math.min(n, it.y), Infinity);
  return { page: i + 1, items: rows.length, span: rows.length ? top - bot : 0,
           landscape: pg.w === 842 };
});
const sparse = filled.filter(f => !f.landscape && f.items > 0 && f.items < 40 &&
                                  f.span < 200 && f.page < I.pages.length);
say('no page in the middle of the document is nearly empty', sparse.length === 0,
  sparse.length ? sparse.map(f => 'page ' + f.page + ': ' + f.items + ' lines over ' +
    Math.round(f.span) + ' pt').join(' | ')
  : filled.map(f => f.items).join('/') + ' lines per page');
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

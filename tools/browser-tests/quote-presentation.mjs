// ─────────────────────────────────────────────────────────────────────────────
// BROWSER ACCEPTANCE FOR THE CUSTOMER PRESENTATION
//
// The node suite proves what the documents CONTAIN. These prove what they DO in
// a real browser at real viewport sizes: nothing overflows sideways on a phone,
// nothing is clipped, every control can be hit with a thumb, the gallery opens
// by touch, and the admin screen refuses to publish content nobody approved.
//
//   node tools/browser-tests/quote-presentation.mjs
//
// Needs the static server on 127.0.0.1:8777 (sh /tmp/restart-server.sh).
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { buildPresentation } from '../../designer/engines/presentation.mjs';
import { renderPresentationHtml } from '../../designer/ui/presentation-html.mjs';
import { presentationPrintHtml, renderPresentationPdf } from '../../designer/ui/presentation-pdf.mjs';
import { buildDemoDesign, DEMO_CONTENT, DEMO_IMAGES } from '../../tests/fixtures/demo-presentation.mjs';

const BASE = process.env.NAC_TEST_BASE || 'http://127.0.0.1:8777';
const OUT = process.env.NAC_SHOT_DIR || '/tmp/nac-quote-shots';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let passed = 0, failed = 0;
const ok = (cond, name, detail = '') => {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (detail ? '  — ' + detail : '')); }
};

mkdirSync(OUT, { recursive: true });

/** A real PNG, so the browser's canvas re-encode has something to work on. */
const PNG_1200 = (() => {
  const { deflateSync } = require('node:zlib');
  const w = 1200, h = 900;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      raw[o++] = (x * 255 / w) | 0; raw[o++] = (y * 255 / h) | 0; raw[o++] = 120; raw[o++] = 255;
    }
  }
  const table = [];
  for (let i = 0; i < 256; i++) { let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0; }
  const crc = (buf) => { let c = 0xFFFFFFFF;
    for (const b of buf) c = table[(c ^ b) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const cs = Buffer.alloc(4); cs.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, cs]); };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
  ]).toString('base64');
})();

const demo = await buildDemoDesign();
const hero = DEMO_IMAGES.find(i => i.id === 'hero');
const built = buildPresentation({
  design: demo.out,
  customer: { name: 'Sample Customer', address: '12 Example Street, Peregian Springs QLD 4573' },
  job: { siteAddress: '12 Example Street, Peregian Springs QLD 4573' },
  content: DEMO_CONTENT,
  proposalNumber: 'NAC-2026-0184',
  preparedAt: '2026-09-22T00:00:00Z', expiresAt: '2026-10-22T00:00:00Z',
  revision: 1, status: 'issued',
  heroImage: { src: hero.derivatives[1].ref, alt: hero.alt, width: 1600, height: 700,
               srcset: hero.derivatives.map(d => ({ ref: d.ref, width: d.width })) }
});
if (!built.ok) { console.error('demo presentation did not build'); process.exit(1); }
const P = built.presentation;
const HTML = renderPresentationHtml(P);

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

// ── 1. layout at every viewport Nick named ──────────────────────────────────
const VIEWPORTS = [
  ['iphone-portrait',  390,  844, 3, true],
  ['ipad-portrait',    820, 1180, 2, true],
  ['ipad-landscape',  1180,  820, 2, true],
  ['desktop',         1440,  900, 1, false]
];

console.log('\nLayout');
for (const [name, w, h, dpr, touch] of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h },
    deviceScaleFactor: dpr, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  await page.setContent(HTML, { waitUntil: 'load' });
  await page.waitForTimeout(350);

  const probe = await page.evaluate(() => {
    const de = document.documentElement;
    // An element inside a deliberately scrollable strip (the section nav) is
    // not page overflow, so those are excluded rather than reported.
    const scrollable = [...document.querySelectorAll('*')].filter(e => {
      const s = getComputedStyle(e);
      return s.overflowX === 'auto' || s.overflowX === 'scroll';
    });
    const inScroller = (e) => scrollable.some(s => s !== e && s.contains(e));

    const over = [];
    for (const e of document.querySelectorAll('body *')) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || inScroller(e)) continue;
      if (r.right > de.clientWidth + 1.5) {
        over.push(e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 24));
      }
    }
    const clipped = [];
    for (const e of document.querySelectorAll('h1,h2,h3,dd,strong,em,[data-total]')) {
      if (e.scrollWidth > e.clientWidth + 1) {
        clipped.push((e.textContent || '').trim().slice(0, 40));
      }
    }
    // Touch target = the thing a finger actually lands on. A checkbox inside a
    // big label is hit by tapping the label, so the label is measured.
    const small = [];
    for (const e of document.querySelectorAll('a.btn,button,summary,input,select')) {
      const target = e.closest('label') || e;
      const r = target.getBoundingClientRect();
      if (r.height > 0 && r.height < 44) {
        small.push(e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 20)
          + ' ' + Math.round(r.height) + 'px');
      }
    }
    return { overflow: de.scrollWidth - de.clientWidth, over: over.slice(0, 6),
             clipped: clipped.slice(0, 6), small: small.slice(0, 6) };
  });

  ok(probe.overflow <= 0, name + ': no horizontal page overflow', probe.overflow + 'px');
  ok(probe.over.length === 0, name + ': nothing sticks out sideways', probe.over.join(', '));
  ok(probe.clipped.length === 0, name + ': no clipped headings, totals or model numbers',
     probe.clipped.join(' | '));
  ok(probe.small.length === 0, name + ': every control is at least 44px tall',
     probe.small.join(', '));

  await page.screenshot({ path: OUT + '/quote-' + name + '.png', fullPage: true });
  await ctx.close();
}

// ── 2. the gallery opens by touch on an iPad ────────────────────────────────
console.log('\nTouch');
{
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 },
    deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.setContent(HTML, { waitUntil: 'load' });
  await page.waitForTimeout(300);

  const shot = page.locator('.shot-btn').first();
  await shot.tap();
  await page.waitForTimeout(200);
  ok(await page.locator('#lightbox').isVisible(), 'tapping an installation opens the lightbox');
  ok(await page.locator('#lbImg').getAttribute('src') !== '', 'the lightbox has an image');
  await page.locator('#lbClose').tap();
  await page.waitForTimeout(200);
  ok(!(await page.locator('#lightbox').isVisible()), 'the close control dismisses it by touch');

  // An upgrade can be selected by tapping its label, not just its checkbox.
  const before = await page.locator('.opt-in').first().isChecked();
  await page.locator('label.opt').first().tap();
  await page.waitForTimeout(150);
  ok(await page.locator('.opt-in').first().isChecked() !== before,
     'an upgrade toggles when the whole card is tapped');

  // The sticky bar keeps the total and the accept action in reach.
  ok(await page.locator('#sticky .sticky-btn').isVisible(),
     'the sticky total and accept action stay on screen');
  await ctx.close();
}

// ── 3. the acceptance form validates before it calls anything ───────────────
console.log('\nAcceptance');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 },
    hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.setContent(HTML, { waitUntil: 'load' });
  await page.evaluate(() => {
    window.__calls = [];
    window.NACQuote = { accept: (p) => window.__calls.push(p) };
  });
  await page.locator('#acceptBtn').tap();
  await page.waitForTimeout(150);
  ok(await page.locator('#acceptErr').isVisible(), 'accepting with no name is refused');
  ok((await page.evaluate(() => window.__calls.length)) === 0,
     'nothing is sent until the form is valid');

  await page.locator('#acc-name').fill('Sample Customer');
  await page.locator('#acceptBtn').tap();
  await page.waitForTimeout(150);
  ok((await page.evaluate(() => window.__calls.length)) === 0,
     'accepting without ticking the terms is refused');

  await page.locator('#acc-terms').check();
  await page.locator('#acceptBtn').tap();
  await page.waitForTimeout(200);
  const calls = await page.evaluate(() => window.__calls);
  ok(calls.length === 1, 'a complete form submits once');
  ok(calls[0] && calls[0].name === 'Sample Customer' && calls[0].acknowledgedTerms === true,
     'the acceptance carries the name and the acknowledgement');
  await ctx.close();
}

// ── 4. print pages are complete and numbered ────────────────────────────────
console.log('\nPrint and PDF');
{
  const pdf = await renderPresentationPdf(browser, P);
  writeFileSync(OUT + '/quote-proposal.pdf', pdf);
  ok(pdf.length > 20000, 'a PDF is produced', pdf.length + ' bytes');

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.setContent(presentationPrintHtml(P), { waitUntil: 'load' });
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(250);
  const printProbe = await page.evaluate(() => ({
    sticky: !!document.getElementById('sticky'),
    nav: !!document.querySelector('.nav'),
    form: !!document.getElementById('acceptForm'),
    scripts: document.querySelectorAll('script').length,
    total: (document.querySelector('[data-total]') || {}).textContent || '',
    footer: (document.querySelector('.foot') || {}).textContent || ''
  }));
  ok(!printProbe.sticky, 'the print document drops the sticky bar');
  ok(!printProbe.nav, 'the print document drops the section navigation');
  ok(!printProbe.form, 'the print document drops the acceptance form');
  ok(printProbe.scripts === 0, 'the print document ships no script');
  ok(printProbe.total.includes('$'), 'the total is still on the printed page');
  ok(/revision/i.test(printProbe.footer), 'the footer carries the revision');
  await ctx.close();
}

// ── 5. the admin screen enforces approval ───────────────────────────────────
console.log('\nAdmin');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  // The content endpoint is not available against the static server, so the
  // screen is expected to fall back to a local copy and say so.
  await page.route('**/api/presentation-content', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ content: {} })
  }));
  await page.goto(BASE + '/quote-presentation.html', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  ok(errors.length === 0, 'the admin screen loads without a script error', errors[0] || '');
  ok(await page.locator('#p-branding').isVisible(), 'the branding panel opens first');

  await page.getByRole('button', { name: 'Reviews' }).click();
  await page.locator('button:has-text("+ Add review")').click();
  await page.waitForTimeout(200);
  ok(await page.locator('#p-reviews .pill.no').first().isVisible(),
     'a new review is marked withheld until it is approved');
  const why = await page.locator('#p-reviews .why').first().textContent();
  ok(/approved/i.test(why || ''), 'the screen says WHY it is withheld', why || '');

  await page.getByRole('button', { name: 'Preview' }).click();
  await page.waitForTimeout(600);
  ok(await page.locator('#p-preview iframe').isVisible(), 'the preview renders a proposal');
  // Strip style and script before checking: CSS is full of the word "margin",
  // and matching it would make this assertion meaningless.
  const previewHtml = await page.evaluate(() =>
    ((document.querySelector('#p-preview iframe') || {}).srcdoc || '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, ''));
  ok(!/gross\s*(profit|margin)|supplier\s*cost|job\s*cost/i.test(previewHtml),
     'the preview shows no internal commercial data');
  await page.screenshot({ path: OUT + '/admin-quote-presentation.png', fullPage: false });
  await ctx.close();
}

// ── 6. images go to object storage, not into the library document ───────────
console.log('\nImage storage');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route('**/api/presentation-content', r => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ content: {} })
  }));

  // Stand in for the endpoint, and record exactly what the browser sent so the
  // test can prove the original travels and the derivatives are re-encodes.
  const sent = [];
  await page.route('**/api/presentation-media', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    sent.push(body);
    if (body.action === 'status') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ configured: true, keyVariable: 'SUPABASE_SERVICE_KEY',
          buckets: { public: 'nac-quote-media', private: 'nac-quote-originals' },
          limits: { originalBytes: 20971520 } }) });
    }
    if (body.action === 'delete') {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ ok: true, removed: 3 }) });
    }
    const base = 'https://icnznjhwybryizbdqrgx.supabase.co/storage/v1/object/public/nac-quote-media/';
    const id = 'img_' + 'a'.repeat(32);
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ok: true, asset: {
        id, alt: '', approved: false, tags: [], focalPoint: { x: 0.5, y: 0.5 },
        derivatives: (body.derivatives || []).map(d =>
          ({ ref: base + id + '/w' + d.width + '.jpg', width: d.width,
             height: d.height, format: 'jpg', bytes: 1000 })),
        original: { bucket: 'nac-quote-originals', path: id + '/original.jpg',
                    width: 1200, height: 900, bytes: 40000, retained: true },
        exifStripped: true, gpsRemoved: true } }) });
  });

  await page.goto(BASE + '/quote-presentation.html', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Product images' }).click();
  await page.waitForTimeout(300);

  const notice = await page.locator('#p-images .note').first().textContent();
  ok(/Storage ready/i.test(notice || ''), 'the screen confirms storage before anyone uploads',
     notice || '');

  // A real PNG through a real file input, so makeDerivatives does real work.
  await page.setInputFiles('#p-images input[type=file]', {
    name: 'install.png', mimeType: 'image/png',
    buffer: Buffer.from(PNG_1200, 'base64')
  });
  await page.waitForTimeout(1800);

  const upload = sent.find(b => b.action === 'upload' || (!b.action && b.derivatives));
  ok(!!upload, 'an upload request was made');
  ok(upload && (upload.derivatives || []).length >= 1, 'web copies were generated in the browser');
  ok(upload && upload.original && !!upload.original.data,
     'the original travels to the private bucket');
  ok(upload && (upload.derivatives || []).every(d => !String(d.data || '').startsWith('data:')),
     'derivatives are sent as raw base64, not data URIs');

  const state = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#p-images .row')];
    const sizes = rows.map(r => (r.textContent || '')).join(' ');
    return { rows: rows.length, text: sizes };
  });
  ok(/in object storage/.test(state.text), 'the new image reports as stored, not inline');
  ok(/Withheld/i.test(state.text), 'a freshly uploaded image is not approved');
  ok(!/still inside the library document/.test(state.text),
     'nothing was written back into the library document');
  ok(errors.length === 0, 'no script error during upload', errors[0] || '');

  // Deleting removes the stored objects, not just the record.
  page.once('dialog', d => d.accept());
  await page.locator('#p-images .btn.danger').first().click();
  await page.waitForTimeout(500);
  ok(sent.some(b => b.action === 'delete'), 'deleting an image removes it from storage too');
  await ctx.close();
}

await browser.close();
console.log('\n' + passed + ' passed, ' + failed + ' failed');
console.log('Artefacts in ' + OUT);
process.exit(failed ? 1 : 0);

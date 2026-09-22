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

await browser.close();
console.log('\n' + passed + ' passed, ' + failed + ' failed');
console.log('Artefacts in ' + OUT);
process.exit(failed ? 1 : 0);

// THE CUSTOMER'S OWN PAGE, ON THE DEVICE THEY READ IT ON.
//
// Nick, 16 October 2026: "Confirm the mobile layout controls work and images
// load... Confirm failed saves or failed acceptance never display a false
// success message."
//
// This loads the TEST QUOTE that tools/quote-only-proof.mjs builds — NAC's own
// photographs, NAC's own approved reviews, the real price — and drives it at
// phone, iPad and laptop widths. The page's server hooks (window.NACQuote) are
// stubbed, so the acceptance path can be made to succeed AND to fail.
//
//   node tools/browser-tests/quote-page-customer.mjs [phone|ipad|laptop]

import { chromium } from 'playwright';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildTestQuote } from '../quote-only-proof.mjs';
import { renderPresentationHtml } from '../../designer/ui/presentation-html.mjs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const SIZES = { phone: [390, 844], ipad: [820, 1180], laptop: [1440, 1000] };
const which = process.argv[2] || 'phone';
const [width, height] = SIZES[which] || SIZES.phone;

let fail = 0;
const say = (n, c, x) => {
  console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  if (!c) fail++;
};

const { built } = buildTestQuote();
if (!built.ok) {
  console.error('the test quote did not build:',
    built.blockers.map(b => b.code).join(', '));
  process.exit(1);
}
const dir = mkdtempSync(join(tmpdir(), 'nac-quote-page-'));
const file = join(dir, 'quote.html');
writeFileSync(file, renderPresentationHtml(built.presentation, { token: 'TESTQUOTE' }));

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2,
                                     hasTouch: which !== 'laptop' });
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

// The server hooks the page calls. `window.__mode` decides whether the
// acceptance succeeds or fails, so both can be driven.
await page.addInitScript(() => {
  window.__calls = [];
  window.__mode = 'ok';
  window.NACQuote = {
    onOptionsChanged: (opts, sys) => window.__calls.push({ k: 'options', opts, sys }),
    onSystemChanged: (sys) => window.__calls.push({ k: 'system', sys }),
    decline: () => window.__calls.push({ k: 'decline' }),
    ask: () => window.__calls.push({ k: 'ask' }),
    accept: async (payload) => {
      window.__calls.push({ k: 'accept', payload });
      if (window.__mode === 'fail') throw new Error('the network dropped');
      return { ok: true };
    }
  };
});

await page.goto('file://' + file, { waitUntil: 'load' });
await page.waitForTimeout(500);

console.log('\n  ' + which + '  ' + width + '×' + height + '\n');

// ── IT IS LABELLED ──────────────────────────────────────────────────────────
say('the page says TEST QUOTE before anything else',
  (await page.locator('.test-banner').count()) === 1
  && /TEST QUOTE/.test(await page.locator('.test-banner').innerText()));

// ── THE IMAGES LOAD ─────────────────────────────────────────────────────────
// The lightbox image is deliberately empty until a gallery photograph is
// opened, so it is not one of the page's pictures.
const imgs = await page.$$eval('img:not(#lbImg)', ns => ns.map(n => ({
  src: (n.currentSrc || n.src || '').slice(0, 24),
  w: n.naturalWidth, h: n.naturalHeight, alt: n.alt })));
say('every image on the page actually loaded',
  imgs.length > 0 && imgs.every(i => i.w > 0 && i.h > 0),
  imgs.filter(i => !i.w).map(i => i.src).join(', '));
say('every image carries alt text', imgs.every(i => i.alt && i.alt.trim().length > 3),
  imgs.filter(i => !i.alt || i.alt.trim().length <= 3).map(i => i.src).join(', '));

// ── NOTHING RUNS OFF THE SIDE ───────────────────────────────────────────────
say('the page does not scroll sideways',
  !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)));

// ── EVERY CONTROL IS REACHABLE WITH A FINGER ────────────────────────────────
// What matters is the TAPPABLE AREA, not the box the browser paints. A 22px
// tick box inside a label is a whole row wide: tapping anywhere on the card
// toggles it, which is what a thumb needs. So each control is measured at its
// label when it has one, and only a control with no larger hit area fails.
const small = await page.$$eval(
  'button, a.btn, input[type=checkbox], input[type=radio], input[type=number], summary',
  ns => ns.filter(n => n.offsetParent !== null)
    .map(n => {
      const hit = n.closest('label') || n;
      const r = hit.getBoundingClientRect();
      return { t: (n.textContent || n.type || n.tagName).trim().slice(0, 28),
               w: Math.round(r.width), h: Math.round(r.height) };
    })
    .filter(x => x.h < 44 || x.w < 44));
say('no control is too small to hit', small.length === 0,
  small.map(s => s.t + ' ' + s.w + 'x' + s.h).join(', '));

// ── THE PRICE FOLLOWS THE CUSTOMER'S CHOICES ────────────────────────────────
const total = async () => (await page.locator('[data-total]').first().innerText()).trim();
say('the page opens on the issued total', (await total()) === '$17,817', await total());

await page.locator('.opt-in').first().uncheck();
await page.waitForTimeout(200);
say('removing an upgrade takes its price off', (await total()) === '$16,467', await total());

await page.locator('.opt-in').first().check();
await page.waitForTimeout(200);
say('putting it back puts the price back', (await total()) === '$17,817', await total());

await page.locator('.opt-q').first().fill('2');
await page.locator('.opt-q').first().dispatchEvent('input');
await page.waitForTimeout(200);
say('changing a count changes the total', (await total()) === '$17,597', await total());

await page.locator('.opt-q').first().fill('999');
await page.locator('.opt-q').first().dispatchEvent('input');
await page.waitForTimeout(200);
const clamped = await page.locator('.opt-q').first().inputValue();
say('a count past the maximum is clamped in the page too', clamped === '8', clamped);

// ── SWITCHING SYSTEMS WITHDRAWS WHAT DOES NOT FIT ───────────────────────────
await page.locator('.sys-in').nth(1).check();
await page.waitForTimeout(250);
const hidden = await page.$$eval('.opt-li', ns => ns.map(n => n.hidden));
say('a Daikin-only upgrade leaves the page on a Braemar', hidden.every(h => h === true),
  JSON.stringify(hidden));
say('the Braemar price is the Braemar price', (await total()) === '$14,553', await total());

await page.locator('.sys-in').nth(0).check();
await page.waitForTimeout(250);
await page.locator('.opt-q').first().fill('4');
await page.locator('.opt-q').first().dispatchEvent('input');
await page.waitForTimeout(200);
say('switching back restores the Daikin offer', (await total()) === '$17,817', await total());

// ── ACCEPTING ───────────────────────────────────────────────────────────────
await page.fill('#acc-name', 'Test Quote — do not send');
await page.check('#acc-terms');

// A signature, drawn the way a finger draws one.
const pad = await page.locator('#acc-sig').boundingBox();
if (pad) {
  await page.mouse.move(pad.x + 30, pad.y + pad.height / 2);
  await page.mouse.down();
  await page.mouse.move(pad.x + 120, pad.y + 20, { steps: 8 });
  await page.mouse.move(pad.x + 200, pad.y + pad.height - 20, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(150);
}
const signed = await page.evaluate(() => {
  const c = document.getElementById('acc-sig');
  if (!c) return false;
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true;
  return false;
});
say('the signature pad takes a stroke', signed);

// ── A FAILED ACCEPTANCE NEVER SAYS IT WORKED ────────────────────────────────
await page.evaluate(() => { window.__mode = 'fail'; });
await page.click('#acceptBtn');
await page.waitForTimeout(600);
const afterFail = (await page.locator('body').innerText());
say('a failed acceptance does not claim success',
  !/thank you|accepted|we have your acceptance/i.test(
    afterFail.split('Accept your proposal')[1] || ''),
  (afterFail.split('Accept your proposal')[1] || '').slice(0, 160).replace(/\s+/g, ' '));
const sentOnFail = await page.evaluate(() => window.__calls.filter(c => c.k === 'accept').length);
say('the failed acceptance did reach the server hook', sentOnFail === 1, String(sentOnFail));

// ── AND A REAL ONE SENDS WHAT THE CUSTOMER WAS LOOKING AT ───────────────────
await page.evaluate(() => { window.__mode = 'ok'; });
await page.click('#acceptBtn');
await page.waitForTimeout(600);
const payload = await page.evaluate(
  () => (window.__calls.filter(c => c.k === 'accept').pop() || {}).payload);
say('the acceptance carries the customer’s name',
  payload && payload.name === 'Test Quote — do not send', JSON.stringify(payload && payload.name));
say('the acceptance carries the terms acknowledgement',
  !!(payload && payload.acknowledgedTerms));
say('the acceptance carries the signature', !!(payload && payload.signature));

// ── DECLINE AND ENQUIRE ARE REAL CONTROLS ───────────────────────────────────
say('the customer can ask a question',
  (await page.locator('text=Ask a question').count()) > 0);
say('the customer can decline',
  (await page.locator('#declineBtn').count()) > 0);

const real = errs.filter(e => !/favicon/.test(e));
say('no javascript errors on the page', real.length === 0, real.join(' | '));

await browser.close();
console.log(fail ? '\n  ' + fail + ' failed' : '\n  all passed');
process.exit(fail ? 1 : 0);

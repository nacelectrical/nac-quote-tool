// ─────────────────────────────────────────────────────────────────────────────
// FLOOR PLAN AND ROOMS, IN A REAL BROWSER
//
// Nick, 5 November 2026, with two screenshots of this step on an iPhone:
// "Won't size plan."
//
// Every label, button, radio option and <option> on this step was BLANK. The
// cause was silent: plan-step.mjs passes { text: 'Add a room' } to h(), which
// is quote-builder.html's el() convention, and h() had no `text` key — so it
// fell through to setAttribute and the label became an HTML ATTRIBUTE:
//
//     <button class="btn" type="button" text="Add a room"></button>
//
// Valid HTML. No exception, no console error, nothing in any test. And the
// yellow button in Nick's screenshot, the one with no writing on it, was
// "Read the rooms off this plan" — the only way to size a plan on this screen.
//
// This step had NO browser coverage at all, which is how 37 blank labels
// shipped. It has some now.
//
//   node tools/serve.mjs &   node tools/browser-tests/plan-step.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const B = 'http://127.0.0.1:8777';
let fail = 0;
const step = async (name, fn) => {
  try { await fn(); console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + '  — ' + e.message); fail++; }
};

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
// A phone, because that is what Nick had in his hand.
const ctx = await browser.newContext({ viewport: { width: 430, height: 930 },
                                       deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  localStorage.setItem('nac_session_v1', JSON.stringify({
    access_token: 'test-token', refresh_token: 'r',
    user: { email: 'nick@nacelectrical.com.au' },
    expires_at: Math.floor(Date.now() / 1000) + 86400 }));
  window.__readCalls = 0;
  // ── THE SHAPE /api/plan-read ACTUALLY SENDS ──────────────────────────────
  //
  // This stub used to read { label, widthMm, lengthMm } — the shape the SCREEN
  // expected. That is why this suite passed while the live app could not size
  // a plan: both ends were tested against each other's imagination, and the
  // stub was agreeing with the bug.
  //
  // It is now the endpoint's own documented contract: the room's name in
  // `text`, and the size printed on the drawing copied out verbatim in
  // `dimensionText`, because that endpoint is forbidden from doing arithmetic.
  window.__readReply = { ok: true, body: { observations: { roomLabels: [
    { id: 'r1', text: 'Bed 4', dimensionText: '3.63 X 3.0m',
      box: { x: 10, y: 10, w: 80, h: 20 } },
    { id: 'r2', text: 'Garage', dimensionText: '7.61 X 5.71m',
      box: { x: 10, y: 60, w: 80, h: 20 } },
    // Named, with nothing printed against it. Stays a room with no dimension.
    { id: 'r3', text: 'Study', box: { x: 10, y: 110, w: 80, h: 20 } }
  ] }, notes: [] } };
  const real = window.fetch;
  window.fetch = async (u, o = {}) => {
    const s = String(u);
    const J = (x, st = 200) => new Response(JSON.stringify(x),
      { status: st, headers: { 'Content-Type': 'application/json' } });
    if (s.includes('/api/plan-read')) {
      window.__readCalls++;
      try { window.__readBody = JSON.parse(o.body); } catch (e) { window.__readBody = null; }
      const r = window.__readReply;
      return J(r.body, r.ok ? 200 : (r.status || 500));
    }
    if (s.includes('/api/presentation-content')) {
      return J({ content: { upgrades: [], reviews: [], installations: [], images: [] } });
    }
    if (s.includes('/rest/v1/')) return J([]);
    if (s.includes('/auth/v1/')) return J({});
    return real(u, o);
  };
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(B + '/quote-builder.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
await page.locator('.steps button').nth(1).click();
await page.waitForTimeout(500);

const mountText = () => page.evaluate(() =>
  (document.getElementById('planMount').innerText || '').trim());

// ── THE BUG ITSELF ─────────────────────────────────────────────────────────
await step('NOT ONE element carries its label as an attribute', async () => {
  // The exact shape of the defect, pinned. `text` is not an attribute of any
  // element this app renders, so finding one means a helper swallowed a label.
  const stray = await page.evaluate(() =>
    [...document.querySelectorAll('[text]')].map(n =>
      n.tagName.toLowerCase() + '[text="' + n.getAttribute('text').slice(0, 40) + '"]'));
  if (stray.length) {
    throw new Error(stray.length + ' element(s) swallowed a label: ' + stray.slice(0, 4).join(', '));
  }
});

await step('the step is readable at all', async () => {
  const t = await mountText();
  // It was 58 characters: the four headings, and nothing else on the screen.
  if (t.length < 400) throw new Error('only ' + t.length + ' characters of text: ' + t);
  // Case-insensitively: the builder's stylesheet upper-cases field labels, so
  // "Upload the plan" reaches the screen as "UPLOAD THE PLAN".
  const flat = t.toLowerCase();
  for (const phrase of ['upload the plan', 'how the scale is known', 'add a room',
                        'estimating method', 'recommended capacity']) {
    if (!flat.includes(phrase)) throw new Error('missing from the screen: ' + phrase);
  }
});

await step('the three ways of knowing the scale all say what they are', async () => {
  const labels = await page.$$eval('#planMount .up', ns =>
    ns.map(n => (n.innerText || '').trim()));
  if (labels.length !== 3) throw new Error('expected 3 scale options, got ' + labels.length);
  for (const l of labels) {
    if (l.length < 20) throw new Error('an unlabelled scale option: ' + JSON.stringify(l));
  }
  const all = labels.join(' ');
  // Nick: "Never derive scale from cars, furniture or guessed objects." The
  // warning that says so has to be readable or it is not a warning.
  const warn = await mountText();
  if (!/not a scale/i.test(warn)) throw new Error('the do-not-scale-from-a-car warning is not shown');
  if (!/printed on the plan/i.test(all)) throw new Error('no printed-dimensions option');
});

await step('the estimating method dropdown has readable choices', async () => {
  const opts = await page.$$eval('#planMount select option', ns =>
    ns.map(n => (n.textContent || '').trim()));
  if (!opts.length) throw new Error('no options at all');
  for (const o of opts) if (!o) throw new Error('a blank <option> — the dropdown reads empty');
});

// ── UPLOAD, AND THE BUTTON THAT WAS BLANK ──────────────────────────────────
await step('uploading a plan offers a button that says what it does', async () => {
  await page.setInputFiles('#planFile', resolve(HERE, 'fixtures/plan.png'));
  await page.waitForTimeout(700);
  const buttons = await page.$$eval('#planMount button', ns =>
    ns.map(n => (n.textContent || '').trim()));
  // THE ONE FROM THE SCREENSHOT. Yellow, and blank.
  if (!buttons.some(b => /read the rooms/i.test(b))) {
    throw new Error('no readable "read the rooms" button: ' + JSON.stringify(buttons));
  }
  if (!buttons.some(b => /remove the plan/i.test(b))) {
    throw new Error('no readable "remove the plan" button: ' + JSON.stringify(buttons));
  }
  if (buttons.some(b => b === '')) {
    throw new Error('a button with no writing on it: ' + JSON.stringify(buttons));
  }
});

await step('reading the plan puts the rooms on the screen and sizes it', async () => {
  const before = await mountText();
  if (!/0 kW/.test(before)) throw new Error('expected 0 kW before reading: ' + before.slice(0, 120));

  await page.locator('#planMount button', { hasText: /read the rooms/i }).click();
  await page.waitForTimeout(900);

  if (await page.evaluate(() => window.__readCalls) !== 1) {
    throw new Error('/api/plan-read was not called');
  }
  const after = await mountText();
  for (const room of ['Bed 4', 'Garage', 'Study']) {
    if (!after.includes(room)) throw new Error(room + ' is not listed: ' + after.slice(0, 200));
  }
  // 3.63 x 3.0 = 10.89, 7.61 x 5.71 = 43.45. Sized, not zero.
  if (/Recommended capacity\s*0 kW/.test(after)) {
    throw new Error('the rooms were read and it still sizes at nothing');
  }
  if (!/kW/.test(after)) throw new Error('no capacity at all');
});

await step('the reader is told how big the image is', async () => {
  // /api/plan-read asks for boxes in the pixel coordinates of the image it was
  // given, and checks each one lands inside those bounds. It was never told
  // the bounds — so it could not check a single box, and a room whose box came
  // back missing or wild was dropped server-side. A dropped room label is a
  // room that silently never existed.
  const sent = await page.evaluate(() => window.__readBody || null);
  if (!sent) throw new Error('nothing recorded');
  if (!(sent.imageWidthPx > 0) || !(sent.imageHeightPx > 0)) {
    throw new Error('the image size was not sent: ' + JSON.stringify(sent));
  }
});

await step('a room with no dimension stays a room with no dimension', async () => {
  // Nick's rule, and the one that matters most: "Study" was read with no size
  // against it. It is listed, it says what it is missing, and it contributes
  // nothing. An invented number is worse than a blank.
  const study = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#planMount .rows > *')];
    const hit = rows.find(r => /study/i.test(r.innerText || ''));
    return hit ? (hit.innerText || '').trim() : null;
  });
  if (!study) throw new Error('Study was dropped rather than listed');
  if (/\b10\.89\b|\b43\.45\b/.test(study)) throw new Error('Study was given another room’s size');
});

await step('a read that fails says so, and invents nothing', async () => {
  const roomsBefore = await page.evaluate(() =>
    document.querySelectorAll('#planMount .rows > *').length);
  await page.evaluate(() => { window.__readReply = { ok: false, status: 503,
    body: { error: 'upstream', message: 'The reader is unavailable.' } }; });
  await page.locator('#planMount button', { hasText: /read the rooms/i }).click();
  await page.waitForTimeout(900);
  const flash = await page.evaluate(() =>
    (document.querySelector('#flash')?.innerText || '').trim());
  if (!/could not be read/i.test(flash)) {
    throw new Error('a failed read said nothing useful: ' + JSON.stringify(flash));
  }
  if (!/by hand/i.test(flash)) {
    throw new Error('it did not say the rooms can still be entered by hand');
  }
  const roomsAfter = await page.evaluate(() =>
    document.querySelectorAll('#planMount .rows > *').length);
  if (roomsAfter !== roomsBefore) throw new Error('a failed read changed the room list');
});

await step('the rooms can always be typed instead', async () => {
  // Nothing on this step may be reachable only through the reader.
  const before = await page.evaluate(() =>
    document.querySelectorAll('#planMount .rows > *').length);
  await page.locator('#planMount button', { hasText: /add a room/i }).click();
  await page.waitForTimeout(500);
  const after = await page.evaluate(() =>
    document.querySelectorAll('#planMount .rows > *').length);
  if (after !== before + 1) throw new Error('Add a room did nothing: ' + before + ' -> ' + after);
});

await step('no javascript errors through any of it', async () => {
  if (errs.length) throw new Error(errs.slice(0, 3).join(' | '));
});

if (process.env.NAC_SHOT) await page.screenshot({ path: process.env.NAC_SHOT, fullPage: true });
await ctx.close();
await browser.close();
console.log(fail ? '\n' + fail + ' FAILED' : '\nALL PASSED');
process.exit(fail ? 1 : 0);

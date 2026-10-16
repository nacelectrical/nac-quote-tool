// QUOTING A JOB WITH NO DUCT DESIGN BEHIND IT, IN A REAL BROWSER.
//
// Nick, 16 October 2026: "Pause all duct-designer development and focus on
// completing NAC's quote tool... Create a clear 'Quote only' workflow."
//
// This drives /quote-builder.html the way an estimator does: fills it in,
// watches the checks panel refuse what should be refused, ticks the upgrades,
// previews the real customer page, and saves. The database is stubbed by
// intercepting fetch, so the whole path — screen to draft to storage to the
// customer page — runs without touching the live project.
//
// The two that matter most:
//   · an upgrade that only fits a Daikin is WITHHELD the moment the quote is
//     switched to the Braemar, rather than being priced onto a system it
//     cannot go on;
//   · a save that never reached the database is reported as NOT SAVED. Nick:
//     "Report success only after the database confirms it was saved."
//
//   node tools/serve.mjs &   node tools/browser-tests/quote-builder.mjs

import { chromium } from 'playwright';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let fail = 0;
const B = 'http://127.0.0.1:8777';

const UPGRADES = [
  { id: 'at5', title: 'AirTouch 5 smart control', priceIncGst: 1350,
    description: 'Colour touchscreen, phone app control, each zone to its own temperature.',
    requires: ['has_zoning', 'daikin_system'], enabled: true, sortOrder: 1 },
  { id: 'sensor', title: 'Room temperature sensors', unitPriceIncGst: 110, unitLabel: 'each',
    maxQuantity: 8, defaultQuantity: 0, requires: ['has_zoning', 'daikin_system'],
    description: 'A sensor in the rooms you choose.', enabled: true, sortOrder: 2 }
];

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
// The estimator quotes from a laptop at the desk and an iPad in the roof
// space, so the same run drives both.
const device = process.argv[2] === 'mobile' ? { width: 390, height: 844 }
  : process.argv[2] === 'ipad' ? { width: 820, height: 1180 }
  : { width: 1440, height: 1000 };
const ctx = await browser.newContext({ viewport: device, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

// A signed-in staff session, and a stubbed backend: the content library comes
// back with NAC's upgrades, and every nac_settings / nac_designs call is
// answered so the page can be driven without touching production.
await page.addInitScript(({ ups }) => {
  localStorage.setItem('nac_session_v1', JSON.stringify({
    access_token: 'test-token', user: { email: 'nick@nacelectrical.com.au' },
    expires_at: Math.floor(Date.now() / 1000) + 86400 }));
  window.__saved = [];
  const real = window.fetch;
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    const J = (o, s = 200) => new Response(JSON.stringify(o),
      { status: s, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/api/presentation-content')) {
      return J({ content: { upgrades: ups, reviews: [], installations: [], images: [],
                            standardInclusions: { commissioning: true, wasteRemoval: true } } });
    }
    if (u.includes('/rest/v1/nac_designs')) {
      if ((opts.method || 'GET') === 'POST') {
        window.__saved.push(JSON.parse(opts.body));
        return new Response('', { status: 201 });
      }
      return J([]);
    }
    if (u.includes('/rest/v1/nac_settings')) {
      return J([{ value: JSON.stringify({ commercial: { terms: {
        depositPercent: 50, balanceDueEvent: 'completion', validityDays: 30,
        paymentMethods: ['Direct deposit'], termsVersion: 'NAC T&C v1.0 (23 September 2026)',
        confirmed: true, confirmedBy: 'nick@nacelectrical.com.au',
        confirmedAt: '2026-09-23T00:00:00Z' } } }) }]);
    }
    if (u.includes('/api/quote-issue')) {
      window.__issued = JSON.parse(opts.body);
      return J({ ok: true, quoteRevision: 1, url: 'https://nac-quote-tool.vercel.app/quote.html?t=TESTTOKEN' });
    }
    return real(url, opts);
  };
}, { ups: UPGRADES });

await page.goto(B + '/quote-builder.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

const say = (n, c, x) => {
  console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  if (!c) fail++;
};
const step = async (name, fn) => {
  try { await fn(); console.log('  PASS  ' + name); }
  catch (e) { console.log('  FAIL  ' + name + '  — ' + e.message); fail++; }
};
const checks = () => page.$$eval('#checks .chk',
  ns => ns.map(n => n.className.replace('chk ', '') + ': ' + n.textContent.trim()));

// ── an empty quote refuses itself, and says why ────────────────────────────
await step('an empty quote is blocked', async () => {
  const c = await checks();
  const bad = c.filter(x => x.startsWith('bad'));
  if (!bad.length) throw new Error('an empty quote raised no blockers');
  if (!bad.some(x => /no brand or model|no price|has no name/i.test(x)))
    throw new Error(c.join(' | '));
  if (!await page.$eval('#issue', b => b.disabled)) throw new Error('Issue was enabled');
});

// ── fill it in ─────────────────────────────────────────────────────────────
const fill = async (sel, v) => { await page.fill(sel, String(v)); };
await fill('#cname', 'Test Quote — do not send');
await fill('#cemail', 'quotes@nacelectrical.com.au');
await fill('#cphone', '0455 123 456');
await fill('#caddr', '12 Boronia Street, Buderim QLD 4556');
await fill('#pnum', 'NAC-TEST-0001');
await page.check('#istest');
await fill('#ctrl', 'AirTouch 5');
await fill('#ctrlz', '8');
await fill('#outlets', '10');
await fill('#returns', '2');
await fill('#zones', '6');
await fill('#summary', 'Ducted reverse-cycle throughout the single storey, six zones.');

const sysFields = async (i, vals) => {
  const row = page.locator('#systems .row').nth(i);
  const inputs = row.locator('.f input');
  for (const [k, v] of Object.entries(vals)) await inputs.nth(Number(k)).fill(String(v));
};
// brand, indoor, outdoor, kW, phase, price, warranty, note
await sysFields(0, { 0: 'Daikin', 1: 'FDYAN160AV1', 2: 'RZA160C2V1', 3: '16', 4: '1Ph',
                     5: '16027' });

await step('a price of zero is refused', async () => {
  await page.locator('#systems .row').nth(0).locator('.f input').nth(5).fill('0');
  await page.waitForTimeout(150);
  const c = await checks();
  if (!c.some(x => /priced at \$0|cannot go out at nothing/i.test(x))) {
    throw new Error('zero price passed: ' + c.join(' | '));
  }
  await page.locator('#systems .row').nth(0).locator('.f input').nth(5).fill('16027');
});

// rooms
const roomRows = () => page.locator('#rooms .roomrow');
const ROOMS = [['Living / Dining', 'Living', 3], ['Kitchen', 'Living', 1], ['Master', 'Master', 2],
               ['Bedroom 2', 'Bed 2', 1], ['Bedroom 3', 'Bed 3', 1], ['Bedroom 4', 'Bed 4', 1],
               ['Study', 'Study', 1]];
for (let i = 0; i < ROOMS.length; i++) {
  if (await roomRows().count() <= i) await page.click('#addRoom');
  const r = roomRows().nth(i);
  await r.locator('input').nth(0).fill(ROOMS[i][0]);
  await r.locator('input').nth(1).fill(ROOMS[i][1]);
  await r.locator('input').nth(2).fill(String(ROOMS[i][2]));
}
await page.click('#seedIncl');
await page.click('#seedExcl');
await page.waitForTimeout(200);

await step('the typed inclusions and exclusions land in the draft', async () => {
  const inc = await page.inputValue('#incl');
  const exc = await page.inputValue('#excl');
  if (!/Removal of all installation waste/.test(inc)) throw new Error('no inclusions');
  if (!/Asbestos/.test(exc)) throw new Error('no exclusions');
});

// ── upgrades ───────────────────────────────────────────────────────────────
await step('a Daikin-only upgrade is offerable on a Daikin quote', async () => {
  const at5 = page.locator('#ups .up').nth(0);
  if (await at5.locator('input[type=checkbox]').isDisabled()) {
    throw new Error('the AirTouch was withheld from a Daikin quote');
  }
  await at5.locator('input[type=checkbox]').check();
  await page.waitForTimeout(150);
});

await step('a counted upgrade asks how many, and prices it', async () => {
  const sensor = page.locator('#ups .up').nth(1);
  await sensor.locator('input[type=checkbox]').check();
  await page.waitForTimeout(150);
  const q = sensor.locator('.uq input');
  if (!await q.count()) throw new Error('no quantity control appeared');
  await q.fill('4');
  await page.waitForTimeout(200);
  const total = await page.textContent('#total strong');
  if (!/17,817/.test(total)) throw new Error('total reads ' + total + ', expected $17,817.00');
});

await step('removing an option removes its price', async () => {
  await page.locator('#ups .up').nth(0).locator('input[type=checkbox]').uncheck();
  await page.waitForTimeout(200);
  const total = await page.textContent('#total strong');
  if (!/16,467/.test(total)) throw new Error('total reads ' + total + ', expected $16,467.00');
  await page.locator('#ups .up').nth(0).locator('input[type=checkbox]').check();
  await page.waitForTimeout(200);
});

await step('the quote now passes its own checks', async () => {
  const c = await checks();
  const bad = c.filter(x => x.startsWith('bad'));
  if (bad.length) throw new Error(bad.join(' | '));
  if (await page.$eval('#issue', b => b.disabled)) throw new Error('Issue is still disabled');
});

// ── an incompatible brand withholds the upgrade ────────────────────────────
await step('adding a Braemar and quoting it withholds the Daikin-only kit', async () => {
  await page.click('#addSys');
  await page.waitForTimeout(150);
  await sysFields(1, { 0: 'Braemar', 1: 'KDHV160D1S', 3: '16.3', 4: '1Ph', 5: '14553' });
  await page.locator('#systems .row').nth(1).locator('button', { hasText: 'Quote this one' }).click();
  await page.waitForTimeout(250);
  const at5 = page.locator('#ups .up').nth(0);
  if (!await at5.locator('input[type=checkbox]').isDisabled()) {
    throw new Error('the AirTouch is still offerable on a Braemar');
  }
  const c = await checks();
  if (!c.some(x => /only fits daikin/i.test(x))) {
    throw new Error('no blocker about the incompatible upgrade: ' + c.join(' | '));
  }
});

await step('switching back to the Daikin clears the incompatibility', async () => {
  await page.locator('#systems .row').nth(0).locator('button', { hasText: 'Quote this one' }).click();
  await page.waitForTimeout(250);
  const bad = (await checks()).filter(x => x.startsWith('bad'));
  if (bad.length) throw new Error(bad.join(' | '));
});

// ── the preview is the real page ───────────────────────────────────────────
await step('the preview renders the real customer page', async () => {
  await page.click('#preview');
  await page.waitForTimeout(900);
  const frame = page.frameLocator('#prevFrame');
  const cover = await frame.locator('.cover').count();
  if (!cover) throw new Error('no cover in the preview');
  const body = await frame.locator('body').innerText();
  for (const want of ['12 Boronia Street, Buderim QLD 4556', 'Not included',
                      'Asbestos handling of any kind', '$17,817', 'TEST QUOTE']) {
    if (!body.includes(want)) throw new Error('the preview is missing: ' + want);
  }
  if (process.argv[3]) await page.screenshot({ path: process.argv[3], fullPage: false });
  await page.click('#prevClose');
});

// ── saving ─────────────────────────────────────────────────────────────────
await step('a save that reaches the database reports as saved', async () => {
  await page.click('#save');
  await page.waitForTimeout(500);
  const f = await page.textContent('#flash');
  if (!/Saved\./.test(f)) throw new Error('save said: ' + f);
  const saved = await page.evaluate(() => window.__saved);
  if (!saved.length) throw new Error('nothing was written');
  const row = JSON.parse(saved[saved.length - 1].design);
  if (row.schema !== 'nac.quote.draft.v1') throw new Error('wrong schema: ' + row.schema);
  if (row.testQuote !== true) throw new Error('the test-quote flag was not saved');
  if (row.systems[0].priceIncGst !== 16027) throw new Error('the price was not saved');
  if (row.upgradeQuantities.sensor !== 4) throw new Error('the sensor count was not saved');
  if (row.exclusions.length !== 4) throw new Error('the exclusions were not saved');
});

await step('a save that never reached the database is NOT reported as saved', async () => {
  await page.evaluate(() => {
    const prev = window.fetch;
    window.fetch = async (url, opts = {}) => {
      if (String(url).includes('nac_designs') && (opts.method || 'GET') === 'POST') {
        return new Response('', { status: 503 });
      }
      if (String(url).includes('nac_settings') && (opts.method || 'GET') !== 'GET') {
        return new Response('', { status: 503 });
      }
      return prev(url, opts);
    };
  });
  await page.fill('#summary', 'Edited after the connection dropped.');
  await page.click('#save');
  await page.waitForTimeout(600);
  const f = await page.textContent('#flash');
  if (!/NOT saved/i.test(f)) throw new Error('a failed save reported: ' + f);
});

// A favicon request against the static server is not a page fault.
const real = errs.filter(e => !/favicon\.ico/.test(e)
  && !/Failed to load resource: the server responded with a status of 404/.test(e));
say('no javascript errors on the page', real.length === 0, real.join(' | '));

await browser.close();
console.log(fail ? '\n  ' + fail + ' failed' : '\n  all passed');
process.exit(fail ? 1 : 0);


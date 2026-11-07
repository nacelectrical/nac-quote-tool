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

// ── THE PICTURE LIBRARY, AS THE CONTENT API SERVES IT ──────────────────────
//
// Two assets, and the pair is the point: a Zonemaster wall panel and an
// AirTouch console. The quote's zone control is a SIEMENS kit, and neither of
// these is a Siemens part — so the right answer on this screen is that neither
// is matched to it, and the estimator picks one or leaves it blank.
//
// A one-pixel PNG. These checks are about which id is chosen and recorded,
// not about what the photograph looks like.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
  + 'AAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const LIBRARY_IMAGES = [
  { id: 'zonemaster-6-zone-wall-panel', role: 'equipment', approved: true,
    exifStripped: true, gpsRemoved: true, equipmentBrand: 'Zonemaster',
    alt: 'A Zonemaster six-zone wall panel, with a labelled switch for each zone',
    derivatives: [{ ref: PIXEL, width: 600, height: 600, format: 'png' }] },
  { id: 'airtouch-console-4-zone', role: 'equipment', approved: true,
    exifStripped: true, gpsRemoved: true, equipmentBrand: 'AirTouch',
    alt: 'An AirTouch console on the wall of a hallway',
    tags: ['airtouch', 'controller'],
    derivatives: [{ ref: PIXEL, width: 600, height: 600, format: 'png' }] }
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
await page.addInitScript(({ ups, imgs }) => {
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
      return J({ content: { upgrades: ups, reviews: [], installations: [], images: imgs,
                            standardInclusions: { commissioning: true, wasteRemoval: true } } });
    }
    if (u.includes('/rest/v1/nac_designs')) {
      if ((opts.method || 'GET') === 'POST') {
        const r = JSON.parse(opts.body);
        window.__saved.push(r);
        // The row stays in sessionStorage so a RELOAD reads back what was
        // written, which is what reopening a saved quote actually does.
        try { sessionStorage.setItem('row:' + r.id, r.design); } catch (e) { /* ignore */ }
        return new Response('', { status: 201 });
      }
      const m = /id=eq\.([^&]+)/.exec(u);
      if (m) {
        const design = sessionStorage.getItem('row:' + decodeURIComponent(m[1]));
        return J(design ? [{ id: decodeURIComponent(m[1]), design }] : []);
      }
      return J([]);
    }
    // ── NAC'S CUSTOMER AND JOB RECORDS ─────────────────────────────────
    // The builder links a quote to them on save, the way /api/ops does, so
    // the same house has one identity whichever path opened the quote.
    if (u.includes('/rest/v1/nac_customers') || u.includes('/rest/v1/nac_jobs')) {
      const table = u.includes('nac_customers') ? 'customers' : 'jobs';
      window.__crm = window.__crm || { customers: [], jobs: [] };
      if ((opts.method || 'GET') === 'POST') {
        const row = JSON.parse(opts.body);
        window.__crm[table] = [...window.__crm[table].filter(x => x.id !== row.id), row];
        return new Response('', { status: 201 });
      }
      return J(window.__crm[table]);
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
}, { ups: UPGRADES, imgs: LIBRARY_IMAGES });

await page.goto(B + '/quote-builder.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

const say = (n, c, x) => {
  console.log('  ' + (c ? 'PASS' : 'FAIL') + '  ' + n + (x ? '  — ' + x : ''));
  if (!c) fail++;
};
/**
 * The workflow is stepped now, so the test walks it the way an estimator
 * does — but it works out WHICH step a control is on rather than being told.
 *
 * Hard-coding "field X is on step 4" means every test breaks the next time a
 * card moves, and the breakage looks like a product failure. `show()` asks
 * the page which step contains the element and switches to it.
 */
async function show(sel) {
  const n = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const body = el.closest('.stepbody');
    return body ? Number(body.dataset.step) : null;
  }, sel);
  if (n === null) return;
  const current = await page.evaluate(() =>
    Number((document.querySelector('.steps button.on')?.textContent || '1').trim()[0]));
  if (current === n) return;
  await page.locator('.steps button').nth(n - 1).click();
  await page.waitForTimeout(160);
}
const goStep = async (n) => {
  await page.locator('.steps button').nth(n - 1).click();
  await page.waitForTimeout(200);
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
const fill = async (sel, v) => { await show(sel); await page.fill(sel, String(v)); };

await goStep(1);
await fill('#cname', 'Test Quote — do not send');
await fill('#cemail', 'quotes@nacelectrical.com.au');
await fill('#cphone', '0455 123 456');
await fill('#caddr', '12 Boronia Street, Buderim QLD 4556');
await fill('#pnum', 'NAC-TEST-0001');
await show('#istest'); await page.check('#istest');

await goStep(4);
await fill('#outlets', '10');
await fill('#returns', '2');
await fill('#zones', '6');
await fill('#summary', 'Ducted reverse-cycle throughout the single storey, six zones.');

const sysFields = async (i, vals) => {
  await goStep(3);
  await show('#systems'); const row = page.locator('#systems .row').nth(i);
  const inputs = row.locator('.f input');
  for (const [k, v] of Object.entries(vals)) await inputs.nth(Number(k)).fill(String(v));
};
// brand, indoor, outdoor, kW, phase, price, warranty, note
await sysFields(0, { 0: 'Daikin', 1: 'FDYAN160AV1', 2: 'RZA160C2V1', 3: '16', 4: '1Ph',
                     5: '16027' });

await step('a price of zero is refused', async () => {
  await show('#systems'), await page.locator('#systems .row').nth(0).locator('.f input').nth(5).fill('0');
  await page.waitForTimeout(150);
  const c = await checks();
  if (!c.some(x => /priced at \$0|cannot go out at nothing/i.test(x))) {
    throw new Error('zero price passed: ' + c.join(' | '));
  }
  await show('#systems'), await page.locator('#systems .row').nth(0).locator('.f input').nth(5).fill('16027');
});

// rooms
//
// The ZONES are left off for now, and deliberately: the zone-control checks
// below drive the zone COUNT, which stops being typeable the moment a zone
// list exists. The rooms are put into their zones further down, in the section
// that drives the zone editor itself.
await goStep(4);
const roomRows = () => page.locator('#rooms .roomrow');
const ROOMS = [['Living / Dining', 'Living', 3], ['Kitchen', 'Living', 1], ['Master', 'Master', 2],
               ['Bedroom 2', 'Bed 2', 1], ['Bedroom 3', 'Bed 3', 1], ['Bedroom 4', 'Bed 4', 1],
               ['Study', 'Study', 1]];
for (let i = 0; i < ROOMS.length; i++) {
  await show('#addRoom'); if (await roomRows().count() <= i) await page.click('#addRoom');
  const r = roomRows().nth(i);
  // The zone is a <select> now, so the text boxes on a room row are its name
  // and its outlet count.
  await r.locator('input').nth(0).fill(ROOMS[i][0]);
  await r.locator('input').nth(1).fill(String(ROOMS[i][2]));
}
await show('#seedIncl'); await page.click('#seedIncl');
await page.click('#seedExcl');
await page.waitForTimeout(200);

await step('the typed inclusions and exclusions land in the draft', async () => {
  const inc = await page.inputValue('#incl');
  const exc = await page.inputValue('#excl');
  // NAC's own wording, off NAC's own quotation (NAC-2611-LEW), which is what
  // "Insert NAC's usual list" now seeds.
  if (!/ARCtick licensed refrigerant handling/.test(inc)) {
    throw new Error('no inclusions: ' + inc.slice(0, 120));
  }
  if (!/Asbestos/.test(exc)) throw new Error('no exclusions');
});

// ── ZONE CONTROL ───────────────────────────────────────────────────────────
//
// Nick: "Need to include Siemens zone option for zoning, and amount of zones
// to be chosen." The kits have been on file all along with NAC's own MMEM
// costs, together with the house rule: Siemens unless the job is on an
// AirTouch, sized to the job.
await step('the zone control follows the zone count, per NAC\u2019s house rule', async () => {
  await goStep(3);
  const chosen = (await show('#ctrlSel'), await page.inputValue('#ctrlSel'));
  if (chosen !== 'siemens_z6') {
    throw new Error('6 zones offered ' + chosen + ', expected the Siemens 6-zone kit');
  }
  const note = (await show('#ctrlBox'), await page.textContent('#ctrlBox'));
  if (!/Siemens/i.test(note)) throw new Error('the house rule was not explained');
});

await step('a kit outgrown by the job is resized, and the change is announced', async () => {
  await goStep(4); await fill('#zones', '8'); await goStep(3);
  await page.waitForTimeout(250);
  const eight = (await show('#ctrlSel'), await page.inputValue('#ctrlSel'));
  if (eight !== 'siemens_z8') throw new Error('8 zones offered ' + eight);
  await fill('#zones', '4');
  await page.waitForTimeout(250);
  const four = (await show('#ctrlSel'), await page.inputValue('#ctrlSel'));
  if (four !== 'siemens_z4') throw new Error('4 zones offered ' + four);
  // Five zones take the next kit up, not the one that is two short.
  await fill('#zones', '5');
  await page.waitForTimeout(250);
  const five = (await show('#ctrlSel'), await page.inputValue('#ctrlSel'));
  if (five !== 'siemens_z6') throw new Error('5 zones offered ' + five);
  await fill('#zones', '6');
  await page.waitForTimeout(250);
});

await step('a kit the estimator picked is not resized under them', async () => {
  // Deliberately take the 8-zone kit on a 6-zone job. That is allowed — it is
  // their call — and the app must not quietly put it back to the 6.
  await show('#ctrlSel'); await page.selectOption('#ctrlSel', 'siemens_z8');
  await page.waitForTimeout(250);
  await fill('#zones', '4');
  await page.waitForTimeout(250);
  const kept = (await show('#ctrlSel'), await page.inputValue('#ctrlSel'));
  if (kept !== 'siemens_z8') throw new Error('a deliberate choice was overridden: ' + kept);
  // But one that no longer COVERS the job is resized, because an impossible
  // part is not a choice worth respecting.
  await fill('#zones', '6');
  await page.waitForTimeout(250);
  await show('#ctrlSel'); await page.selectOption('#ctrlSel', 'siemens_z6');
  await page.waitForTimeout(250);
  await fill('#zones', '8');
  await page.waitForTimeout(300);
  const grown = (await show('#ctrlSel'), await page.inputValue('#ctrlSel'));
  if (grown !== 'siemens_z8') throw new Error('an outgrown kit was kept: ' + grown);
  const said = (await show('#ctrlBox'), await page.textContent('#ctrlBox'));
  if (!/resized/i.test(said)) throw new Error('the resize was silent');
  await fill('#zones', '6');
  await page.waitForTimeout(250);
  await show('#ctrlSel'); await page.selectOption('#ctrlSel', 'siemens_z6');
  await page.waitForTimeout(250);
});

await step('a kit too small for the job is offered but cannot be picked', async () => {
  await show('#ctrlSel');
  const opts = await page.$$eval('#ctrlSel option',
    ns => ns.map(n => ({ v: n.value, d: n.disabled, t: n.textContent })));
  const small = opts.find(o => o.v === 'siemens_z4');
  if (!small) throw new Error('the 4-zone kit is not listed at all on a 6-zone job');
  if (!small.d) throw new Error('a 4-zone kit was selectable on a 6-zone job');
  if (!/too small/i.test(small.t)) throw new Error('it does not say why: ' + small.t);
});

await step('the AirTouch kit is on the list for a Daikin', async () => {
  await show('#ctrlSel');
  const opts = await page.$$eval('#ctrlSel option', ns => ns.map(n => n.value));
  if (!opts.includes('at5_daikin')) throw new Error('no AirTouch kit: ' + opts.join(','));
});

await step('a controller can still be typed by hand', async () => {
  await show('#ctrlSel'); await page.selectOption('#ctrlSel', '__other');
  await page.waitForTimeout(250);
  const n = await page.locator('#ctrlBox input[placeholder*="Name the part"]').count();
  if (!n) throw new Error('no free-text fallback appeared');
  // Put the Siemens kit back for the rest of the run.
  await show('#ctrlSel'); await page.selectOption('#ctrlSel', 'siemens_z6');
  await page.waitForTimeout(250);
});

// ── THE PICTURE OF THE ZONE CONTROL ────────────────────────────────────────
//
// Nick, 5 November 2026, sending a photograph of a Zonemaster six-zone wall
// panel, then "Just put it in the pic for siemens." The plate is recorded
// against the Siemens kits in the catalogue, so the estimator gets it without
// doing anything — and can still override it or turn it off per quote.
await step('the Siemens kit brings its own plate with it', async () => {
  const box = (await show('#ctrlBox'), await page.textContent('#ctrlBox'));
  if (!/Picture of the zone control/.test(box)) {
    throw new Error('the picture chooser is not on the controller card');
  }
  // Blank means "the kit's own picture", and the option says which.
  if (await page.locator('#ctrlPic').inputValue() !== '') {
    throw new Error('the kit default is not the selected state');
  }
  if (!/the kit.s own picture/i.test(box)) {
    throw new Error('the card does not say the kit has its own picture: ' + box.slice(0, 200));
  }
  if (await page.locator('#ctrlBox img').count() !== 1) {
    throw new Error('the kit\u2019s own photograph is not shown back');
  }
  const alt = await page.locator('#ctrlBox img').getAttribute('alt');
  if (!/Zonemaster/.test(String(alt))) throw new Error('wrong picture shown: ' + alt);
});

await step('the estimator can turn the picture off for one quote', async () => {
  await show('#ctrlPic');
  await page.selectOption('#ctrlPic', 'none');
  await page.waitForTimeout(250);
  if (await page.locator('#ctrlBox img').count()) {
    throw new Error('the picture is still shown after being turned off');
  }
});

await step('and override it with another', async () => {
  await show('#ctrlPic');
  await page.selectOption('#ctrlPic', 'airtouch-console-4-zone');
  await page.waitForTimeout(250);
  const alt = await page.locator('#ctrlBox img').getAttribute('alt');
  if (!/AirTouch/.test(String(alt))) throw new Error('the override did not take: ' + alt);
  // Left in, so the save and the reopen below carry it and the round trip is
  // proved rather than assumed.
});

await step('the kit\u2019s cost is shown to the estimator', async () => {
  // $295.00 is the Siemens 6-zone kit's MMEM cost. It belongs on this screen.
  const internal = (await show('#ctrlBox'), await page.textContent('#ctrlBox'));
  if (!/295/.test(internal)) throw new Error('the cost is not shown: ' + internal.slice(0, 120));
});

// ── CHOOSING THE ZONES ─────────────────────────────────────────────────────
//
// Nick, 5 November 2026: "Want to be able to choose the zones."
//
// Until now a zone was not a thing on this screen. There was a number in the
// scope and a free-text box on every room, so the same name had to be typed
// once per room, "Living" and "living" were two zones, and a typo was a
// seventh zone on a six-zone house that then blocked the quote.
await goStep(4);
const zoneRows = () => page.locator('#zonelist .zonerow');
const ZONES = ['Living', 'Master', 'Bed 2', 'Bed 3', 'Bed 4', 'Study'];

await step('zones are made, named and counted', async () => {
  await show('#addZone');
  for (let i = 0; i < ZONES.length; i++) {
    if (await zoneRows().count() <= i) await page.click('#addZone');
    const box = zoneRows().nth(i).locator('input');
    await box.fill(ZONES[i]);
    await box.blur();
    await page.waitForTimeout(120);
  }
  if (await zoneRows().count() !== ZONES.length) {
    throw new Error('expected ' + ZONES.length + ' zones, got ' + await zoneRows().count());
  }
  // The count FOLLOWS the list and stops being typeable, because a field that
  // can contradict the thing beside it eventually will.
  if (await page.inputValue('#zones') !== '6') {
    throw new Error('the zone count did not follow the list: '
      + await page.inputValue('#zones'));
  }
  if (!await page.locator('#zones').evaluate(e => e.readOnly)) {
    throw new Error('the zone count is still typeable alongside a zone list');
  }
});

await step('each room is put in a zone by picking one', async () => {
  for (let i = 0; i < ROOMS.length; i++) {
    await show('#rooms');
    await roomRows().nth(i).locator('select').selectOption(ROOMS[i][1]);
    await page.waitForTimeout(80);
  }
  // The zone row says which rooms are in it, so "Living" being two rooms is
  // visible without counting down the list.
  const living = await zoneRows().nth(0).textContent();
  if (!/Living \/ Dining/.test(living) || !/Kitchen/.test(living)) {
    throw new Error('the Living zone does not list its rooms: ' + living);
  }
});

await step('renaming a zone takes its rooms with it', async () => {
  const box = zoneRows().nth(0).locator('input');
  await box.fill('Living & Kitchen');
  await box.blur();
  await page.waitForTimeout(200);
  // Every room that was in it now points at the new name. Leaving them behind
  // is how an empty zone and an unzoned room appear at the same moment.
  for (const i of [0, 1]) {
    const v = await roomRows().nth(i).locator('select').inputValue();
    if (v !== 'Living & Kitchen') {
      throw new Error('room ' + i + ' was left behind on rename: ' + v);
    }
  }
  if (await page.inputValue('#zones') !== '6') throw new Error('the count moved on a rename');
  // Back, for the rest of the run.
  await box.fill('Living'); await box.blur(); await page.waitForTimeout(200);
});

await step('removing a zone frees its rooms rather than deleting them', async () => {
  const before = await roomRows().count();
  await show('#zonelist');
  await zoneRows().nth(5).locator('button').click();   // Study
  await page.waitForTimeout(250);
  if (await roomRows().count() !== before) throw new Error('a room was deleted with its zone');
  if (await page.inputValue('#zones') !== '5') {
    throw new Error('the count did not follow the removal: ' + await page.inputValue('#zones'));
  }
  const study = await roomRows().nth(6).locator('select').inputValue();
  if (study !== '') throw new Error('the freed room kept a zone that no longer exists: ' + study);
  // The checks panel says so rather than letting it go out quietly.
  const c = await checks();
  if (!c.some(x => /not in any zone/i.test(x))) {
    throw new Error('an unzoned room was not reported: ' + c.join(' | '));
  }
  // Put it back and re-home the room.
  await show('#addZone'); await page.click('#addZone');
  const box = zoneRows().nth(5).locator('input');
  await box.fill('Study'); await box.blur(); await page.waitForTimeout(200);
  await show('#rooms');
  await roomRows().nth(6).locator('select').selectOption('Study');
  await page.waitForTimeout(200);
  if (await page.inputValue('#zones') !== '6') throw new Error('back to six zones failed');
});

// ── upgrades ───────────────────────────────────────────────────────────────
await step('a Daikin-only upgrade is offerable on a Daikin quote', async () => {
  await show('#ups'); const at5 = page.locator('#ups .up').nth(0);
  if (await at5.locator('input[type=checkbox]').isDisabled()) {
    throw new Error('the AirTouch was withheld from a Daikin quote');
  }
  await at5.locator('input[type=checkbox]').check();
  await page.waitForTimeout(150);
});

await step('a counted upgrade asks how many, and prices it', async () => {
  await show('#ups'); const sensor = page.locator('#ups .up').nth(1);
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
  await show('#ups'), await page.locator('#ups .up').nth(0).locator('input[type=checkbox]').uncheck();
  await page.waitForTimeout(200);
  const total = await page.textContent('#total strong');
  if (!/16,467/.test(total)) throw new Error('total reads ' + total + ', expected $16,467.00');
  await show('#ups'), await page.locator('#ups .up').nth(0).locator('input[type=checkbox]').check();
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
  await show('#addSys'); await page.click('#addSys');
  await page.waitForTimeout(150);
  await sysFields(1, { 0: 'Braemar', 1: 'KDHV160D1S', 3: '16.3', 4: '1Ph', 5: '14553' });
  await show('#systems'), await page.locator('#systems .row').nth(1).locator('button', { hasText: 'Quote this one' }).click();
  await page.waitForTimeout(250);
  await show('#ups'); const at5 = page.locator('#ups .up').nth(0);
  if (!await at5.locator('input[type=checkbox]').isDisabled()) {
    throw new Error('the AirTouch is still offerable on a Braemar');
  }
  const c = await checks();
  if (!c.some(x => /only fits daikin/i.test(x))) {
    throw new Error('no blocker about the incompatible upgrade: ' + c.join(' | '));
  }
});

await step('switching back to the Daikin clears the incompatibility', async () => {
  await show('#systems'), await page.locator('#systems .row').nth(0).locator('button', { hasText: 'Quote this one' }).click();
  await page.waitForTimeout(250);
  const bad = (await checks()).filter(x => x.startsWith('bad'));
  if (bad.length) throw new Error(bad.join(' | '));
});

// ── the preview is the real page ───────────────────────────────────────────
await step('the preview renders the real customer page', async () => {
  await show('#preview'); await page.click('#preview');
  await page.waitForTimeout(900);
  const frame = page.frameLocator('#prevFrame');
  const cover = await frame.locator('.cover').count();
  if (!cover) throw new Error('no cover in the preview');
  const body = await frame.locator('body').innerText();
  for (const want of ['12 Boronia Street, Buderim QLD 4556', 'Not included',
                      'Asbestos identification, handling or removal', '$17,817', 'TEST QUOTE']) {
    if (!body.includes(want)) throw new Error('the preview is missing: ' + want);
  }
  if (process.argv[3]) await page.screenshot({ path: process.argv[3], fullPage: false });
  await page.click('#prevClose');
});

// ── saving ─────────────────────────────────────────────────────────────────
await step('a save that reaches the database reports as saved', async () => {
  await show('#save'); await page.click('#save');
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
  // However many NAC's standard list carries — pinned by the engine's own
  // tests, not duplicated here, so changing the wording does not break this.
  if (row.exclusions.length < 8) {
    throw new Error('the exclusions were not saved: ' + row.exclusions.length);
  }
  if (!row.exclusions.some(x => /asbestos/i.test(x))) {
    throw new Error('the standard exclusions are not what was saved');
  }
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
  await show('#summary'); await page.fill('#summary', 'Edited after the connection dropped.');
  await show('#save'); await page.click('#save');
  await page.waitForTimeout(600);
  const f = await page.textContent('#flash');
  if (!/NOT saved/i.test(f)) throw new Error('a failed save reported: ' + f);
});

// A favicon request against the static server is not a page fault.
// ── REOPENING A SAVED QUOTE ────────────────────────────────────────────────
//
// Nick: "Confirm that saving and reopening preserves the quote."
//
// The page is RELOADED at ?id=, so this reads the row back out of the stubbed
// database exactly as opening the quote tomorrow would — not out of anything
// still in memory from the session that saved it.
// ── ONE HOUSE, ONE IDENTITY ────────────────────────────────────────────────
//
// Nick, 4 November 2026 (§11): "Stable customer, job, quote and revision
// identifiers that work across systems." A quote the assistant opens through
// /api/ops gets a customer record and a job record. A quote typed into this
// screen got neither, so the same house had an identity on one path and not
// the other.
await step('saving a quote finds or opens the customer and the job', async () => {
  const crm = await page.evaluate(() => window.__crm || { customers: [], jobs: [] });
  if (crm.customers.length !== 1) throw new Error('customers: ' + crm.customers.length);
  if (crm.jobs.length !== 1) throw new Error('jobs: ' + crm.jobs.length);
  if (!/^CUS-/.test(crm.customers[0].id)) throw new Error('customer id ' + crm.customers[0].id);
  if (!/^JOB-/.test(crm.jobs[0].id)) throw new Error('job id ' + crm.jobs[0].id);
  if (crm.jobs[0].customer_id !== crm.customers[0].id) {
    throw new Error('the job is not on the customer');
  }
  // And the quote row points at both.
  const row = await page.evaluate(() => window.__saved[window.__saved.length - 1]);
  if (row.customer_id !== crm.customers[0].id) throw new Error('quote not linked to customer');
  if (row.job_ref !== crm.jobs[0].id) throw new Error('quote not linked to job');
});

await step('saving the same quote again does not open a second customer', async () => {
  await show('#save'); await page.click('#save');
  await page.waitForTimeout(500);
  const crm = await page.evaluate(() => window.__crm);
  if (crm.customers.length !== 1) throw new Error('customers: ' + crm.customers.length);
  if (crm.jobs.length !== 1) throw new Error('jobs: ' + crm.jobs.length);
});

await step('reopening a saved quote brings all of it back', async () => {
  const id = await page.evaluate(() => window.__saved[window.__saved.length - 1].id);
  const before = await page.evaluate(
    () => JSON.parse(window.__saved[window.__saved.length - 1].design));

  await page.evaluate(() => { window.onbeforeunload = null; });
  await page.goto(B + '/quote-builder.html?id=' + encodeURIComponent(id),
    { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const got = {
    name: await page.inputValue('#cname'),
    addr: await page.inputValue('#caddr'),
    pnum: await page.inputValue('#pnum'),
    outlets: await page.inputValue('#outlets'),
    zones: await page.inputValue('#zones'),
    ctrl: (await show('#ctrlSel'), await page.inputValue('#ctrlSel')),
    pic: await page.inputValue('#ctrlPic'),
    zones: (await show('#zonelist'), await page.locator('#zonelist .zonerow input')
      .evaluateAll(ns => ns.map(n => n.value).join('|'))),
    incl: await page.inputValue('#incl'),
    excl: await page.inputValue('#excl'),
    test: await page.isChecked('#istest'),
    systems: await page.locator('#systems .row').count(),
    rooms: await page.locator('#rooms .roomrow').count(),
    total: (await page.textContent('#total strong')).trim()
  };
  const want = {
    name: before.customer.name, addr: before.siteAddress,
    pnum: before.proposalNumber, outlets: String(before.scope.outletCount),
    zones: String(before.scope.zoneCount), ctrl: before.controller.id,
    pic: before.controller.imageId,
    zones: (before.scope.zones || []).join('|'),
    incl: before.inclusions.join('\n'), excl: before.exclusions.join('\n'),
    test: before.testQuote === true,
    systems: before.systems.length, rooms: before.scope.conditionedRooms.length,
    total: '$17,817.00'
  };

  // A round trip that compares '' with '' proves nothing. The picture must
  // actually have been saved for the comparison below to mean anything.
  if (!want.pic) throw new Error('the chosen picture never reached the saved quote');
  if (want.zones.split('|').length !== 6) {
    throw new Error('the zone list did not reach the saved quote: ' + want.zones);
  }
  if (before.scope.zonesChosen !== true) {
    throw new Error('the quote does not record that the zones were chosen');
  }
  for (const k of Object.keys(want)) {
    if (String(got[k]) !== String(want[k])) {
      throw new Error(k + ': reopened as ' + JSON.stringify(got[k])
        + ', was saved as ' + JSON.stringify(want[k]));
    }
  }
  // The upgrades and their counts came back too.
  const qty = await page.locator('#ups .uq input').first().inputValue();
  if (qty !== '4') throw new Error('the sensor count reopened as ' + qty);
  // And it still passes its own checks, so it can be issued straight away.
  const bad = (await checks()).filter(x => x.startsWith('bad'));
  if (bad.length) throw new Error(bad.join(' | '));
});

const real = errs.filter(e => !/favicon\.ico/.test(e)
  && !/Failed to load resource: the server responded with a status of 404/.test(e));
say('no javascript errors on the page', real.length === 0, real.join(' | '));

await browser.close();
console.log(fail ? '\n  ' + fail + ' failed' : '\n  all passed');
process.exit(fail ? 1 : 0);


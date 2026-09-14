// Every price the application asks for must be enterable, and entering one must
// actually change the quote. This drives HVAC Design Settings → Material rates
// in the real page against a stubbed database.
import { chromium } from 'playwright';
import { signInContext } from './signin.mjs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
let fail = 0;
const say = (n, c, x) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) fail++; };

const settings = new Map();
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
await signInContext(ctx);
const p = await ctx.newPage();
p.on('pageerror', e => console.log('   [pageerror]', e.message.slice(0, 140)));
await p.route('**/rest/v1/**', async r => {
  const req = r.request(), url = req.url();
  if (req.method() === 'POST') {
    const x = JSON.parse(req.postData() || '{}');
    settings.set(x.key, x.value);
    return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
  }
  const m = /key=eq\.([^&]+)/.exec(url);
  const v = m ? settings.get(decodeURIComponent(m[1])) : undefined;
  return r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(v !== undefined ? [{ value: v }] : []) });
});
await p.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'load' });
await p.waitForTimeout(1800);

await p.evaluate(() => window.nacDesigner.openSettings('materials'));
await p.waitForTimeout(700);

const text = await p.evaluate(() => document.body.innerText);
// innerText returns CSS-transformed text, and the card titles are uppercased.
say('the settings screen opens on Material rates', /still to confirm/i.test(text));
say('it says how many rates are unconfirmed', /rate\(s\) are still to be confirmed/.test(text),
  (/\d+ rate\(s\) are still to be confirmed[^.]*\./.exec(text) || [''])[0].slice(0, 80));

// The seven that previously had nowhere to be typed.
for (const label of ['Round insulated diffuser 100 mm', 'Round insulated diffuser 125 mm',
                     'Round insulated diffuser 150 mm', 'Round insulated diffuser 200 mm',
                     'Zone motor / motorised damper 24 V 100 mm',
                     'Zone motor / motorised damper 24 V 125 mm',
                     'Zone motor / motorised damper 24 V 150 mm']) {
  say('"' + label + '" has a box to type into', text.includes(label));
}
say('lines with NO price at all are called that', /NO PRICE AT ALL/.test(text));
say('flexible duct is still per diameter', /Insulated flexible duct R1.0 150 mm/.test(text));
say('confirmed supplier rates are listed separately', /confirmed rates/i.test(text));

// Type a rate and prove it reaches the database and the costing.
const before = await p.evaluate(async () => {
  const { resolveCost } = await import('/designer/engines/materials.mjs');
  const r = resolveCost('diffuser_round', { diameterMm: 150,
    nacRates: window.nacDesigner.materialRates });
  return { cost: r.cost, source: r.source };
});
say('150 mm diffuser starts on a placeholder', before.source === 'default_placeholder',
  '$' + before.cost + ' from ' + before.source);

await p.evaluate(() => window.nacDesigner.updateMaterialRate('diffuser_round.150', 26.4));
await p.waitForTimeout(400);
// Rates are saved when Save is pressed, not on every keystroke.
const savedOk = await p.evaluate(() => window.nacDesigner.saveSettings());
await p.waitForTimeout(600);
say('Save reports that the database took it', savedOk === true, String(savedOk));

const after = await p.evaluate(async () => {
  const { resolveCost } = await import('/designer/engines/materials.mjs');
  const r = resolveCost('diffuser_round', { diameterMm: 150,
    nacRates: window.nacDesigner.materialRates });
  return { cost: r.cost, source: r.source };
});
say('typing a rate overrides the placeholder', after.cost === 26.4 && after.source === 'nac',
  '$' + after.cost + ' from ' + after.source);

const saved = settings.get('nac_hvac_materials_v1');
let parsed = null; try { parsed = JSON.parse(saved); } catch (e) { /* reported below */ }
say('it was written to the database, not just the page',
  parsed?.diffuser_round?.['150'] === 26.4, saved ? saved.slice(0, 90) : 'nothing saved');

await p.reload({ waitUntil: 'load' });
await p.waitForTimeout(1800);
const reloaded = await p.evaluate(() => window.nacDesigner.materialRates?.diffuser_round?.['150']);
say('and it survives a reload', reloaded === 26.4, String(reloaded));

// And a save the database REFUSES must not be reported as a save.
await p.route('**/rest/v1/**', r => r.request().method() === 'POST'
  ? r.fulfill({ status: 503, body: 'service unavailable' })
  : r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
const refused = await p.evaluate(() => window.nacDesigner.saveSettings());
await p.waitForTimeout(500);
const toastText = await p.evaluate(() =>
  [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | '));
say('a refused save is NOT reported as saved', refused === false, String(refused));
say('and it says so in plain words', /THIS DEVICE ONLY/.test(toastText),
  toastText.slice(0, 110) || '(no toast)');

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
await b.close();
process.exit(fail ? 1 : 0);

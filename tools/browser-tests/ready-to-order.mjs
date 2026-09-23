// AFTER CUSTOMER ACCEPTANCE — the job becomes READY TO ORDER.
//
//   SEND QUOTE → customer accepts → READY TO ORDER
//   → supplier order list + installer design sheet + ServiceM8 reference
//
// The acceptance is faked at the DATABASE, not in the app, because that is
// where it really happens: the customer signs on sign.html and the quote row
// gets accepted=true. This proves the designer notices.

import { chromium } from 'playwright';
import { signInContext } from './signin.mjs';
import { ensureAdvanced } from './advanced.mjs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
await signInContext(ctx);

const settings = new Map(), designs = new Map(), quotes = new Map();
let failures = 0, step = 0;
const say = (n, c, d) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failures++; };
const STEP = (n) => console.log(`\n[${++step}] ${n}`);

const p = await ctx.newPage();
p.on('pageerror', e => console.log('   [pageerror]', e.message.slice(0, 160)));

await p.route('**/rest/v1/nac_settings**', async r => {
  const q = r.request();
  if (q.method() === 'POST') { const x = JSON.parse(q.postData() || '{}'); settings.set(x.key, x.value);
    return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' }); }
  const m = /key=eq\.([^&]+)/.exec(q.url());
  const v = m ? settings.get(decodeURIComponent(m[1])) : undefined;
  return r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify(v !== undefined ? [{ value: v }] : []) });
});
await p.route('**/rest/v1/nac_designs**', async r => {
  const q = r.request();
  if (q.method() === 'POST') { const x = JSON.parse(q.postData() || '{}'); designs.set(x.id, x);
    return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' }); }
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([...designs.values()]) });
});
await p.route('**/rest/v1/nac_quotes**', async r => {
  const q = r.request();
  if (q.method() === 'POST') { const x = JSON.parse(q.postData() || '{}');
    quotes.set(x.id, { ...(quotes.get(x.id) || {}), ...x });
    return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' }); }
  const m = /id=eq\.([^&]+)/.exec(q.url());
  const row = m ? quotes.get(decodeURIComponent(m[1])) : null;
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(row ? [row] : []) });
});

const main = () => p.evaluate(() => document.querySelector('.main')?.innerText || '');
const goStep = async (name) => {
  await p.locator('.steps .step', { hasText: name }).first().click();
  await p.waitForTimeout(800);
};

// ── 1. Build a quotable design ──────────────────────────────────────────────
STEP('Build a design and get it to a quote');
await p.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'load' });
await p.waitForTimeout(1300);
await p.locator('button', { hasText: 'Load the sample builder plan' }).first().click();
await p.waitForTimeout(2600);

await ensureAdvanced(p);
await p.evaluate(() => window.nacDesigner.setTab('rooms'));
await p.waitForTimeout(500);
const va = p.locator('button', { hasText: 'Verify all' });
if (await va.count()) await va.last().click();
await p.waitForTimeout(1800);

// Give the job everything it needs so a quote is legitimately possible: a
// price for the unit, and rates for the lines that ship with none.
const ready = await p.evaluate(() => {
  const app = window.nacDesigner;
  const u = app.design.selectedUnit;
  if (u) { u.supplierCost = u.supplierCost ?? 4625; u.sellPrice = 16500; }
  app.materialRates = { ...(app.materialRates || {}), zone_motor: 92 };
  app.design.sitePhase = '1Ph';
  // The static pressure figure this model has no data sheet for.
  app.design.equipmentSpecs = { ...(app.design.equipmentSpecs || {}) };
  app.update();
  const unpricedLines = (app.design.bom?.items || []).filter(i => !i.priced);
  return { unpriced: app.design.bom?.unpricedCount ?? null,
           unpricedKeys: [...new Set(unpricedLines.map(i => i.key))],
           btoConfigs: unpricedLines.filter(i => i.key === 'bto_fitting').map(i => i.configKey),
           gateOk: app.design.quoteGate?.ok ?? null,
           gateCodes: (app.design.quoteGate?.blockers || []).map(b => b.code),
           sell: app.design.commercials?.sellPriceIncGst ?? null };
});
console.log('     ', JSON.stringify(ready));
say('the design has a sell price', ready.sell > 0, '$' + ready.sell);
// EVERY BRANCH TAKE-OFF IS PRICED, AND SAYS HOW.
//
// `bto_400_250_250_250` is still not the same fitting as `bto_350_250_250_250`,
// and neither borrows the other's price. What changed is where a price comes
// from when nobody has entered one: a configuration MMEM stock is priced as
// that part, and one they do not stock carries the interim rate Nick
// authorised — "just do all bto as 75+ each no matter what until i get the
// exact descriptions". So there are no unpriced lines left, and the quote is
// no longer blocked by them.
say('no line is left with no cost at all',
  ready.unpricedKeys.length === 0,
  ready.unpricedKeys.join(', ') || 'none');
say('and each take-off names the exact configuration it is priced on',
  ready.btoConfigs.every(k => /^bto_\d+(_\d+)+$/.test(k)),
  ready.btoConfigs.join(', ') || 'none');
say('the take-offs no longer block the customer quote',
  !ready.gateCodes.includes('BTO_PRICE_REQUIRED'),
  ready.gateCodes.join(', ') || 'nothing blocking');

// ── 2. Push it to a quote ───────────────────────────────────────────────────
STEP('Create the customer quote');
const quoteId = await p.evaluate(async () => {
  const app = window.nacDesigner;
  const Store = await import('/designer/engines/store.mjs');
  const r = await Store.pushDesignToQuote(app.design);
  app.design.quoteId = r.quoteId;
  app.update();
  return r.quoteId;
});
say('a quote exists', !!quoteId, quoteId);
say('and it reached the database', quotes.has(quoteId));

// ── 3. Not ready to order yet ───────────────────────────────────────────────
STEP('Before acceptance, the job is NOT ready to order');
await p.evaluate(() => window.nacDesigner.enterQuick());
await goStep('Send');
await p.waitForTimeout(900);
const beforeText = await main();
say('the send step does not claim the job is ready', !/READY TO ORDER\n/.test(beforeText));
say('it says what happens next', /Once the customer accepts/i.test(beforeText));

// ── 4. The customer signs ───────────────────────────────────────────────────
STEP('The customer accepts on sign.html — the quote row changes, not the app');
quotes.set(quoteId, {
  ...quotes.get(quoteId),
  accepted: true,
  accepted_time: new Date().toISOString(),
  chosen_brand: 'Daikin',
  servicem8_job_id: 'JOB-4471',
  servicem8_status: 'created'
});
await p.evaluate(() => window.nacDesigner.refreshAcceptance());
await p.waitForTimeout(1200);
const afterText = await main();
say('the designer noticed the acceptance', /READY TO ORDER/.test(afterText));
say('it names what the customer chose', /Daikin/.test(afterText));
say('the ServiceM8 job reference is shown', /JOB-4471/.test(afterText));

// ── 5. The supplier order list ──────────────────────────────────────────────
STEP('SUPPLIER ORDER LIST — what NAC buys, in the units NAC buys it in');
const order = await p.evaluate(async () => {
  const { supplierOrderList } = await import('/designer/engines/order.mjs');
  const o = supplierOrderList(window.nacDesigner.design);
  return {
    ready: o.ready, lineCount: o.lineCount, groups: o.groups.map(g => g.name),
    hasSystem: o.lines.some(l => l.key === 'system'),
    ductUnits: [...new Set(o.lines.filter(l => l.key === 'flex_duct').map(l => l.unit))],
    ductQty: o.lines.filter(l => l.key === 'flex_duct').map(l => l.quantity),
    codes: o.lines.filter(l => l.supplierCode).length,
    unpriced: o.unpricedCount,
    total: o.totalCost
  };
});
console.log('     ', JSON.stringify(order));
say('the order is ready', order.ready);
say('the system itself is on it', order.hasSystem);
say('duct is ordered in 6 m lengths, not metres',
  order.ductUnits.every(u => /6 m length/.test(u)), order.ductUnits.join(','));
say('lines carry supplier codes', order.codes > 0, order.codes + ' coded');
say('it is grouped for the counter', order.groups.length > 1, order.groups.join(' / '));

await p.locator('button', { hasText: 'SUPPLIER ORDER LIST' }).first().click();
await p.waitForTimeout(700);
const orderDlg = await p.evaluate(() => document.querySelector('.dlg-panel')?.innerText || '');
say('the order opens as a readable list', /EQUIPMENT|DUCTWORK/.test(orderDlg),
  orderDlg.split('\n').length + ' lines');
say('it shows the metres behind each pack', /m needed/.test(orderDlg));
await p.locator('.dlg-foot button').last().click();
await p.waitForTimeout(400);

// ── 6. The installer sheet has no money on it ───────────────────────────────
STEP('INSTALLER DESIGN SHEET — no pricing anywhere on it');
await p.locator('button', { hasText: 'INSTALLER DESIGN SHEET' }).first().click();
await p.waitForTimeout(700);
const sheet = await p.evaluate(() => document.querySelector('.dlg-panel')?.innerText || '');
say('it carries the duct schedule', /DUCT SCHEDULE/.test(sheet));
say('it carries the outlets', /OUTLETS/.test(sheet));
say('there is not a dollar figure on it', !/\$/.test(sheet));
say('there is no cost or margin wording on it',
  !/\b(cost|margin|profit|sell price|supplier cost)\b/i.test(sheet));
say('what must be checked on site is on it',
  /VERIFY ON SITE|trusses/i.test(sheet) || !/AUTO ROUTE/.test(sheet));
await p.locator('.dlg-foot button').last().click();
await p.waitForTimeout(400);

// ── 7. It persisted ─────────────────────────────────────────────────────────
STEP('The accepted state is saved, not just shown');
const saved = await p.evaluate(() => ({
  state: window.nacDesigner.design.jobState,
  status: window.nacDesigner.design.status
}));
say('the design records READY TO ORDER', saved.state === 'ready_to_order', JSON.stringify(saved));

await b.close();
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);

// "DAIKIN OR BRAEMAR", ON THE DEVICE THE CUSTOMER READS IT ON.
//
// NAC have offered a choice of systems for years. The new quote presentation
// could not, so this is the page that choice lives on: alternatives as radios,
// the price moving under a thumb, and nothing about NAC's costs anywhere near
// it.
//
//   node tools/serve.mjs &   node tools/browser-tests/system-choice.mjs

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { buildPresentation } from '../../designer/engines/presentation.mjs';
import { renderPresentationHtml } from '../../designer/ui/presentation-html.mjs';
import { buildDemoDesign, DEMO_CONTENT } from '../../tests/fixtures/demo-presentation.mjs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
let fail = 0;
const say = (n, c, x) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${x ? '  — ' + x : ''}`); if (!c) fail++; };

const DEMO = { ...(await buildDemoDesign()).out,
               fittingAssembly: { ok: true, rows: [], unbuildable: [] } };
const TERMS = { commercial: { terms: { depositPercent: 50, balanceDueEvent: 'completion',
  validityDays: 30, paymentMethods: ['Direct deposit', 'EFT'], termsVersion: 'NAC T&C v1.0',
  paymentStages: [{ label: 'Deposit on acceptance' }, { label: 'Balance on completion' }],
  confirmed: true, confirmedBy: 'Nick Cahill', confirmedAt: '2026-09-23' } } };

const built = buildPresentation({
  design: DEMO,
  customer: { name: 'Sarah Whitlock', email: 'sarah.whitlock@bigpond.com',
              phone: '0412 665 108', address: '34 Kauri Crescent, Peregian Springs QLD 4573' },
  job: { siteAddress: '34 Kauri Crescent, Peregian Springs QLD 4573' },
  content: DEMO_CONTENT, settings: TERMS, revision: 1, status: 'draft',
  proposalNumber: 'NAC-2026-0184',
  systemOptions: [
    { id: 'daikin', brand: 'Daikin', model: 'FDYA160AV19 / RZAS160C2V1', capacityKw: 16,
      phase: '1Ph', priceIncGst: 15400, recommended: true,
      note: 'Premium inverter, quietest indoor unit' },
    { id: 'braemar', brand: 'Braemar', model: 'SDHV16D1S Ducted Inverter', capacityKw: 16,
      phase: '1Ph', priceIncGst: 13900 }
  ]
});
if (!built.ok) {
  console.error('the fixture did not build:', built.blockers.map(b => b.code).join(', '));
  process.exit(1);
}
const FILE = '/tmp/nac-system-choice.html';
writeFileSync(FILE, renderPresentationHtml(built.presentation));

const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

for (const [name, w, h] of [['iphone-portrait', 390, 844],
                            ['ipad-portrait', 820, 1180],
                            ['desktop', 1440, 900]]) {
  console.log('\n[' + name + '] ' + w + '×' + h);
  const ctx = await b.newContext({ viewport: { width: w, height: h },
    deviceScaleFactor: 2, isMobile: w < 700, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('   [pageerror]', e.message.slice(0, 140)));
  await p.goto('file://' + FILE, { waitUntil: 'load' });
  await p.waitForTimeout(500);

  const shape = await p.evaluate(() => {
    // Scoped to the chooser: the system section further up has a `.sys`
    // element of its own, and counting it made two options look like three.
    const cards = [...document.querySelectorAll('.syschoice .sys')];
    return {
      count: cards.length,
      radios: document.querySelectorAll('input[type=radio][name="sys"]').length,
      checkboxesInChoice: document.querySelectorAll('.syschoice input[type=checkbox]').length,
      minHeight: Math.min(...cards.map(c => Math.round(c.getBoundingClientRect().height))),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      recommended: document.querySelectorAll('.sys-rec').length,
      heading: !!document.getElementById('choose')
    };
  });
  say('both systems are on the page', shape.count === 2 && shape.heading, shape.count + ' cards');
  say('they are a choice, not a shopping list',
    shape.radios === 2 && shape.checkboxesInChoice === 0,
    shape.radios + ' radios, ' + shape.checkboxesInChoice + ' checkboxes');
  say('one is recommended', shape.recommended === 1);
  say('each card is a real touch target', shape.minHeight >= 48, shape.minHeight + 'px');
  say('the page does not scroll sideways', !shape.overflow);

  // The number has to move under a thumb.
  const before = await p.evaluate(() =>
    [...document.querySelectorAll('[data-total]')].map(e => e.textContent.trim()));
  await p.locator('.sys-in[value="braemar"]').first().click();
  await p.waitForTimeout(250);
  const after = await p.evaluate(() => ({
    totals: [...document.querySelectorAll('[data-total]')].map(e => e.textContent.trim()),
    checked: document.querySelector('.sys-in:checked')?.value
  }));
  say('choosing the other system changes the price everywhere',
    after.checked === 'braemar'
    && after.totals.length > 0
    && after.totals.every(t => t === after.totals[0])
    && after.totals[0] !== before[0],
    before[0] + ' → ' + after.totals[0]);

  // …and back again, because a customer changes their mind.
  await p.locator('.sys-in[value="daikin"]').first().click();
  await p.waitForTimeout(250);
  const back = await p.evaluate(() =>
    document.querySelector('[data-total]')?.textContent.trim());
  say('and back again', back === before[0], after.totals[0] + ' → ' + back);

  await ctx.close();
}

console.log('\n[what the customer must never see]');
const html = renderPresentationHtml(built.presentation);
const c = DEMO.commercials;
const leaks = [];
for (const [k, v] of Object.entries({ totalJobCost: c.totalJobCost, equipmentCost: c.equipmentCost,
                                      materialsCost: c.materialsCost, grossProfit: c.grossProfit,
                                      jobFee: c.jobFee })) {
  const whole = String(Math.round(Number(v)));
  if (new RegExp('(?<![\\d.,])' + whole + '(?![\\d])').test(html)) leaks.push(k + '=' + whole);
}
say('no cost, fee or margin figure is on the page', leaks.length === 0, leaks.join(', ') || 'clean');
say('no cost field name either', !/unitCost|grossMargin|totalJobCost|priceSource/.test(html));

console.log(fail ? `\n${fail} FAILED` : '\nALL PASSED');
await b.close();
process.exit(fail ? 1 : 0);

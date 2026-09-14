// QUICK QUOTE MODE — the default way an NAC estimator uses the designer.
//
//   UPLOAD → VERIFY → DESIGN → PRICE → SEND
//
// What is being tested is the promise: upload a plan and the tool does the job.
// So the assertions are about what the estimator is NOT made to do — thirteen
// tabs, questions the plan already answered — as much as about what works.
//
// The engineering safeguards are tested too, because hiding complexity must
// never mean hiding a blocker.

import { chromium } from 'playwright';
import { signInContext } from './signin.mjs';

const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
await signInContext(ctx);

const settings = new Map(), designs = new Map(), quotes = new Map();
let failures = 0, step = 0;
const say = (n, c, d) => { console.log(`  ${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) failures++; };
const STEP = (n) => console.log(`\n[${++step}] ${n}`);

const p = await ctx.newPage();
p.on('pageerror', e => console.log('   [pageerror]', e.message.slice(0, 160)));

// The database, stubbed, so persistence is exercised without the live project.
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
  if (q.method() === 'POST') { const x = JSON.parse(q.postData() || '{}'); quotes.set(x.id, x);
    return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' }); }
  const m = /id=eq\.([^&]+)/.exec(q.url());
  const row = m ? quotes.get(decodeURIComponent(m[1])) : null;
  return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(row ? [row] : []) });
});

const main = async () => await p.evaluate(() => document.querySelector('.main')?.innerText || '');
const stepNames = async () => await p.evaluate(() =>
  [...document.querySelectorAll('.steps .step')].map(s => s.innerText.replace(/\s+/g, ' ').trim()));
const goStep = async (name) => {
  await p.locator('.steps .step', { hasText: name }).first().click();
  await p.waitForTimeout(600);
};

// ── 1. It opens in quick mode, not engineering software ─────────────────────
STEP('The designer opens in QUICK QUOTE MODE');
await p.goto('http://127.0.0.1:8777/designer.html', { waitUntil: 'load' });
await p.waitForTimeout(1400);

const tabCount = await p.locator('button.tab').count();
say('the thirteen engineering tabs are NOT in the estimator’s way', tabCount === 0,
  tabCount + ' tabs visible');

const steps = await stepNames();
say('there are exactly five steps', steps.length === 5, steps.join(' / '));
say('and they are UPLOAD VERIFY DESIGN PRICE SEND',
  /Upload/.test(steps[0]) && /Verify/.test(steps[1]) && /Design/.test(steps[2]) &&
  /Price/.test(steps[3]) && /Send/.test(steps[4]));

const advBtn = await p.locator('button', { hasText: 'ADVANCED DESIGN' }).count();
say('ADVANCED DESIGN is one click away', advBtn > 0);

// ── 2. Upload ───────────────────────────────────────────────────────────────
STEP('Upload a plan — the tool does the rest');
await p.locator('button', { hasText: 'Load the sample builder plan' }).first().click();
await p.waitForTimeout(2600);
const up = await main();
say('the plan loaded and calibrated', /CALIBRATION DISTANCE|CALCULATED SCALE/i.test(up));
say('the tool shows what it read off the plan', /dimensions read|length\(s\) read/i.test(up));

// ── 3. Verify — only what is genuinely uncertain ────────────────────────────
STEP('VERIFY asks only about what it could not settle');
await goStep('Verify');
const ver = await main();

const asked = await p.evaluate(() =>
  [...document.querySelectorAll('.qint-title')].map(e => e.innerText.trim()));
console.log('     asked about:', asked.length ? asked.join(' | ') : '(nothing)');

say('the screen explains that everything else was answered automatically',
  /answered from the plan|Nothing needs you/i.test(ver));

// Whatever it asks, it must be actionable and must not be a question the plan
// already answered.
const everyRowActionable = await p.evaluate(() =>
  [...document.querySelectorAll('.qint')].every(r => r.querySelector('button')));
say('every question has a way to act on it', asked.length === 0 || everyRowActionable);

const askedAboutGarage = asked.some(t => /garage|bath|ensuite|laundry/i.test(t));
say('it never asks about rooms NAC does not count', !askedAboutGarage);

// ── 4. Review screen ────────────────────────────────────────────────────────
STEP('DESIGN is one review screen: plan on the left, numbers on the right');
await goStep('Design');
await p.waitForTimeout(1200);

const hasPlanPane = await p.locator('.qreview-plan').count();
const hasSide = await p.locator('.qreview-side').count();
say('the plan is on the screen', hasPlanPane > 0);
say('the summary cards are beside it', hasSide > 0);

const canvasInPane = await p.locator('.qreview-plan canvas').count();
say('the real plan viewer is mounted in it, not a placeholder', canvasInPane > 0);

const cards = await p.evaluate(() =>
  [...document.querySelectorAll('.qcard-label')].map(e => e.innerText.trim()));
console.log('     cards:', cards.join(' | '));
for (const want of ['Selected system', 'Total load', 'Total airflow', 'Zones',
                    'Static pressure', 'Material cost', 'Internal job cost',
                    'Customer sell price', 'Gross profit']) {
  say('card: ' + want, cards.some(c => c.toLowerCase() === want.toLowerCase()));
}

const actions = await p.evaluate(() =>
  [...document.querySelectorAll('.qactions button')].map(e => e.innerText.trim()));
say('EDIT DESIGN / APPROVE DESIGN / SEND QUOTE are the three actions',
  actions.includes('EDIT DESIGN') && actions.includes('APPROVE DESIGN') && actions.includes('SEND QUOTE'),
  actions.join(' / '));

// ── 5. Internal money is marked as internal ─────────────────────────────────
STEP('Internal figures are never mistaken for the customer’s');
const internalCards = await p.evaluate(() =>
  [...document.querySelectorAll('.qcard.internal .qcard-label')].map(e => e.innerText.trim()));
say('job cost, material cost and GP are marked internal',
  ['Material cost', 'Internal job cost', 'Gross profit'].every(l =>
    internalCards.some(c => c.toLowerCase() === l.toLowerCase())),
  internalCards.join(' / '));

// ── 6. Price ────────────────────────────────────────────────────────────────
STEP('PRICE shows NAC’s side of the job');
await goStep('Price');
await p.waitForTimeout(700);
const price = await main();
say('it states plainly that the customer never sees these figures',
  /never the cost, the fee, the margin/i.test(price));
say('the job fee is shown as the margin', /Job fee/i.test(price));
say('a sell price exists', /Sell price inc GST/i.test(price));

// ── 7. Send ─────────────────────────────────────────────────────────────────
STEP('SEND creates the customer’s quote');
await goStep('Send');
await p.waitForTimeout(700);
const send = await main();
const sendBtn = p.locator('button', { hasText: 'SEND QUOTE' });
if (await sendBtn.count()) {
  await sendBtn.last().click();
  await p.waitForTimeout(2200);
  // A link dialog opens on success.
  const dlg = await p.evaluate(() => document.querySelector('.modal')?.innerText || '');
  const created = /sign\.html\?q=/.test(dlg) || quotes.size > 0;
  say('a quote was created', created, [...quotes.keys()].join(','));
  const close = p.locator('.modal button', { hasText: /Close|Done|OK/i }).first();
  if (await close.count()) await close.click();
} else {
  say('the send step explains why it cannot quote yet', /must be sorted|confirm/i.test(send));
}

// ── 8. Advanced is still all there ──────────────────────────────────────────
STEP('ADVANCED DESIGN still gives the full engineering set');
await p.locator('button', { hasText: 'ADVANCED DESIGN' }).first().click();
await p.waitForTimeout(700);
const advTabs = await p.evaluate(() =>
  [...document.querySelectorAll('button.tab')].map(e => e.innerText.replace(/\d+$/, '').trim()));
say('all thirteen tabs are back', advTabs.length >= 13, advTabs.length + ': ' + advTabs.join(','));

const backBtn = await p.locator('button', { hasText: 'QUICK QUOTE' }).count();
say('and there is a way back to quick mode', backBtn > 0);
await p.locator('button', { hasText: 'QUICK QUOTE' }).first().click();
await p.waitForTimeout(500);
say('quick mode hides the tabs again', (await p.locator('button.tab').count()) === 0);

// ── Done ────────────────────────────────────────────────────────────────────
await b.close();
console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL PASSED');
process.exit(failures ? 1 : 0);

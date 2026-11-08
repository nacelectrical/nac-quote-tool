// ─────────────────────────────────────────────────────────────────────────────
// THE PRICING ENGINE HAD NOWHERE TO GET ITS NUMBERS FROM
//
// quote-pricing.mjs has been able to price a job from NAC's own figures since
// 7 November. It refuses while the installation allowances are unset, which is
// correct: Number(null) is 0 and a job priced as though the ductwork were free
// is a job priced at a loss.
//
// And `proposalAllowance` and `jobFee` appeared in NO SCREEN. Grep every .html
// file in the repository for either name before 8 November and you get
// nothing. So the refusal was permanent and the engine priced nothing, ever.
//
// This suite covers the readiness check behind /settings.html, and the two
// facts that make it worth having: absent is not zero, and a figure that
// shipped with the application is not NAC's figure.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { priceFromCosts, pricingSetupStatus, ALLOWANCES } from '../designer/engines/quote-pricing.mjs';
import { DEFAULT_SETTINGS, mergeSettings } from '../designer/engines/settings.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

const withCommercial = (override) =>
  mergeSettings(DEFAULT_SETTINGS, { commercial: override });

// ── WHAT IS MISSING, NAMED ─────────────────────────────────────────────────

test('out of the box the allowances are missing and it says which', () => {
  const st = pricingSetupStatus(DEFAULT_SETTINGS, { stored: {} });
  assert.equal(st.ok, false);
  assert.deepEqual(st.missing.map(m => m.key), ['proposalAllowance']);
  assert.match(st.missing[0].why, /priced at a loss/);
});

test('with no job fee, that is named too', () => {
  // Built directly rather than through mergeSettings: merge deliberately
  // ignores a null override, so the shipped 6000 cannot be unset that way.
  // That is correct for the merge and makes it the wrong tool here.
  const st = pricingSetupStatus(
    { commercial: { ...DEFAULT_SETTINGS.commercial, jobFee: null } }, { stored: {} });
  assert.ok(st.missing.some(m => m.key === 'jobFee'));
  assert.match(st.missing.find(m => m.key === 'jobFee').why, /the fee IS the margin/i);
});

test('one allowance is enough to unblock it, and zero counts as one', () => {
  // A 0 somebody typed is a decision — NAC carries no plenum allowance, say —
  // and it is honoured as zero. A null is nobody's decision.
  const stored = { commercial: { jobFee: 5500, proposalAllowance: { plenums: 0 } } };
  const st = pricingSetupStatus(mergeSettings(DEFAULT_SETTINGS, stored), { stored });
  assert.equal(st.ok, true);
  assert.deepEqual(st.missing, []);
  assert.ok(st.set.includes('proposalAllowance.plenums'));
});

test('every allowance the engine prices from has a field on the screen', () => {
  const st = pricingSetupStatus(DEFAULT_SETTINGS, { stored: {} });
  const keys = st.fields.map(f => f.key);
  for (const [key, label] of ALLOWANCES) {
    assert.ok(keys.includes('proposalAllowance.' + key),
      'the pricing engine reads proposalAllowance.' + key + ' (' + label
      + ') and the setup screen has no field for it');
  }
  for (const extra of ['proposalAllowance.perOutlet', 'proposalAllowance.perZone',
                       'proposalAllowance.contingencyPct', 'jobFee', 'gstRate']) {
    assert.ok(keys.includes(extra), extra + ' has no field');
  }
});

test('every field carries a unit, because a number without one is a guess', () => {
  for (const f of pricingSetupStatus(DEFAULT_SETTINGS, { stored: {} }).fields) {
    assert.ok(f.unit && f.unit.length > 0, f.key + ' has no unit');
    assert.ok(f.why && f.why.length > 10, f.key + ' does not say what it is for');
  }
});

// ── A SHIPPED DEFAULT IS NOT NAC'S FIGURE ──────────────────────────────────

test('a figure that shipped with the application is reported unconfirmed', () => {
  // jobFee ships at 6000. Nobody can say whether NAC agreed to it. It is the
  // same hazard quote-gate.mjs names about placeholder rates: the quote adds
  // up and the margin is fiction.
  const st = pricingSetupStatus(DEFAULT_SETTINGS, { stored: {} });
  const keys = st.unconfirmed.map(u => u.key);
  assert.ok(keys.includes('jobFee'),
    'the shipped job fee must be flagged until NAC saves it');
  assert.equal(st.fields.find(f => f.key === 'jobFee').source, 'shipped_default');
});

test('once NAC saves it, the same figure stops being unconfirmed', () => {
  const stored = { commercial: { jobFee: 6000 } };
  const st = pricingSetupStatus(mergeSettings(DEFAULT_SETTINGS, stored), { stored });
  assert.ok(!st.unconfirmed.some(u => u.key === 'jobFee'));
  assert.equal(st.fields.find(f => f.key === 'jobFee').source, 'nac');
});

test('a saved zero is NAC’s decision, not an unset field', () => {
  const stored = { commercial: { jobFee: 0 } };
  const st = pricingSetupStatus(mergeSettings(DEFAULT_SETTINGS, stored), { stored });
  const fee = st.fields.find(f => f.key === 'jobFee');
  assert.equal(fee.set, true);
  assert.equal(fee.source, 'nac');
  assert.equal(fee.unconfirmed, false);
});

test('an allowance that is not set reads not_set, not shipped_default', () => {
  const st = pricingSetupStatus(DEFAULT_SETTINGS, { stored: {} });
  const duct = st.fields.find(f => f.key === 'proposalAllowance.ductwork');
  assert.equal(duct.set, false);
  assert.equal(duct.source, 'not_set');
  assert.equal(duct.value, null, 'and it is null, never 0');
});

// ── WHAT IS BLOCKED, AND WHAT IS NOT ───────────────────────────────────────

test('only the suggested price is blocked — never the draft or the assessment', () => {
  // Nick: "Allow draft saving while blocking final pricing/issue where
  // required inputs are missing." The estimator must never be stopped from
  // recording what they found on site.
  const st = pricingSetupStatus(DEFAULT_SETTINGS, { stored: {} });
  assert.equal(st.blocks.length, 2);
  assert.match(st.blocks[0], /suggested price/i);
  assert.match(st.blocks[1], /Drafts, assessments, room measurements and the sizing/);
  assert.match(st.blocks[1], /typed by hand still works and still issues/);
});

test('with everything set, nothing is blocked', () => {
  const stored = { commercial: { jobFee: 5500, proposalAllowance: { flat: 4200 } } };
  const st = pricingSetupStatus(mergeSettings(DEFAULT_SETTINGS, stored), { stored });
  assert.deepEqual(st.blocks, []);
});

// ── THE READINESS CHECK AND THE ENGINE AGREE ───────────────────────────────

test('when the setup says ready, the engine prices; when it does not, it refuses', () => {
  // Two answers to "can this price a job" is how a screen and an engine drift
  // into disagreeing in front of a customer.
  const draft = { controller: {}, scope: { zoneCount: 3, outletCount: 6 } };
  const system = { brand: 'Daikin', model: 'FDYAN100AV1', supplierCost: 4800,
                   supplierCostGstInclusive: false };

  const unset = DEFAULT_SETTINGS;
  assert.equal(pricingSetupStatus(unset, { stored: {} }).ok, false);
  assert.equal(priceFromCosts(draft, { settings: unset, system, outlets: 6 }).ok, false,
    'the engine must refuse while the setup check says it is not ready');

  const ready = withCommercial({ jobFee: 5500,
    proposalAllowance: { ductwork: 3200, electrical: 800, perOutlet: 120 } });
  assert.equal(pricingSetupStatus(ready, { stored: { commercial: ready.commercial } }).ok, true);
  const priced = priceFromCosts(draft, { settings: ready, system, outlets: 6 });
  assert.equal(priced.ok, true, JSON.stringify(priced.missing));
  assert.ok(priced.sellIncGst > 0);
  // And the fee is the only margin in it.
  assert.equal(priced.feeExGst, 5500);
});

test('the price is still refused when the equipment has no cost, setup or no setup', () => {
  const ready = withCommercial({ jobFee: 5500, proposalAllowance: { flat: 4000 } });
  const out = priceFromCosts({ controller: {}, scope: {} },
    { settings: ready, system: null, outlets: 4 });
  assert.equal(out.ok, false);
  assert.ok(out.missing.some(m => m.key === 'equipment'));
  assert.equal(out.sellIncGst, null, 'and it offers no figure at all');
});

// ── THE SCREEN EXISTS, WHICH IS THE WHOLE FINDING ──────────────────────────

test('a screen in the application actually has these fields', () => {
  // This is the test that would have caught the original defect: the engine,
  // its refusal and its tests were all correct, and there was no way to enter
  // the numbers. It reads the shipped HTML.
  const screens = readdirSync(ROOT).filter(f => f.endsWith('.html'))
    .map(f => ({ name: f, src: readFileSync(ROOT + '/' + f, 'utf8') }));
  // It has to WRITE them, not merely mention them: a screen that reads the
  // allowances to price a job is not a screen that can set them, and that
  // distinction is the entire defect.
  const hits = screens.filter(s => /proposalAllowance/.test(s.src)
    && /jobFee/.test(s.src)
    && /setSetting\(\s*SETTINGS_KEYS\.hvacSettings/.test(s.src));
  assert.ok(hits.length > 0,
    'no screen in the application can SET proposalAllowance and jobFee, so the '
    + 'pricing engine can never be satisfied');

  const screen = hits[0].src;
  // Units, GST treatment and validation — the three things Nick asked for.
  assert.match(screen, /dollars per job/, 'the allowance fields need their unit');
  assert.match(screen, /Excluding GST|Including GST/,
    'the job fee needs its GST treatment asked, not assumed');
  assert.match(screen, /aria-invalid/, 'the fields need validation the screen reader sees');
  assert.match(screen, /pricingSetupStatus/, 'and it should use the shared readiness check');
});

test('the setup screen is reachable from the place the refusal appears', () => {
  // "Set the missing figures on the Settings screen" pointed at nothing for a
  // month. It is a link now.
  const builder = readFileSync(ROOT + '/quote-builder.html', 'utf8');
  assert.match(builder, /href: '\/settings\.html'/,
    'the price panel has to link to the screen that fixes it');
});

// ─────────────────────────────────────────────────────────────────────────────
// OUTLETS PER ZONE, AND A PRICE BUILT FROM NAC'S OWN NUMBERS
//
// Nick, 7 November 2026:
//   "Hasn't calculated how many outlets per zone"
//   "I need it to create pricing for me based on all the prices I have given you"
//
// Everything both of these need had been in the application for weeks, in
// pieces that never met: NAC's published outlet rules, the MMEM supplier
// costs, the zone kits with their costs, the installation allowances on the
// Settings screen, and a declared pricing method. The quote screen asked the
// estimator to do all of it in his head and type two numbers.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { outletsForRoom, outletsByZone } from '../designer/engines/outlet-plan.mjs';
import { priceFromCosts } from '../designer/engines/quote-pricing.mjs';
import { createQuoteDraft, draftToQuoteSource } from '../designer/engines/quote-draft.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';
import { OUTLET_RULES } from '../designer/engines/nac-standard.mjs';

// ── OUTLETS ────────────────────────────────────────────────────────────────

test('the counts are NAC’s published rule, not a number chosen here', () => {
  // One outlet for a bedroom; a second only once it is over the split size
  // its own type carries. These come out of nac-standard.mjs.
  const small = outletsForRoom({ label: 'Bedroom 2', areaSqM: 10.9 });
  assert.equal(small.outlets, OUTLET_RULES.byRoomType.bedroom.preferred);
  assert.equal(small.roomType, 'bedroom');

  const big = outletsForRoom({ label: 'Living', areaSqM: 44 });
  assert.ok(big.outlets > 1, 'a 44 m² living area on one outlet');
  assert.ok(big.outlets <= OUTLET_RULES.byRoomType.living.maxAuto);
  assert.match(big.why, /20 m²|over the/);
});

test('a study never splits, because NAC says it does not', () => {
  // maxAuto is 1 for a study. A 30 m2 study is still one outlet, and the
  // reason says it was capped rather than silently rounded.
  const r = outletsForRoom({ label: 'Study', areaSqM: 30 });
  assert.equal(r.outlets, 1);
  assert.match(r.why, /capped/);
});

test('no room takes more than the hard ceiling', () => {
  const r = outletsForRoom({ label: 'Living', areaSqM: 500 });
  assert.ok(r.outlets <= OUTLET_RULES.maxPerRoom, r.outlets + ' outlets in one room');
});

test('A TYPED COUNT IS THE ANSWER, not a starting point', () => {
  // The estimator stood in the room. Nothing here second-guesses that.
  const r = outletsForRoom({ label: 'Bedroom 2', areaSqM: 9, outlets: 3 });
  assert.equal(r.outlets, 3);
  assert.equal(r.entered, true);
  // Including a deliberate zero, which is a decision and not an absence.
  assert.equal(outletsForRoom({ label: 'Hall', outlets: 0 }).outlets, 0);
});

test('a room with no size is counted at the minimum AND reported', () => {
  // Not guessed at. One outlet in a room that needed three is a quote that
  // loses money, so it says which rooms it could not size.
  const r = outletsForRoom({ label: 'Media' });
  assert.equal(r.sized, false);
  assert.match(r.why, /no size/i);

  const plan = outletsByZone([{ label: 'Media', zone: 'Media' }], ['Media']);
  assert.equal(plan.unsized, 1);
  assert.equal(plan.zones[0].unsized, 1);
});

test('they add up per zone, and nothing is dropped', () => {
  const rooms = [
    { label: 'Living / Dining', zone: 'Living', areaSqM: 38 },
    { label: 'Kitchen', zone: 'Living', areaSqM: 12 },
    { label: 'Master', zone: 'Master', areaSqM: 17 },
    { label: 'Hall', zone: '', areaSqM: 8 }
  ];
  const plan = outletsByZone(rooms, ['Living', 'Master']);
  assert.equal(plan.zones.length, 2);
  assert.equal(plan.zones[0].outlets,
    plan.zones[0].rooms.reduce((n, r) => n + r.outlets, 0));
  // A room in no zone is NOT dropped — it still takes outlets, and it is
  // visible as sitting outside the zoning.
  assert.equal(plan.unzoned.rooms.length, 1);
  assert.equal(plan.total,
    plan.zones.reduce((n, z) => n + z.outlets, 0) + plan.unzoned.outlets);
});

test('zone names are matched the way the proposal matches them', () => {
  // Case-insensitively, the same as the zone schedule.
  const plan = outletsByZone([{ label: 'Master', zone: 'master', areaSqM: 15 }], ['Master']);
  assert.equal(plan.zones[0].rooms.length, 1);
  assert.equal(plan.unzoned.rooms.length, 0);
});

// ── PRICING ────────────────────────────────────────────────────────────────

const SYS = { brand: 'Daikin', brandId: 'daikin', model: 'FDYAN160AV1',
              capacityKw: 16, phase: '1Ph' };

const jobDraft = (over = {}) => createQuoteDraft({
  systems: [SYS],
  controller: { id: 'siemens_z6', name: 'Siemens Home zone control — 6 zone', zoneCount: 6 },
  scope: { zoneCount: 6, outletCount: 12, conditionedRooms: [] },
  ...over
});

const settingsWith = (allowance) => {
  const s = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  s.commercial.proposalAllowance = { ...s.commercial.proposalAllowance, ...allowance };
  return s;
};

test('AN ALLOWANCE NOBODY SET IS NOT ZERO', () => {
  // The whole reason this engine can be trusted. Every allowance ships null —
  // they are NAC's own figures — and Number(null) is 0, which would price a
  // job as though the ductwork, the electrical and the refrigeration were
  // free. It refuses instead, and names what is missing.
  const r = priceFromCosts(jobDraft(), { settings: DEFAULT_SETTINGS, system: SYS });
  assert.equal(r.ok, false);
  assert.equal(r.sellIncGst, null, 'it produced a price with no allowances set');
  const m = r.missing.find(x => x.key === 'allowances');
  assert.ok(m, JSON.stringify(r.missing.map(x => x.key)));
  assert.match(m.why, /Settings/);
  // It still shows what it DOES know, so the gap is obvious.
  assert.ok(r.lines.some(l => l.key === 'equipment'));
});

test('with NAC’s figures set, it prices the job', () => {
  const s = settingsWith({ ductwork: 2200, returns: 450, electrical: 600,
                           refrigeration: 900, condensate: 180, roofAccess: 350,
                           perOutlet: 120, perZone: 90 });
  const r = priceFromCosts(jobDraft(), { settings: s, system: SYS, outlets: 12 });
  assert.equal(r.ok, true, JSON.stringify(r.missing));

  // Cost + fee + GST, and the arithmetic is checkable by hand.
  assert.equal(r.feeExGst, s.commercial.jobFee);
  const lines = r.lines.reduce((t, l) => t + l.exGst, 0);
  assert.ok(Math.abs(lines - r.costExGst) < 0.01, 'the lines do not add up to the cost');
  assert.ok(Math.abs((r.costExGst + r.feeExGst) - r.sellExGst) < 0.01);
  assert.ok(Math.abs(r.sellExGst * r.gstRate - r.gst) < 0.01);
  assert.equal(r.sellIncGst, Math.round(r.sellExGst + r.gst));

  // Every line says where its number came from.
  for (const l of r.lines) assert.ok(l.source, l.label + ' has no source');
  // The counted allowances scale with the job.
  assert.ok(r.lines.some(l => /12 outlet/.test(l.label)));
  assert.ok(r.lines.some(l => /6 zone/.test(l.label)));
});

test('a machine with no cost on file stops it, rather than being guessed', () => {
  const unknown = { brand: 'Acme', brandId: 'acme', model: 'NOT-A-REAL-MODEL',
                    capacityKw: 16, phase: '1Ph' };
  const s = settingsWith({ ductwork: 2200 });
  const r = priceFromCosts(jobDraft({ systems: [unknown] }), { settings: s, system: unknown });
  assert.equal(r.ok, false);
  const m = r.missing.find(x => x.key === 'equipment');
  assert.ok(m, 'an unknown machine was priced anyway');
  assert.match(m.why, /supplier cost/i);
});

test('a zero somebody entered is honoured, because it is a decision', () => {
  const s = settingsWith({ ductwork: 0, returns: 0, electrical: 0, refrigeration: 0,
                           condensate: 0, roofAccess: 0 });
  const r = priceFromCosts(jobDraft(), { settings: s, system: SYS, outlets: 12 });
  assert.equal(r.ok, true, JSON.stringify(r.missing));
  assert.ok(r.lines.some(l => l.key === 'allow_ductwork' && l.exGst === 0));
});

test('no job fee is no price, because the fee IS the margin', () => {
  const s = settingsWith({ ductwork: 2200 });
  s.commercial.jobFee = null;
  const r = priceFromCosts(jobDraft(), { settings: s, system: SYS });
  assert.equal(r.ok, false);
  assert.ok(r.missing.some(x => x.key === 'jobFee'));
});

test('a controller supplied with the system adds nothing, and says so', () => {
  const s = settingsWith({ ductwork: 2200, returns: 450, electrical: 600,
                           refrigeration: 900, condensate: 180, roofAccess: 350 });
  const d = jobDraft({ controller: { id: 'std', name: 'Brand Standard Controller' } });
  const r = priceFromCosts(d, { settings: s, system: SYS, outlets: 12 });
  assert.ok(!r.lines.some(l => l.key === 'controller'), 'it charged for a bundled controller');
  assert.ok(r.notes.some(t => /supplied with the system/i.test(t)));
});

test('a controller typed by hand is not silently free', () => {
  const s = settingsWith({ ductwork: 2200 });
  const d = jobDraft({ controller: { id: '', name: 'Some other brand 6 zone' } });
  const r = priceFromCosts(d, { settings: s, system: SYS, outlets: 12 });
  assert.equal(r.ok, false);
  assert.ok(r.missing.some(x => x.key === 'controller'));
});

test('NAC’s cost and margin never reach the customer', () => {
  // The method, the cost and the fee are NAC's commercial business. The
  // customer gets a price.
  const d = createQuoteDraft({
    systems: [{ ...SYS, priceIncGst: 19856 }],
    pricedBy: { method: 'COST_PLUS_JOB_FEE', costExGst: 12051, feeExGst: 6000 }
  });
  const src = draftToQuoteSource(d, { upgrades: [] });
  const blob = JSON.stringify(src);
  assert.ok(!/12051/.test(blob), 'the job cost reached the customer payload');
  assert.ok(!/COST_PLUS_JOB_FEE/.test(blob), 'the pricing method reached the customer');
  assert.ok(!/pricedBy/.test(blob));
  // And the price did.
  assert.match(blob, /19856/);
});

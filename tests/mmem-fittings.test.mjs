// ─────────────────────────────────────────────────────────────────────────────
// MMEM'S TAKE-OFFS AND Y-PIECES ARE PARTS, NOT FABRICATIONS
//
// The design engine treats a BTO as something a sheet-metal shop makes to
// order: any inlet, any outlets. MMEM sell them as catalogue parts with fixed
// inlets and fixed outlets. Where those two disagree, somebody in a roof space
// is holding a 250 flex and a 300 collar.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MMEM_BTO_FITTINGS, SELECTABLE_FITTINGS, INCOMPLETE_FITTINGS, findFitting,
         parseConfigKey, describeFitting, unstockedConfigurations, isSelectable }
  from '../designer/engines/mmem-fittings.mjs';
import { resolveBtoPrice, BTO_PRICE_STATUS, BTO_INTERIM_RATE, priceIsQuotable }
  from '../designer/engines/bto-pricing.mjs';

test('every part carries MMEM’s price, and the nine are all there', () => {
  assert.equal(MMEM_BTO_FITTINGS.length, 9);
  for (const f of MMEM_BTO_FITTINGS) {
    assert.ok(f.code.startsWith('MMA'), f.code);
    assert.ok(f.cost > 0, f.code + ' has no price');
  }
  const at = (c) => MMEM_BTO_FITTINGS.find(f => f.code === c).cost;
  assert.equal(at('MMADB8'), 75);
  assert.equal(at('MMAB11'), 65);
  assert.equal(at('MMADY16'), 50);
  assert.equal(at('MMADY14'), 40);
  assert.equal(at('MMADY12'), 35);
});

test('a fitting whose outlets nobody knows can never be selected', () => {
  assert.deepEqual(INCOMPLETE_FITTINGS.map(f => f.code).sort(),
    ['MMAB8', 'MMAB9', 'MMADB6', 'MMADY12', 'MMADY18']);
  assert.deepEqual(SELECTABLE_FITTINGS.map(f => f.code).sort(),
    ['MMAB11', 'MMADB8', 'MMADY14', 'MMADY16']);
  // The DY18 has a known inlet and unknown outlets. Half a specification is
  // not a specification.
  const dy18 = MMEM_BTO_FITTINGS.find(f => f.code === 'MMADY18');
  assert.equal(dy18.inletMm, 450);
  assert.equal(dy18.outletsMm, null);
  assert.equal(isSelectable(dy18), false);
});

test('a configuration key resolves to its inlet and outlets', () => {
  assert.deepEqual(parseConfigKey('bto_400_250_250_250'),
    { inletMm: 400, outletsMm: [250, 250, 250] });
  assert.deepEqual(parseConfigKey('bto_350_250_250'), { inletMm: 350, outletsMm: [250, 250] });
  assert.equal(parseConfigKey('not_a_key'), null);
  assert.equal(parseConfigKey(null), null);
});

test('a part is matched exactly, or not at all', () => {
  assert.equal(findFitting('bto_400_300_300_300')?.code, 'MMADB8');
  assert.equal(findFitting('bto_400_350_250')?.code, 'MMAB11');
  assert.equal(findFitting('bto_400_300_300')?.code, 'MMADY16');
  assert.equal(findFitting('bto_350_250_250')?.code, 'MMADY14');
  // The DY14 covers two outlet sets on one part number.
  assert.equal(findFitting('bto_350_300_300')?.code, 'MMADY14');
  // Order does not matter; the parts do.
  assert.equal(findFitting('bto_400_250_350')?.code, 'MMAB11');

  // And the near misses are misses. A ø400 with three ø250 outlets is NOT a
  // DB8 — the DB8 has three ø300 outlets.
  assert.equal(findFitting('bto_400_250_250_250'), null);
  assert.equal(findFitting('bto_400_300_250'), null);
  assert.equal(findFitting('bto_400_350_350'), null);
  assert.equal(findFitting('bto_350_250_250_250'), null, 'no three-port on a ø350 inlet');
  assert.equal(findFitting('bto_450_300_300'), null, 'the DY18 outlets are unknown');
});

test('a stocked configuration is priced as the part it is', () => {
  const r = resolveBtoPrice('bto_350_250_250', {});
  assert.equal(r.cost, 40);
  assert.equal(r.sku, 'MMADY14');
  assert.equal(r.supplier, 'MMEM');
  assert.equal(r.status, BTO_PRICE_STATUS.VERIFIED);
  assert.equal(priceIsQuotable(r), true, 'a listed part at a listed price is quotable');
  assert.match(r.note, /stocked part, not a fabricated fitting/);
});

test('an unstocked configuration falls to the interim rate, not to a near part', () => {
  const r = resolveBtoPrice('bto_400_250_250_250', {});
  assert.equal(r.cost, BTO_INTERIM_RATE, 'it was priced as a DB8');
  assert.notEqual(r.cost, 75.00 === BTO_INTERIM_RATE ? -1 : 75.00);
  assert.equal(r.sku, null);
  assert.equal(r.status, BTO_PRICE_STATUS.PLACEHOLDER);
  assert.equal(r.interim, true);
});

test('an entered rate still beats the catalogue', () => {
  const rates = { bto_350_250_250: { cost: 38.50, verified: true, quoteRef: 'Q-9' } };
  const r = resolveBtoPrice('bto_350_250_250', { rates });
  assert.equal(r.cost, 38.50);
  assert.equal(r.quoteRef, 'Q-9');
});

test('the catalogue can be switched off without changing anything else', () => {
  const r = resolveBtoPrice('bto_350_250_250', { catalogue: false });
  assert.equal(r.cost, BTO_INTERIM_RATE);
  assert.equal(r.status, BTO_PRICE_STATUS.PLACEHOLDER);
});

test('what the design asks for that MMEM do not make is named, with the alternatives', () => {
  const asked = ['bto_400_250_250_250', 'bto_400_300_250', 'bto_400_350_350',
                 'bto_350_250_250_250', 'bto_350_250_250'];
  const gaps = unstockedConfigurations(asked);
  assert.equal(gaps.length, 4, 'one of the five IS a stocked part');
  assert.ok(!gaps.some(g => g.configKey === 'bto_350_250_250'));
  const four = gaps.find(g => g.configKey === 'bto_400_250_250_250');
  assert.equal(four.inletMm, 400);
  assert.deepEqual(four.outletsMm, [250, 250, 250]);
  // And it says what IS available on that inlet, rather than only what is not.
  assert.ok(four.sameInlet.some(t => /DB8/.test(t)));
  assert.ok(four.sameInlet.some(t => /3 × ø300/.test(t)));
});

test('a part reads the way a schedule prints it', () => {
  assert.equal(describeFitting(findFitting('bto_400_300_300_300')),
    'DB8 double BTO — ø400 inlet / 3 × ø300');
  assert.equal(describeFitting(findFitting('bto_400_350_250')),
    'B11 BTO — ø400 inlet / ø350 + ø250');
  assert.equal(describeFitting(findFitting('bto_350_250_250')),
    'Y4 Y-piece (DY14) — ø350 inlet / 2 × ø250 or 2 × ø300');
  assert.equal(describeFitting(null), null);
});

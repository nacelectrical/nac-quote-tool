// ─────────────────────────────────────────────────────────────────────────────
// THE PRICES SCREEN CAN PRICE EVERYTHING NAC CAN BUY
//
// Nick, 17 October 2026: "You still don't have all 3 phase and single phase
// models in there."
//
// The same list lives in three places, and the reason this went unnoticed is
// that only two of them were ever checked:
//
//   MMEM_DUCTED        NAC's own supplier price list — codes, capacities,
//                      phases and costs, from a document rather than from
//                      somebody typing.
//   DUCTED_CATALOGUE   what the designer starts from. buildCatalogue() already
//                      appends every supplier line this does not cover, which
//                      tests/supplier-pricing proves — so the DESIGNER was
//                      never missing a model.
//   BRANDS (index.html)  the Prices screen. A plain literal in a compiled file
//                      with no imports, so nothing has ever merged the supplier
//                      list into it. This is the one that was short, and it is
//                      the screen an estimator types prices into.
//
// Three-phase under 16 kW had no row to type a price into at all. These tests
// hold the Prices screen to the supplier list so it cannot drift again.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MMEM_DUCTED, codesMatch } from '../designer/engines/supplier-pricing.mjs';
import { readIndexBrands, plan } from '../tools/sync-catalogue.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const BRANDS = readIndexBrands(readFileSync(ROOT + '/index.html', 'utf8'));
const byId = new Map(BRANDS.map(b => [b.id, b]));

const has = (brandId, line) => {
  const b = byId.get(brandId);
  if (!b) return false;
  return b.models.some(m => m.phase === line.phase
    && (codesMatch(m.name, line.code) || (line.model && codesMatch(m.name, line.model))));
};

test('every unit on the supplier price list can be priced on the Prices screen', () => {
  const missing = MMEM_DUCTED.filter(l => !has(l.brandId, l));
  assert.deepEqual(missing.map(l => l.brandId + ' ' + l.code + ' ' + l.phase), [],
    'on the MMEM list and nowhere to price it');
});

test('every brand on the supplier list is a brand on the Prices screen', () => {
  const brands = [...new Set(MMEM_DUCTED.map(l => l.brandId))];
  const absent = brands.filter(b => !byId.has(b));
  assert.deepEqual(absent, [], 'Gree and Panasonic are on NAC’s MMEM account');
});

test('three-phase is quotable below 16 kW', () => {
  // The screen carried three-phase only at 16 kW and above, in any brand. The
  // Daikin Standard Inverter range runs three-phase from 7 kW, and every one
  // of those is on the supplier list.
  const small3 = BRANDS.flatMap(b => b.models
    .filter(m => m.phase === '3Ph' && Number(m.kw) < 16)
    .map(m => b.name + ' ' + m.name + ' ' + m.kw + ' kW'));
  assert.ok(small3.length >= 4, 'three-phase under 16 kW: ' + JSON.stringify(small3));
  assert.ok(small3.some(x => /7(\.0)? kW/.test(x)), 'nothing at 7 kW: ' + JSON.stringify(small3));
});

test('the Kauri job’s own unit is on the Prices screen', () => {
  // FDYAN160AV1 is the unit on the Kauri Crescent job and on the test quote,
  // and it was on the supplier list and nowhere else.
  const daikin = byId.get('daikin');
  assert.ok(daikin.models.some(m => /^FDYAN160AV1\b/.test(m.name) && m.phase === '1Ph'));
  assert.ok(daikin.models.some(m => /^FDYAN160AV1\b/.test(m.name) && m.phase === '3Ph'),
    'the three-phase build of the same indoor unit is a different job');
});

test('the single-phase and three-phase builds of one unit are separate rows', () => {
  // FDYAN160AV1 is sold on a single-phase outdoor (RZA160C2V1) and a
  // three-phase one (RZA160C2Y1). The bare indoor code names two different
  // jobs at two different costs, so one row for both would be wrong.
  const daikin = byId.get('daikin');
  const pair = daikin.models.filter(m => /^FDYAN160AV1\b/.test(m.name));
  assert.equal(pair.length, 2);
  assert.deepEqual(pair.map(m => m.phase).sort(), ['1Ph', '3Ph']);
  assert.notEqual(pair[0].name, pair[1].name, 'two rows with the same name');
});

test('nothing on the Prices screen is a duplicate or carries a price', () => {
  for (const b of BRANDS) {
    const ids = b.models.map(m => m.id);
    assert.equal(new Set(ids).size, ids.length, b.name + ' has a duplicate model id');
    const names = b.models.map(m => m.name);
    assert.equal(new Set(names).size, names.length, b.name + ' has a duplicate model name');
    for (const m of b.models) {
      // Prices are NAC's to enter. A price shipped in the file would be one
      // nobody set, on a quote somebody sends.
      assert.equal(m.price, '', b.name + ' ' + m.name + ' ships with a price');
      assert.ok(/^(1Ph|3Ph|1\/3Ph)$/.test(m.phase), b.name + ' ' + m.name + ': ' + m.phase);
      assert.ok(Number(m.kw) > 0, b.name + ' ' + m.name + ' has no capacity');
    }
  }
});

test('no capacity disagrees with the supplier list by more than rounding', () => {
  // The two sources say slightly different things for eleven units that were
  // on the screen long before this tool existed, and neither is wrong:
  //
  //   screen  the manufacturer's published RATED capacity — 7.1, 12.4, 16.3
  //   MMEM    the NOMINAL size the supplier lists the same unit under — 7, 12,
  //           16. "AC090" is a 9, and its rated figure is 8.5.
  //
  // Nothing here picks one over the other, because a capacity is manufacturer
  // data and not the application's to decide. What this does catch is a figure
  // that drifted on the way in: half a kilowatt is rounding, and anything more
  // is somebody having typed the wrong number.
  const off = [];
  for (const line of MMEM_DUCTED) {
    const b = byId.get(line.brandId);
    if (!b) continue;
    const m = b.models.find(x => x.phase === line.phase
      && (codesMatch(x.name, line.code) || (line.model && codesMatch(x.name, line.model))));
    if (!m) continue;
    if (Math.abs(Number(m.kw) - line.kw) > 0.5) {
      off.push(line.code + ': the screen says ' + m.kw + ' kW, the price list says ' + line.kw);
    }
  }
  assert.deepEqual(off, []);
});

test('the sync tool copies a supplier line without altering it', () => {
  // The rounding above is only ever in rows that predate the tool. What the
  // tool writes, it copies — so this plans against a screen that has the brand
  // and none of the models, and checks the figures come through untouched.
  //
  // Checked on the TOOL rather than on the file, because a name alone cannot
  // tell a row the tool wrote from one that happened to be named the same way:
  // the Braemar rows already carried the supplier's own naming, which is
  // exactly why the tool correctly skips them.
  const bare = 'var BRANDS = [{ id: "daikin", name: "Daikin", models: [] }];';
  const { add } = plan(bare);
  const daikin = add.filter(a => a.brandId === 'daikin');
  assert.ok(daikin.length >= 20, 'planned ' + daikin.length + ' Daikin models');
  for (const a of daikin) {
    assert.equal(a.kw, a.line.kw, a.line.code + ' changed capacity on the way in');
    assert.equal(a.phase, a.line.phase, a.line.code + ' changed phase on the way in');
    assert.ok(a.name.startsWith(a.line.code.split(' / ')[0]),
      a.name + ' does not name the unit it came from');
  }
  // And only brands the screen knows about, or the catalogue can name.
  assert.ok(add.every(a => a.brandName), 'a model planned under no brand name');
});

test('the tool adds nothing twice', () => {
  // Idempotent: planned against the file as it stands, there is nothing left
  // to add. Planning against the designer's catalogue instead made the tool
  // report the same 41 models every run, so a second --write would have
  // written all of them a second time.
  const { add } = plan(readFileSync(ROOT + '/index.html', 'utf8'));
  assert.deepEqual(add.map(a => a.name), []);
});

// ── THE ZONE CONTROLS ──────────────────────────────────────────────────────

import { MMEM_ZONE_CONTROLS } from '../designer/engines/supplier-pricing.mjs';
import { planControllers } from '../tools/sync-catalogue.mjs';

const INDEX = readFileSync(ROOT + '/index.html', 'utf8');
function readControllers(text) {
  const at = text.indexOf('var CONTROLLERS = [');
  let d = 0, s = text.indexOf('[', at), j;
  for (j = s; j < text.length; j++) {
    const c = text[j];
    if (c === '[') d++;
    else if (c === ']') { d--; if (d === 0) break; }
  }
  return JSON.parse(text.slice(s, j + 1)
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,\s*([}\]])/g, '$1'));
}
const CONTROLS = readControllers(INDEX);

test('every zone control NAC buys can be priced', () => {
  // The screen held two rows — "Brand Standard Controller" and "Airtouch 5" —
  // and the supplier list carries nineteen. Nick: "Need to include Siemens
  // zone option for zoning."
  const ids = new Set(CONTROLS.map(c => c.id));
  // The screen's own "at5" row IS the AirTouch kit, and it stays under that
  // id: NAC's saved prices are keyed on it, so renaming it to match MMEM's
  // "at5_daikin" would orphan a price somebody already entered.
  const covered = (c) => ids.has(c.id)
    || (c.id === 'at5_daikin' && ids.has('at5'));
  const missing = MMEM_ZONE_CONTROLS
    .filter(c => !c.perZoneAccessory && !covered(c))
    .map(c => c.name);
  assert.deepEqual(missing, []);
});

test('the AirTouch is one row, not two', () => {
  const airtouch = CONTROLS.filter(c => /airtouch/i.test(c.name));
  assert.equal(airtouch.length, 1, airtouch.map(c => c.name).join(', '));
});

test('the Siemens kits are priceable at all three sizes', () => {
  const kits = CONTROLS.filter(c => /^siemens_/.test(c.id));
  assert.equal(kits.length, 3);
  assert.deepEqual(kits.map(k => k.maxZones).sort((a, b) => a - b), [4, 6, 8]);
  for (const k of kits) assert.equal(k.price, '', 'a price nobody entered');
});

test('a per-zone accessory is not priced as a controller', () => {
  // An AirTouch sensor is bought by the unit against a zone count, not once
  // per job. It belongs on the upgrades list, which prices it per sensor.
  const ids = new Set(CONTROLS.map(c => c.id));
  for (const a of MMEM_ZONE_CONTROLS.filter(c => c.perZoneAccessory)) {
    assert.ok(!ids.has(a.id), a.name + ' is on the controller list');
  }
});

test('the controller sync adds nothing twice', () => {
  assert.deepEqual(planControllers(INDEX).add.map(c => c.id), []);
});

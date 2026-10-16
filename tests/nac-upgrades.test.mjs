// ─────────────────────────────────────────────────────────────────────────────
// THE UPGRADES NAC ACTUALLY SELL
//
// Nick: "make it so airtouch is 1350 and each temp sensor is 100 each all to
// be chosen", then "oh make it $110 then".
//
// Two things this file is here to hold still:
//
//   1. The per-unit fields (unit price, unit label, maximum, default) existed
//      in the engine and had NO screen. A sensor sold by the room could not be
//      set up at all, so the price Nick asked for could not be entered. The
//      Optional upgrades panel now carries them.
//
//   2. The AirTouch kit NAC stock is the Daikin one. Both lines require
//      `daikin_system`, so neither can end up inside a Braemar total — the
//      live pricing bug that was found by opening the page.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normaliseUpgrade, resolveUpgrades } from '../designer/engines/presentation-content.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const DOC = JSON.parse(readFileSync(ROOT + '/designer/content/nac-upgrades.json', 'utf8'));
const DAIKIN = { ducted_system: true, has_zoning: true, has_controller: true, daikin_system: true };
const BRAEMAR = { ducted_system: true, has_zoning: true, has_controller: true, braemar_system: true };

test('the two upgrades carry the prices Nick gave', () => {
  const by = Object.fromEntries(DOC.upgrades.map(u => [u.id, normaliseUpgrade(u)]));
  const at = by['nac-airtouch5'];
  assert.equal(at.priceIncGst, 1350);
  assert.equal(at.unitPriceIncGst, null, 'the AirTouch is one thing or nothing, not a count');

  const s = by['nac-zone-sensor'];
  assert.equal(s.unitPriceIncGst, 110, 'the sensor price Nick corrected to');
  assert.equal(s.priceIncGst, null, 'a per-unit upgrade must carry no flat price');
  assert.equal(s.unitLabel, 'each');
  assert.ok(s.maxQuantity >= 1, 'a counted upgrade with no ceiling is an order form');
  assert.equal(s.defaultQuantity, 0, 'nothing is added to the price until the customer asks');
});

test('both are offered on a Daikin and neither on a Braemar', () => {
  const on = resolveUpgrades(DOC.upgrades, DAIKIN);
  assert.equal(on.offerable.length, 2);
  assert.equal(on.withheld.length, 0);

  const off = resolveUpgrades(DOC.upgrades, BRAEMAR);
  assert.equal(off.offerable.length, 0, 'a Daikin-only upgrade was offered on a Braemar');
  for (const u of off.withheld) assert.match(u.reason, /daikin_system/);
});

test('an un-zoned job is offered neither', () => {
  const r = resolveUpgrades(DOC.upgrades,
    { ducted_system: true, has_controller: true, daikin_system: true });
  assert.equal(r.offerable.length, 0);
});

test('the Optional upgrades panel can set a per-unit price', () => {
  const page = readFileSync(ROOT + '/quote-presentation.html', 'utf8');
  const fn = /function drawUpgrades\(\)[\s\S]*?\n}\n/.exec(page);
  assert.ok(fn, 'drawUpgrades is missing');
  for (const f of ['unitPriceIncGst', 'unitLabel', 'maxQuantity', 'defaultQuantity']) {
    assert.ok(fn[0].includes('u.' + f), 'the upgrades panel cannot set ' + f);
  }
  // Number('') is 0. A cleared price field must not make the upgrade free.
  assert.ok(!/u\.unitPriceIncGst = Number\(/.test(fn[0]),
    'a blank unit price would be read as $0');
  assert.ok(!/u\.priceIncGst = Number\(/.test(fn[0]),
    'a blank flat price would be read as $0');
  assert.match(page, /Import NAC upgrades/);
  assert.match(page, /nac-upgrades\.json/);
});

test('a cleared price field reads as no price, not as free', () => {
  // The same rule the panel's numOrNull enforces, asserted against the engine:
  // an upgrade with neither price is withheld, never offered at nothing.
  const r = resolveUpgrades([{ id: 'x', title: 'Priceless', enabled: true }], DAIKIN);
  assert.equal(r.offerable.length, 0);
  assert.match(r.withheld[0].reason, /No price configured/);
});

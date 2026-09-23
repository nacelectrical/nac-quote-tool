// SENSORS ARE A SEPARATE LINE, AND THE SERIES NAC QUOTE IS THE STANDARD ONE.
//
// Two things went out wrong on a real quote and both are money.
//
// 1. NAC buy the AirTouch as a kit (MMEM MMAAT5DK, $1,100 ex GST) and its
//    temperature sensors on a separate line (MMAAT5S, $92 ex GST each). The
//    sensor line was in the price list and nothing consumed it, so an AirTouch
//    job was quoted with a kit and no sensors at all.
//
//    Nick: "I choose the count per job." So the count is asked for, not
//    assumed. Zero is a real answer. No answer blocks the proposal.
//
// 2. Daikin list two 16 kW single-phase sets — a Premium Inverter at $5,700 and
//    a Standard Inverter at $4,820 — and nothing in the ranking told them
//    apart, so the dearer one won on catalogue order alone.
//
//    Nick: "use standard unless specified."

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoneAccessoryFor, selectEquipment } from '../designer/engines/equipment.mjs';
import { ZONE_CONTROLLERS, ZONE_ACCESSORIES, buildCatalogue } from '../designer/engines/catalogue.mjs';
import { buildBillOfMaterials } from '../designer/engines/bom.mjs';
import { presentationGate, upgradeCapabilities } from '../designer/engines/presentation.mjs';
import { resolveUpgrades } from '../designer/engines/presentation-content.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';

const airtouch = ZONE_CONTROLLERS.find(c => c.id === 'at5_daikin');
const siemens = ZONE_CONTROLLERS.find(c => c.id === 'siemens_z6');

// ── The accessory ────────────────────────────────────────────────────────────

test('the AirTouch kit names the sensor it is bought with', () => {
  assert.deepEqual(airtouch.accessoryIds, ['at5_sensor']);
  const sensor = ZONE_ACCESSORIES.find(a => a.id === 'at5_sensor');
  assert.equal(sensor.code, 'MMAAT5S');
  assert.equal(sensor.cost, 92);
});

test('a controller that takes no sensors is never asked about them', () => {
  assert.equal(zoneAccessoryFor(siemens, ZONE_ACCESSORIES, 6), null);
  assert.equal(zoneAccessoryFor(null, ZONE_ACCESSORIES, 6), null);
});

test('an unanswered sensor count stays unanswered', () => {
  for (const absent of [undefined, null, '']) {
    const a = zoneAccessoryFor(airtouch, ZONE_ACCESSORIES, absent);
    assert.equal(a.quantity, null, 'Number(' + JSON.stringify(absent) + ') became a count');
    assert.equal(a.answered, false);
    assert.equal(a.required, true);
  }
});

test('zero sensors is a real answer', () => {
  const a = zoneAccessoryFor(airtouch, ZONE_ACCESSORIES, 0);
  assert.equal(a.quantity, 0);
  assert.equal(a.answered, true);
});

test('a count is a whole number of sensors', () => {
  assert.equal(zoneAccessoryFor(airtouch, ZONE_ACCESSORIES, 6).quantity, 6);
  assert.equal(zoneAccessoryFor(airtouch, ZONE_ACCESSORIES, '6').quantity, 6);
  assert.equal(zoneAccessoryFor(airtouch, ZONE_ACCESSORIES, 5.4).quantity, 5);
  assert.equal(zoneAccessoryFor(airtouch, ZONE_ACCESSORIES, -2).quantity, null);
  assert.equal(zoneAccessoryFor(airtouch, ZONE_ACCESSORIES, 'six').quantity, null);
});

// ── The bill of materials ────────────────────────────────────────────────────

const bomWith = (zoneAccessory) => buildBillOfMaterials({
  selectedUnit: null, controller: airtouch, zoneAccessory,
  outlets: null, zones: null, network: null
}, { settings: DEFAULT_SETTINGS });

test('the sensors reach the bill of materials at the count that was set', () => {
  const line = bomWith(zoneAccessoryFor(airtouch, ZONE_ACCESSORIES, 6))
    .items.find(i => i.key === 'zone_sensor');
  assert.ok(line, 'no sensor line — an AirTouch job is short by every sensor in it');
  assert.equal(line.quantity, 6);
  assert.equal(line.unitCost, 92);
  assert.equal(line.totalCost, 552);
  assert.equal(line.supplierCode, 'MMAAT5S');
  assert.equal(line.priced, true);
});

test('no sensors, no line — and an unanswered count never invents one', () => {
  for (const count of [0, undefined, null]) {
    const items = bomWith(zoneAccessoryFor(airtouch, ZONE_ACCESSORIES, count)).items;
    assert.equal(items.filter(i => i.key === 'zone_sensor').length, 0,
      'a line appeared for a count of ' + JSON.stringify(count));
  }
  assert.equal(bomWith(null).items.filter(i => i.key === 'zone_sensor').length, 0);
});

// ── The gate ─────────────────────────────────────────────────────────────────

const zonedDesign = (zoneAccessory) => ({
  zones: { zones: [{ id: 'z1' }, { id: 'z2' }] },
  controller: { ...airtouch },
  zoneAccessory
});
const codes = (design) => presentationGate(design, {}).blockers.map(b => b.code);

test('a proposal does not go out with the sensor count unanswered', () => {
  assert.ok(codes(zonedDesign(zoneAccessoryFor(airtouch, ZONE_ACCESSORIES, undefined)))
    .includes('ZONE_SENSOR_COUNT_NOT_SET'));
});

test('an answered count clears it, including zero', () => {
  for (const count of [0, 6]) {
    assert.ok(!codes(zonedDesign(zoneAccessoryFor(airtouch, ZONE_ACCESSORIES, count)))
      .includes('ZONE_SENSOR_COUNT_NOT_SET'), 'still blocked at ' + count);
  }
});

test('a controller with no sensors is never blocked on them', () => {
  const d = { zones: { zones: [{ id: 'z1' }, { id: 'z2' }] }, controller: { ...siemens },
              zoneAccessory: zoneAccessoryFor(siemens, ZONE_ACCESSORIES, undefined) };
  assert.ok(!codes(d).includes('ZONE_SENSOR_COUNT_NOT_SET'));
});

// ── A brand-locked upgrade ───────────────────────────────────────────────────

test('an upgrade that only fits one brand is withheld on the others', () => {
  // The AirTouch kit NAC stock is the Daikin one. On a quote where the customer
  // can also pick a Braemar, offering it against the Braemar would be selling
  // an add-on that cannot be fitted to the system they chose.
  const upgrade = { id: 'at5', title: 'AirTouch 5 smart control', priceIncGst: 1980,
                    requires: ['has_zoning', 'daikin_system'], enabled: true };
  const design = (brandId) => ({
    zones: { zones: [{ id: 'z1' }, { id: 'z2' }] },
    controller: { ...siemens },
    selectedUnit: { brandId, phase: '1Ph' }
  });

  const dk = resolveUpgrades([upgrade], upgradeCapabilities(design('daikin')));
  assert.equal(dk.offerable.length, 1);

  const br = resolveUpgrades([upgrade], upgradeCapabilities(design('braemar')));
  assert.equal(br.offerable.length, 0, 'a Daikin-only upgrade was offered on a Braemar');
  assert.match(br.withheld[0].reason, /daikin_system/);

  assert.equal(upgradeCapabilities(design('braemar')).braemar_system, true);
  assert.equal(upgradeCapabilities(design('braemar')).daikin_system, undefined);
});

// ── Which series NAC quote ───────────────────────────────────────────────────

const pick = (opts) => selectEquipment(buildCatalogue({}), { designKw: 15.8 },
  { phase: '1Ph', brandPreference: 'daikin', settings: DEFAULT_SETTINGS, ...opts })
  .recommended[0];

test('Daikin 16 kW comes through as the Standard Inverter, not the Premium', () => {
  const top = pick({});
  assert.equal(top.series, 'Standard Inverter');
  assert.equal(top.model, 'FDYAN160AV1 / RZA160C2V1');
  assert.equal(top.supplierCost, 4820);
});

test('naming a series on the job overrides the house default', () => {
  const top = pick({ preferredSeries: ['Premium Inverter'] });
  assert.equal(top.series, 'Premium Inverter');
  assert.equal(top.supplierCost, 5700);
});

test('the preference breaks a tie and never moves a size', () => {
  // Preferring a series that only exists at the wrong capacity must not pull
  // the selection off the design load.
  const top = pick({ preferredSeries: ['Dominator Series 2'] });
  assert.ok(Math.abs(top.capacityKw - 15.8) <= 15.8 * 0.25,
    'the series preference moved the selection to ' + top.capacityKw + ' kW');
});

// THE COMPONENT MODEL, THE PRICING GATES AND THE SITE SESSION.
//
// Every one of these is a rule Nick stated in words and every one of them had
// already been broken once: a three-port BTO priced off another three-port BTO,
// a damper bought without a diameter, a manual balancing damper nobody was
// going to install, ø200 on a job approved at ø250. The tests are the record of
// what "one component object" has to mean in practice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApproved } from './fixtures/approved-job.mjs';
import { runPipeline } from '../designer/engines/pipeline.mjs';
import { buildCatalogue } from '../designer/engines/catalogue.mjs';
import { btoConfigKey, btoGroupKey, btoBomLines, btoSpec, labelBtos,
         isReturnSection } from '../designer/engines/bto.mjs';
import { resolveBtoPrice, BTO_PRICE_STATUS } from '../designer/engines/bto-pricing.mjs';
import { buildZoneDampers, damperBomLines, validateZoneDampers,
         DAMPER_DIAMETERS_MM } from '../designer/engines/zone-dampers.mjs';
import { quoteGate, QUOTE_BLOCK } from '../designer/engines/quote-gate.mjs';
import { MATERIAL_CATALOGUE } from '../designer/engines/materials.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';
import { designRulesFor, settingsForDesign } from '../designer/engines/design-rules.mjs';
import { SITE_EDIT, siteEdit, newSiteSession, pushEdit, undo, redo, canUndo, canRedo,
         activeEdits, applySiteEdits, siteEditSummary } from '../designer/engines/site-edit.mjs';
import { saveSessionLocally, loadSessionLocally, clearSessionLocally,
         detectConflict, syncSession, SYNC } from '../designer/engines/site-store.mjs';

const { out: job, design: source, settings } = await buildApproved();
const cat = await buildCatalogue({});
const rerun = (d) => runPipeline(d, { catalogue: cat, settings });

const btoLines = job.bom.items.filter(i => i.key === 'bto_fitting');
const damperLines = job.bom.items.filter(i => i.key === 'zone_motor');
const supplySizes = [...new Set(job.network.sections
  .filter(s => s.role !== 'return').map(s => s.diameterMm))].sort((a, b) => a - b);

// ══ THE APPROVED REFERENCE JOB ═════════════════════════════════════════════

test('the approved reference topology is unchanged', () => {
  assert.equal(job.outlets.totals.total, 10, '10 supply outlets');
  assert.equal(job.selectedUnit.model, 'FDYAN160AV1 / RZA160C2V1');
  assert.equal(job.airflow.allocatedAirflowLs, 799, '799 L/s');
  assert.equal(job.btos.length, 5, 'five supply BTOs');
  assert.deepEqual(job.btos.map(b => b.label), ['BTO-A', 'BTO-B', 'BTO-C', 'BTO-C1', 'BTO-C2']);
  assert.equal(job.network.sections.filter(s => s.role === 'main').length, 3, 'three mains');
  for (const m of job.network.sections.filter(s => s.role === 'main')) {
    assert.equal(m.diameterMm, 400, 'every main is ø400');
  }
  assert.equal(job.returnDesign.returnCount, 2, 'two returns');
});

test('there is no Study outlet and one Family outlet at 121 L/s', () => {
  const rows = job.outlets.rows;
  assert.equal(rows.filter(r => /STUDY/i.test(r.label)).length, 0);
  const family = rows.filter(r => /FAMILY/i.test(r.label));
  assert.equal(family.length, 1);
  assert.equal(family[0].airflowLs, 121);
});

test('no ø200 supply duct appears anywhere on this job', () => {
  // Nick: "Ø200 must not appear anywhere in this particular job's plan,
  // ductwork schedule, BTO schedule, zone-damper schedule, BOM, pricing or
  // report." The job is approved at a ø250 minimum and carries that rule itself.
  assert.ok(!supplySizes.includes(200), 'supply sizes are ' + supplySizes.join(','));
  assert.equal(job.designRules.minimumSupplyBranchDiameterMm, 250);
  for (const b of job.btos) {
    for (const p of b.ports) assert.ok(p.diameterMm >= 250, b.label + ' port ø' + p.diameterMm);
  }
  for (const d of job.zoneDampers) assert.ok(d.diameterMm >= 250);
  for (const i of job.bom.items) {
    if (i.key === 'flex_duct' && i.airSide !== 'return') {
      assert.ok(i.diameterMm !== 200, 'a ø200 flex line is on the order');
    }
  }
});

test('the five rooms Nick named are all on ø250', () => {
  const want = ['foyer', 'master_bedroom', 'bedroom_4', 'bedroom_2', 'bedroom_3'];
  for (const room of want) {
    const sec = job.network.sections.find(s =>
      s.role === 'final' && s.id === 'final_outlet_room_' + room);
    assert.ok(sec, room + ' has no final duct');
    assert.equal(sec.diameterMm, 250, room + ' is ø' + sec.diameterMm);
  }
});

test('a future job that configures ø200 still gets ø200', () => {
  // Nick: "Do not remove Ø200 globally. Enforce the configured per-job minimum."
  const loose = JSON.parse(JSON.stringify(source));
  loose.designRules = { minimumSupplyBranchDiameterMm: 200, minimumBtoToOutletDuctLengthM: 2.0 };
  const eff = settingsForDesign(loose, DEFAULT_SETTINGS);
  assert.equal(eff.duct.minimumSupplyBranchDiameterMm, 200);
  assert.equal(designRulesFor(loose).source.minimumSupplyBranchDiameterMm, 'design');
});

test('the rules travel with the design, not with the application', () => {
  // The bug: the job's ø250 lived in app settings, so the app's own default of
  // 200 resized five rooms whenever nobody set it by hand.
  const rules = designRulesFor({ designRules: { minimumSupplyBranchDiameterMm: 250 } },
                               { duct: { minimumSupplyBranchDiameterMm: 200 } });
  assert.equal(rules.minimumSupplyBranchDiameterMm, 250);
  assert.equal(rules.source.minimumSupplyBranchDiameterMm, 'design');
});

// ══ EXACT BTO SPECIFICATIONS ═══════════════════════════════════════════════

test('every BTO BOM line includes every port diameter', () => {
  for (const line of btoLines) {
    assert.ok(Array.isArray(line.outletDiametersMm) && line.outletDiametersMm.length,
      line.label + ' carries no port diameters');
    for (const d of line.outletDiametersMm) {
      assert.ok(line.configKey.includes(String(d)),
        line.configKey + ' does not name its ø' + d + ' collar');
    }
    assert.ok(/inlet/.test(line.label) && /outlet/.test(line.label),
      'the line does not describe the fitting: ' + line.label);
  }
});

test('the five configuration keys are the ones Nick specified', () => {
  assert.deepEqual(job.btos.map(btoConfigKey), [
    'bto_400_250_250_250', 'bto_400_300_250', 'bto_400_350_350',
    'bto_350_250_250', 'bto_350_250_250_250'
  ]);
  assert.deepEqual(job.btos.map(btoGroupKey), [
    '400|250,250,250', '400|250,300', '400|350,350',
    '350|250,250', '350|250,250,250'
  ]);
});

test('BTO-A and BTO-C2 are never grouped, though both have three ports', () => {
  // Nick, explicitly: "BTO-A and BTO-C2 must never be grouped merely because
  // both have three outlet ports. Their inlet diameters and complete physical
  // configurations are different."
  const a = job.btos.find(b => b.label === 'BTO-A');
  const c2 = job.btos.find(b => b.label === 'BTO-C2');
  assert.equal(a.ports.length, 3);
  assert.equal(c2.ports.length, 3);
  assert.notEqual(btoGroupKey(a), btoGroupKey(c2));
  const lineOf = (id) => btoLines.find(l => l.fittings.includes(id));
  assert.notEqual(lineOf(a.id).groupKey, lineOf(c2.id).groupKey);
  assert.equal(btoLines.length, 5, 'five distinct configurations, five lines');
});

test('identical physical specifications DO share a line, keeping both IDs', () => {
  const twin = [
    { id: 'x1', label: 'BTO-X1', inletDiameterMm: 400, inletAirflowLs: 300,
      ports: [{ index: 1, diameterMm: 250 }, { index: 2, diameterMm: 250 }] },
    { id: 'x2', label: 'BTO-X2', inletDiameterMm: 400, inletAirflowLs: 300,
      ports: [{ index: 1, diameterMm: 250 }, { index: 2, diameterMm: 250 }] }
  ];
  const lines = btoBomLines(twin);
  assert.equal(lines.length, 1, 'the same fitting twice is one order line');
  assert.equal(lines[0].quantity, 2);
  assert.deepEqual(lines[0].fittings, ['x1', 'x2'], 'and both IDs stay on it');
});

test('every schedule entry carries each port airflow and destination', () => {
  const want = {
    'BTO-A': [['KITCHEN', 113], ['MEALS', 67], ['FAMILY', 121]],
    'BTO-B': [['LIVING', 159], ['LOUNGE', 106]],
    'BTO-C1': [['FOYER', 45], ['MASTER BEDROOM', 50]],
    'BTO-C2': [['BEDROOM 4', 48], ['BEDROOM 2', 45], ['BEDROOM 3', 45]]
  };
  for (const [id, expected] of Object.entries(want)) {
    const row = job.schedules.bto.find(r => r.id === id);
    assert.ok(row, id + ' is not on the fabrication schedule');
    assert.equal(row.outletCollarCount, expected.length);
    expected.forEach(([dest, flow], i) => {
      assert.ok(String(row.destinations[i]).toUpperCase().includes(dest),
        id + ' collar ' + (i + 1) + ' serves ' + row.destinations[i] + ', expected ' + dest);
      assert.equal(row.outletAirflowsLs[i], flow);
    });
    assert.equal(row.inletAirflowLs,
      expected.reduce((n, [, f]) => n + f, 0), id + ' inlet must equal its collars');
  }
});

test('a derived body is never described as verified', () => {
  for (const row of job.schedules.bto) {
    assert.equal(row.dimensionsSource, 'derived_from_collars');
    assert.equal(row.dimensionsVerified, false);
    assert.equal(row.fabricationStatus, 'DERIVED — FABRICATION REVIEW REQUIRED');
    assert.ok(row.bodyText, 'but a proposed size IS offered');
  }
});

// ══ BTO PRICING ════════════════════════════════════════════════════════════

test('a missing exact configuration price is PRICE REQUIRED', () => {
  for (const line of btoLines) {
    assert.equal(line.priceStatus, BTO_PRICE_STATUS.REQUIRED, line.configKey);
    assert.equal(line.totalCost, null);
    assert.equal(line.priced, false);
  }
});

test('one configuration is never priced off another', () => {
  const rates = { bto_400_250_250_250: { cost: 142, verified: true, quoteRef: 'Q-1' } };
  assert.equal(resolveBtoPrice('bto_400_250_250_250', { rates }).cost, 142);
  const other = resolveBtoPrice('bto_350_250_250_250', { rates });
  assert.equal(other.cost, null, 'a ø350 three-port borrowed the ø400 three-port price');
  assert.equal(other.status, BTO_PRICE_STATUS.REQUIRED);
});

test('there is no generic BTO rate left to fall back on', () => {
  const entered = { ...source, btoRates: { bto_400_250_250_250: { cost: 142, verified: true } } };
  const priced = rerun(entered);
  const a = priced.bom.items.find(i => i.configKey === 'bto_400_250_250_250');
  const c = priced.bom.items.find(i => i.configKey === 'bto_400_350_350');
  assert.equal(a.unitCost, 142, 'the entered rate is used');
  assert.equal(c.unitCost, null, 'and the others stay unpriced');
});

test('a fabricator quote reference makes a price verified', () => {
  const r = resolveBtoPrice('bto_400_350_350', { rates: {
    bto_400_350_350: { cost: 168, supplier: 'Metal Masters', sku: 'BTO-4-350x2',
                       quoteRef: 'Q-8841', verified: true, effectiveDate: '2026-09-01' } } });
  assert.equal(r.status, BTO_PRICE_STATUS.VERIFIED);
  assert.equal(r.quoteRef, 'Q-8841');
  assert.equal(r.supplier, 'Metal Masters');
});

test('a missing BTO price blocks the customer quote', () => {
  const gate = quoteGate(job);
  assert.equal(gate.ok, false);
  assert.ok(gate.blockers.some(b => b.code === QUOTE_BLOCK.BTO_PRICE_REQUIRED));
  // …and the internal sheet is explicitly NOT blocked by it.
  assert.ok(job.schedules.bto.length, 'the internal schedule is still produced');
});

// ══ MOTORISED ZONE DAMPERS ═════════════════════════════════════════════════

test('zone damper prices differ by diameter', () => {
  const costs = DAMPER_DIAMETERS_MM.map(mm => {
    const [line] = damperBomLines(buildZoneDampers(
      [{ id: 'd', sectionId: 's', zone: 'z' }],
      { sections: [{ id: 's', diameterMm: mm, airflowLs: 100 }] }));
    return line.unitCost;
  });
  assert.equal(new Set(costs).size, costs.length, 'every size has its own price: ' + costs.join(','));
  for (let i = 1; i < costs.length; i++) assert.ok(costs[i] > costs[i - 1], 'and bigger costs more');
});

test('dampers are grouped by exact diameter and actuator', () => {
  const network = { sections: [
    { id: 'a', diameterMm: 250, airflowLs: 45 }, { id: 'b', diameterMm: 250, airflowLs: 48 },
    { id: 'c', diameterMm: 300, airflowLs: 120 } ] };
  const lines = damperBomLines(buildZoneDampers(
    [{ id: 'd1', sectionId: 'a' }, { id: 'd2', sectionId: 'b' }, { id: 'd3', sectionId: 'c' }],
    network));
  assert.equal(lines.length, 2);
  assert.equal(lines.find(l => l.diameterMm === 250).quantity, 2);
  assert.equal(lines.find(l => l.diameterMm === 300).quantity, 1);
  for (const l of lines) assert.ok(/ø\d+/.test(l.label), 'the line must state the diameter: ' + l.label);
});

test('the reference job buys four ø250 motors and nothing generic', () => {
  assert.equal(damperLines.length, 1);
  assert.equal(damperLines[0].diameterMm, 250);
  assert.equal(damperLines[0].quantity, 4);
  assert.equal(damperLines[0].supplierCode, 'MMADZ250');
  assert.equal(damperLines[0].label, 'Motorised zone damper ø250 — 24 V actuator');
  for (const d of job.zoneDampers) assert.ok(d.diameterMm, d.id + ' has no diameter');
});

test('changing a duct diameter changes the damper, its SKU and its price', () => {
  const before = job.zoneDampers.find(d => d.sectionId === 'final_outlet_room_bedroom_2');
  const edited = rerun({ ...source,
    ductDiameterOverrides: { final_outlet_room_bedroom_2: 300 } });
  const after = edited.zoneDampers.find(d => d.sectionId === 'final_outlet_room_bedroom_2');
  assert.equal(before.diameterMm, 250);
  assert.equal(after.diameterMm, 300, 'the damper did not follow the duct');
  assert.notEqual(before.supplierCode, after.supplierCode);
  const line = edited.bom.items.find(i => i.key === 'zone_motor' && i.diameterMm === 300);
  assert.ok(line, 'no ø300 line on the order');
  assert.equal(line.supplierCode, 'MMADZ300');
  assert.notEqual(line.unitCost, damperLines[0].unitCost);
  assert.notEqual(edited.commercials.totalJobCost, job.commercials.totalJobCost);
});

test('a damper that does not match its duct is blocked, not absorbed', () => {
  const bad = rerun({ ...source,
    zoneDamperSizeOverrides: { final_outlet_room_bedroom_2: 300 } });
  const d = bad.zoneDampers.find(x => x.sectionId === 'final_outlet_room_bedroom_2');
  assert.equal(d.sizeMismatch, true);
  assert.equal(d.ductDiameterMm, 250);
  assert.equal(d.diameterMm, 300);
  assert.equal(validateZoneDampers(bad.zoneDampers, { network: bad.network }).ok, false);
  assert.ok(quoteGate(bad).blockers.some(b => b.code === QUOTE_BLOCK.COMPONENT_SIZE_MISMATCH));
});

test('a return duct can carry no damper, no BTO and no manual damper', () => {
  // The return is modelled as its own entities, not as sections of the supply
  // tree — which is the structural reason a supply fitting cannot land on it.
  assert.equal(job.returnDesign.returnCount, 2);
  assert.equal(job.network.sections.filter(s => isReturnSection(s)).length, 0,
    'no return duct is in the supply section tree at all');
  for (const b of job.btos) {
    assert.ok(/^main_|^branch_/.test(b.fedBy), b.label + ' is fed by ' + b.fedBy);
  }
  assert.equal((job.returnComponents?.btos || []).length, 0, 'zero return BTOs');
  // And the damper builder refuses one even when it is asked directly.
  const forced = buildZoneDampers([{ id: 'x', sectionId: 'r1' }],
    { sections: [{ id: 'r1', role: 'return', diameterMm: 400, airflowLs: 400 }] });
  assert.equal(forced.length, 0, 'a damper was built on a return duct');
  const validated = validateZoneDampers(
    [{ id: 'y', sectionId: 'r1', diameterMm: 400 }],
    { network: { sections: [{ id: 'r1', role: 'return' }] } });
  assert.equal(validated.ok, false);
  assert.ok(validated.failures.some(f => f.code === 'DAMPER_ON_RETURN'));
});

// ══ NO MANUAL BALANCING DAMPERS ════════════════════════════════════════════

test('manual balancing dampers do not exist anywhere', () => {
  // Nick: "Remove manual balancing dampers completely" — from design logic,
  // component generation, the catalogue, drawings, legends, schedules, the BOM,
  // costing, pricing, placeholder warnings and both reports.
  assert.equal(MATERIAL_CATALOGUE.damper_manual, undefined, 'still in the catalogue');
  for (const i of job.bom.items) {
    assert.ok(!/manual.*damper|balancing damper/i.test(i.label || ''), i.label);
    assert.notEqual(i.key, 'damper_manual');
  }
  for (const s of job.network.sections) {
    for (const f of (s.fittings || [])) {
      assert.notEqual(f.type, 'damper_open', s.id + ' still emits a manual damper');
    }
  }
  for (const w of (job.warnings || [])) {
    assert.ok(!/manual balancing/i.test(w.message || ''));
  }
});

test('motorised zone control is untouched', () => {
  assert.ok(job.zoneDampers.length >= 1);
  assert.ok(damperLines.length >= 1);
  assert.ok(job.bom.items.some(i => i.key === 'zone_cable'), 'each motor still gets its lead');
});

// ══ THE SITE SESSION ═══════════════════════════════════════════════════════

const anEdit = (over = {}) => siteEdit({
  type: SITE_EDIT.SET_DUCT_DIAMETER, target: 'final_outlet_room_bedroom_2',
  label: 'Bedroom 2 final', before: { diameterMm: 250 }, after: { diameterMm: 300 },
  by: 'Nick', reason: 'ceiling space', ...over });

test('a site edit becomes an override and recalculates everything', () => {
  let s = pushEdit(newSiteSession({ by: 'Nick' }), anEdit());
  const patched = applySiteEdits(source, activeEdits(s));
  assert.equal(patched.ductDiameterOverrides.final_outlet_room_bedroom_2, 300);
  const d = rerun(patched);
  assert.equal(d.zoneDampers.find(x => x.sectionId === 'final_outlet_room_bedroom_2').diameterMm, 300);
});

test('undo and redo move a cursor, they do not lose work', () => {
  let s = pushEdit(newSiteSession(), anEdit());
  s = pushEdit(s, anEdit({ target: 'final_outlet_room_bedroom_3' }));
  assert.equal(activeEdits(s).length, 2);
  s = undo(s);
  assert.equal(activeEdits(s).length, 1);
  assert.equal(s.edits.length, 2, 'the undone edit is still there to redo');
  assert.ok(canRedo(s));
  s = redo(s);
  assert.equal(activeEdits(s).length, 2);
  assert.ok(canUndo(s));
});

test('a new edit after an undo discards the redo branch', () => {
  let s = pushEdit(newSiteSession(), anEdit());
  s = pushEdit(s, anEdit({ target: 'a' }));
  s = undo(s);
  s = pushEdit(s, anEdit({ target: 'b' }));
  assert.equal(s.edits.length, 2);
  assert.equal(canRedo(s), false);
  assert.equal(s.edits[1].target, 'b');
});

test('the as-installed summary is one row per component, first to last', () => {
  let s = pushEdit(newSiteSession(), anEdit({ after: { diameterMm: 300 } }));
  s = pushEdit(s, anEdit({ after: { diameterMm: 350 } }));
  const rows = siteEditSummary(activeEdits(s));
  assert.equal(rows.length, 1, 'two edits to one duct is one change');
  assert.deepEqual(rows[0].before, { diameterMm: 250 });
  assert.deepEqual(rows[0].after, { diameterMm: 350 });
  assert.equal(rows[0].count, 2);
});

test('site edits never touch the design they were opened from', () => {
  const s = pushEdit(newSiteSession(), anEdit());
  const snapshot = JSON.stringify(source);
  applySiteEdits(source, activeEdits(s));
  assert.equal(JSON.stringify(source), snapshot, 'the approved design was mutated');
});

// ══ OFFLINE SAFETY ═════════════════════════════════════════════════════════

function fakeStorage() {
  const map = new Map();
  return { getItem: (k) => map.has(k) ? map.get(k) : null,
           setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k),
           size: () => map.size };
}

test('an edit is on the device before it is anywhere else', () => {
  const storage = fakeStorage();
  const s = pushEdit(newSiteSession(), anEdit());
  const r = saveSessionLocally('D1', s, { storage, baseUpdatedAt: '2026-09-16T00:00:00Z' });
  assert.equal(r.ok, true);
  const back = loadSessionLocally('D1', { storage });
  assert.equal(back.session.edits.length, 1, 'it did not survive a reload');
  assert.equal(back.baseUpdatedAt, '2026-09-16T00:00:00Z');
});

test('storage that refuses is reported, never reported as saved', () => {
  const broken = { getItem: () => null,
                   setItem: () => { throw new Error('QuotaExceeded'); },
                   removeItem: () => {} };
  const r = saveSessionLocally('D1', newSiteSession(), { storage: broken });
  assert.equal(r.ok, false, '"Saved locally" must never be shown for a write that failed');
});

test('a failed sync keeps the work; a successful one clears it', async () => {
  const storage = fakeStorage();
  const s = pushEdit(newSiteSession(), anEdit());
  const { record } = saveSessionLocally('D1', s, { storage });
  const bad = await syncSession('D1', record, () => Promise.reject(new Error('offline')), { storage });
  assert.equal(bad.state, SYNC.FAILED);
  assert.ok(loadSessionLocally('D1', { storage }), 'the edit was thrown away when the signal went');
  const good = await syncSession('D1', record, () => Promise.resolve(true), { storage });
  assert.equal(good.state, SYNC.SYNCED);
  assert.equal(loadSessionLocally('D1', { storage }), null);
});

test('a server revision that moved is a conflict, not an overwrite', () => {
  const record = { baseUpdatedAt: '2026-09-16T10:00:00Z', session: { edits: [1, 2] } };
  const c = detectConflict(record, '2026-09-16T12:00:00Z');
  assert.equal(c.conflict, true);
  assert.ok(/local edit\(s\) are safe/.test(c.message));
  assert.equal(detectConflict(record, '2026-09-16T09:00:00Z').conflict, false);
});

test('corrupt local data reads as absent rather than throwing', () => {
  const storage = fakeStorage();
  storage.setItem('nac_site_session_D1', '{not json');
  assert.equal(loadSessionLocally('D1', { storage }), null);
  clearSessionLocally('D1', { storage });
});

// ══ THE OUTPUTS AGREE ══════════════════════════════════════════════════════

test('the drawing, the schedules, the BOM and the reports use one object', () => {
  // Same names, same count, same configurations, everywhere.
  const fromComponents = job.btos.map(b => b.label).sort();
  const fromSchedule = job.schedules.bto.map(r => r.id).sort();
  const fromBom = btoLines.flatMap(l => l.fittings)
    .map(id => job.btos.find(b => b.id === id).label).sort();
  assert.deepEqual(fromSchedule, fromComponents);
  assert.deepEqual(fromBom, fromComponents);
  const specKeys = job.btos.map(b => btoSpec(b).configKey).sort();
  assert.deepEqual(job.schedules.bto.map(r => r.configKey).sort(), specKeys);
  assert.deepEqual(btoLines.map(l => l.configKey).sort(), specKeys);

  const damperIds = job.zoneDampers.map(d => d.id).sort();
  assert.deepEqual(job.schedules.zoneDampers.map(r => r.componentId).sort(), damperIds);
  assert.deepEqual(damperLines.flatMap(l => l.dampers).sort(), damperIds);
});

test('the BTO name is on the component, not worked out per surface', () => {
  const relabelled = labelBtos(job.btos.map(b => ({ ...b, label: 'x' })), job.network);
  assert.deepEqual(relabelled.map(b => b.label),
    ['BTO-A', 'BTO-B', 'BTO-C', 'BTO-C1', 'BTO-C2']);
});

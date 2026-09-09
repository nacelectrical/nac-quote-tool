// PART 35 — the plans that actually cause trouble: blurry screenshots, several
// dimension rows, missing room dimensions, odd scales, resized exports, wall
// thicknesses and window widths mixed into the chain, unusual and open-plan
// rooms, long duct routes.
import test from 'node:test';
import assert from 'node:assert/strict';

import { interpretPlan, measureRooms } from '../designer/engines/interpret.mjs';
import { buildDetectedDimensions, classifyAll } from '../designer/engines/dimensions.mjs';
import { groupChains, reconstructChain } from '../designer/engines/chains.mjs';
import { calibrate } from '../designer/engines/calibration.mjs';
import { verifyRoom, sizableRooms, blockedRooms, applyRoomOverride } from '../designer/engines/rooms.mjs';
import { sizeSection } from '../designer/engines/ducts.mjs';
import { systemLoad } from '../designer/engines/loads.mjs';
import { runPipeline } from '../designer/engines/pipeline.mjs';
import { createDesign } from '../designer/engines/model.mjs';
import { buildCatalogue } from '../designer/engines/catalogue.mjs';
import { DEFAULT_SETTINGS } from '../designer/engines/settings.mjs';

/** Lay a chain out as detections along an axis at a given pixel scale. */
function chainDetections(prefix, segments, { orientation = 'horizontal', row = 1, pxPerMm = 0.06 } = {}) {
  const out = [];
  let acc = 0;
  segments.forEach((seg, i) => {
    const c = (acc + seg / 2) * pxPerMm;
    out.push({
      id: prefix + (i + 1), text: String(seg), orientation, row,
      box: orientation === 'horizontal'
        ? { x: 100 + c, y: 60 + row * 30, w: 20, h: 10 }
        : { x: 60 + row * 30, y: 100 + c, w: 10, h: 20 }
    });
    acc += seg;
  });
  return out;
}

// ── Clear plan ──────────────────────────────────────────────────────────────

test('clear plan: chains close and rooms come out at HIGH confidence', () => {
  const dets = [
    { id: 'ho', text: '12000', orientation: 'horizontal', row: 0, box: { x: 400, y: 30, w: 40, h: 10 } },
    ...chainDetections('h', [110, 3600, 90, 3400, 90, 4600, 110]),
    { id: 'vo', text: '9000', orientation: 'vertical', row: 0, box: { x: 30, y: 400, w: 10, h: 40 } },
    ...chainDetections('v', [110, 4200, 90, 4490, 110], { orientation: 'vertical' })
  ];
  const interp = interpretPlan({ rawDetections: dets, overallWidthMm: 12000 });
  assert.equal(interp.primaryHorizontalChain.closure.closes, true);
  assert.equal(interp.primaryVerticalChain.closure.closes, true);

  const rooms = measureRooms([{ label: 'Bed 2', hStations: [1, 2], vStations: [1, 2] }], {
    hChain: interp.primaryHorizontalChain, vChain: interp.primaryVerticalChain
  });
  assert.equal(rooms[0].widthMm, 3600);
  assert.equal(rooms[0].lengthMm, 4200);
  assert.equal(rooms[0].confidenceBand, 'HIGH');
});

// ── Blurry screenshot ───────────────────────────────────────────────────────

test('blurry screenshot: no chain readable, so rooms fall back to calibrated pixels at LOW confidence', () => {
  // OCR only managed the room labels and a couple of garbled strings.
  const interp = interpretPlan({ rawDetections: [
    { id: 'x1', text: 'BED 2', orientation: 'horizontal', box: { x: 200, y: 300, w: 40, h: 10 } },
    { id: 'x2', text: '34OO', orientation: 'horizontal', box: { x: 200, y: 330, w: 30, h: 10 } }  // O for 0
  ]});
  assert.equal(interp.primaryHorizontalChain, null);
  assert.equal(interp.summary.lengthCount, 0);

  const cal = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 90, y: 0 }, knownDistance: 6000 });
  const rooms = measureRooms([{ label: 'Bed 2', boundaryPx: { x: 200, y: 300, w: 48, h: 46 } }],
    { calibration: cal }, { imageQuality: 'low' });

  assert.equal(rooms[0].measurement.source, 'calibrated_geometry');
  assert.equal(rooms[0].confidenceBand, 'LOW');
  assert.equal(rooms[0].requiresVerification, true);
  assert.equal(sizableRooms(rooms).length, 0, 'a LOW-confidence room must not reach the sizing engine');
});

test('blurry screenshot: the estimator types the dimension and the room is usable again', () => {
  const cal = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 90, y: 0 }, knownDistance: 6000 });
  const [room] = measureRooms([{ label: 'Bed 2', boundaryPx: { x: 200, y: 300, w: 48, h: 46 } }],
    { calibration: cal }, { imageQuality: 'low' });
  const fixed = applyRoomOverride(room, { widthMm: 3200, lengthMm: 3400 }, 'nick');
  assert.equal(fixed.confidence, 100);
  assert.equal(fixed.status, 'Manual');
  assert.equal(sizableRooms([fixed]).length, 1);
});

// ── Multiple dimension rows ─────────────────────────────────────────────────

test('multiple dimension rows: each row becomes its own chain and only full rows are closed', () => {
  const dets = [
    { id: 'ho', text: '12000', orientation: 'horizontal', row: 0, box: { x: 400, y: 30, w: 40, h: 10 } },
    ...chainDetections('h', [110, 3600, 90, 3400, 90, 4600, 110], { row: 1 }),
    // A second, coarser setting-out row on the same elevation.
    ...chainDetections('g', [3710, 3490, 4800], { row: 2 }),
    // A short opening row that spans only part of the building.
    ...chainDetections('o', [1800, 820], { row: 3 })
  ];
  const chains = groupChains(buildDetectedDimensions(dets));
  const full = chains.filter(c => c.segments.length > 1 && c.closure?.closes === true);
  const partial = chains.filter(c => c.closure?.partial);

  assert.equal(full.length, 2, 'both full-width rows should close on 12000');
  assert.equal(partial.length, 1, 'the opening row is partial, not broken');
  assert.ok(partial[0].confidence < full[0].confidence);
});

test('multiple dimension rows: the primary chain is the one that closes', () => {
  const interp = interpretPlan({ rawDetections: [
    { id: 'ho', text: '12000', orientation: 'horizontal', row: 0, box: { x: 400, y: 30, w: 40, h: 10 } },
    ...chainDetections('h', [110, 3600, 90, 3400, 90, 4600, 110], { row: 1 }),
    ...chainDetections('o', [1800, 820, 2400], { row: 3 })
  ], overallWidthMm: 12000 });
  assert.equal(interp.primaryHorizontalChain.closure.closes, true);
  assert.equal(interp.primaryHorizontalChain.totalMm, 12000);
});

// ── Wall thicknesses and windows mixed into the chain ───────────────────────

test('wall thicknesses inside the chain are identified and never used as rooms', () => {
  const interp = interpretPlan({ rawDetections: [
    { id: 'ho', text: '12000', orientation: 'horizontal', row: 0, box: { x: 400, y: 30, w: 40, h: 10 } },
    ...chainDetections('h', [110, 3600, 90, 3400, 90, 4600, 110])
  ], overallWidthMm: 12000 });

  const walls = interp.detectedDimensions.filter(d => d.classification === 'wall_thickness');
  assert.equal(walls.length, 4);                       // 110, 90, 90, 110
  assert.ok(walls.every(w => w.mm <= 110));
  const rooms = interp.detectedDimensions.filter(d => d.classification === 'internal_wall_dimension');
  assert.deepEqual(rooms.map(r => r.mm).sort((a, b) => a - b), [3400, 3600, 4600]);
});

test('window widths mixed into a chain are separated by their symbol', () => {
  const dets = buildDetectedDimensions([
    { id: 'w', text: '1800', orientation: 'horizontal', row: 2, box: { x: 200, y: 200, w: 24, h: 10 } },
    { id: 'r', text: '3400', orientation: 'horizontal', row: 2, box: { x: 400, y: 200, w: 24, h: 10 } }
  ]);
  const classified = classifyAll(dets, {
    openings: [{ id: 'o', type: 'window', box: { x: 160, y: 198, w: 110, h: 12 } }]
  });
  assert.equal(classified.find(d => d.id === 'w').classification, 'window_width');
  assert.equal(classified.find(d => d.id === 'r').classification, 'internal_wall_dimension');
});

// ── Missing room dimensions ─────────────────────────────────────────────────

test('a room with no measurable source is blocked and flagged for the estimator', () => {
  const [room] = measureRooms([{ label: 'Rumpus' }], {});
  assert.equal(room.measurement.source, 'estimated');
  assert.equal(room.areaSqM, null);
  assert.equal(room.measurement.needsEstimatorInput, true);
  assert.equal(blockedRooms([room]).length, 1);
});

test('the estimator is never blocked: a manual area alone completes the room', () => {
  const [room] = measureRooms([{ label: 'Rumpus', areaSqM: 18.5, widthMm: 5000, lengthMm: 3700 }], {});
  assert.equal(room.measurement.source, 'manual');
  assert.equal(room.areaSqM, 18.5);
  assert.equal(sizableRooms([room]).length, 1);
});

// ── Different scales and resized plans ──────────────────────────────────────

test('different drawing scales give different px/mm but identical room dimensions', () => {
  const at100 = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6000 });
  const at200 = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 300, y: 0 }, knownDistance: 6000 });
  const room100 = measureRooms([{ label: 'Bed', boundaryPx: { x: 0, y: 0, w: 320, h: 340 } }], { calibration: at100 })[0];
  const room200 = measureRooms([{ label: 'Bed', boundaryPx: { x: 0, y: 0, w: 160, h: 170 } }], { calibration: at200 })[0];
  assert.equal(room100.widthMm, room200.widthMm);
  assert.equal(room100.areaSqM, room200.areaSqM);
});

test('a resized export invalidates px/mm but never the reconstructed chain', () => {
  const full = chainDetections('h', [110, 3600, 90, 3400], { pxPerMm: 0.12 });
  const half = chainDetections('h', [110, 3600, 90, 3400], { pxPerMm: 0.06 });
  const a = groupChains(buildDetectedDimensions(full)).find(c => c.segments.length === 4);
  const b = groupChains(buildDetectedDimensions(half)).find(c => c.segments.length === 4);
  assert.deepEqual(a.stations, b.stations);
  assert.equal(a.totalMm, b.totalMm);
});

test('a plan in metres is normalised to the same millimetre stations', () => {
  const mm = reconstructChain([110, 3600, 90, 3400]);
  const metres = buildDetectedDimensions([
    { id: 'a', text: '0.11', orientation: 'horizontal', row: 1, box: { x: 100, y: 90, w: 20, h: 10 } },
    { id: 'b', text: '3.6',  orientation: 'horizontal', row: 1, box: { x: 200, y: 90, w: 20, h: 10 } },
    { id: 'c', text: '0.09', orientation: 'horizontal', row: 1, box: { x: 300, y: 90, w: 20, h: 10 } },
    { id: 'd', text: '3.4',  orientation: 'horizontal', row: 1, box: { x: 400, y: 90, w: 20, h: 10 } }
  ]);
  const chain = groupChains(metres).find(c => c.segments.length === 4);
  assert.deepEqual(chain.stations, mm.stations);
});

// ── Unusual and open-plan rooms ─────────────────────────────────────────────

test('an open-plan area can be treated as one room or as grouped rooms', () => {
  const single = measureRooms([{ label: 'Living / Dining / Kitchen', widthMm: 9000, lengthMm: 6000 }], {})[0];
  assert.equal(single.areaSqM, 54);

  const grouped = measureRooms([
    { label: 'Living',  widthMm: 5640, lengthMm: 3600, openPlanGroup: 'core' },
    { label: 'Dining',  widthMm: 3200, lengthMm: 4160, openPlanGroup: 'core' },
    { label: 'Kitchen', widthMm: 3200, lengthMm: 3600, openPlanGroup: 'core' }
  ], {}).map(r => verifyRoom(r));
  assert.ok(grouped.every(r => r.openPlanGroup === 'core'));

  // Grouping applies the open-plan diversity, so it must not exceed the
  // undiversified single-room figure for the same area.
  const groupedLoad = systemLoad(grouped);
  assert.ok(groupedLoad.rawCoolingW > 0);
});

test('a long narrow room is measured, flagged and still usable', () => {
  const [hall] = measureRooms([{ label: 'Hall', widthMm: 12000, lengthMm: 1200 }], {});
  assert.equal(hall.areaSqM, 14.4);
  assert.equal(hall.confidence, 100);                   // manual entry is trusted
  const [detected] = measureRooms([{ label: 'Hall', hStations: [0, 1], vStations: [0, 1] }], {
    hChain: { ...reconstructChain([12000]), id: 'h', orientation: 'horizontal', confidence: 90, closure: { closes: true } },
    vChain: { ...reconstructChain([1200]),  id: 'v', orientation: 'vertical',   confidence: 90, closure: { closes: true } }
  });
  assert.ok(detected.confidenceFactors.some(f => /elongated/i.test(f.reason)));
});

// ── Long duct routes ────────────────────────────────────────────────────────

test('a long duct route is sized, flagged and drives a real pressure drop', () => {
  const short = sizeSection({ id: 'a', role: 'branch', destination: 'Bed 2', airflowLs: 100, lengthMm: 5000 });
  const long = sizeSection({ id: 'b', role: 'branch', destination: 'Bed 5', airflowLs: 100, lengthMm: 22000 });
  assert.equal(short.diameterMm, long.diameterMm, 'diameter follows airflow, not length');
  assert.ok(long.pressureDropPa > short.pressureDropPa * 3);
  assert.ok(long.warnings.some(w => w.code === 'LONG_DUCT_RUN'));
  assert.ok(!short.warnings.some(w => w.code === 'LONG_DUCT_RUN'));
});

// ── The whole pipeline under bad inputs ─────────────────────────────────────

test('the pipeline never produces a design from unverified rooms', () => {
  const cal = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6000 });
  const rooms = measureRooms([
    { label: 'Bed 2', boundaryPx: { x: 0, y: 0, w: 320, h: 340 } },
    { label: 'Living', boundaryPx: { x: 0, y: 0, w: 560, h: 360 } }
  ], { calibration: cal }, { imageQuality: 'low' });

  let design = createDesign({ customer: { name: 'Test' } });
  design.calibration = cal;
  design.rooms = rooms;
  design = runPipeline(design, { settings: DEFAULT_SETTINGS, catalogue: buildCatalogue({}) });

  assert.equal(design.stage, 'awaiting_room_verification');
  assert.equal(design.selectedUnit, null);
  assert.equal(design.commercials, null);
  assert.ok(design.warnings.some(w => w.code === 'LOW_ROOM_MEASUREMENT_CONFIDENCE'));
  assert.equal(design.warningSummary.canApprove, false);
});

test('an explicit estimator override lets a low-confidence room through, on the record', () => {
  const cal = calibrate({ pointA: { x: 0, y: 0 }, pointB: { x: 600, y: 0 }, knownDistance: 6000 });
  const rooms = measureRooms([{ label: 'Bed 2', boundaryPx: { x: 0, y: 0, w: 320, h: 340 } }],
    { calibration: cal }, { imageQuality: 'low' })
    .map(r => ({ ...r, overrideApproved: true, overrideApprovedBy: 'nick' }));

  let design = createDesign({ customer: { name: 'Test' } });
  design.calibration = cal;
  design.rooms = rooms;
  design = runPipeline(design, { catalogue: buildCatalogue({}), allowLowConfidence: true });

  assert.equal(design.stage, 'complete');
  assert.ok(design.systemLoad.totalConditionedAreaSqM > 0);
  // The warning stays on the record even though the design proceeded.
  assert.ok(design.warnings.some(w => w.code === 'LOW_ROOM_MEASUREMENT_CONFIDENCE'));
});

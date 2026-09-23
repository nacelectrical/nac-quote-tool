// WHAT A FINGER ON THE PLAN ACTUALLY CHANGES.
//
// Nick: "Do not mark any of these complete until they can be performed through
// visible iPad controls." The controls are demonstrated with real touch events
// in tools/browser-tests; these are the checks underneath them — that each
// recorded edit lands in the record the PIPELINE reads, rather than in an
// override object nothing consumes.
//
// That was the actual fault. Site edits were being written to `routeOverrides`,
// `returnOverrides` and `outletOverrides.x/y`, none of which any engine reads,
// so the screen redrew and the next recalculation threw the change away.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE_EDIT, siteEdit, applySiteEdits, newSiteSession, pushEdit,
         activeEdits, undo, redo } from '../designer/engines/site-edit.mjs';
import { applyBtoOverrides, makeBto, withBody, btoSpec } from '../designer/engines/bto.mjs';
import { applyDamperPlacements } from '../designer/engines/zone-dampers.mjs';
import { routeCorners } from '../designer/ui/site-adjust.mjs';

const E = (type, target, after, before = null) =>
  siteEdit({ type, target, after, before, by: 'Nick', at: '2026-09-17T01:00:00.000Z' });
const fold = (design, ...edits) => applySiteEdits(design, edits);

// ── Route simplification: handles a finger can tell apart ──────────────────

test('a swept run keeps its corners and drops its tessellation', () => {
  // A straight line of eleven points is two handles; a right angle is three.
  const straight = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0 }));
  assert.equal(routeCorners(straight).length, 2);
  const bent = [...Array.from({ length: 6 }, (_, i) => ({ x: i * 10, y: 0 })),
                ...Array.from({ length: 6 }, (_, i) => ({ x: 50, y: (i + 1) * 10 }))];
  const c = routeCorners(bent);
  assert.equal(c.length, 3);
  assert.deepEqual(c[0], { x: 0, y: 0 });
  assert.deepEqual(c[1], { x: 50, y: 0 });
  assert.deepEqual(c[2], { x: 50, y: 60 });
});

test('a two-point run is left alone', () => {
  assert.equal(routeCorners([{ x: 0, y: 0 }, { x: 9, y: 9 }]).length, 2);
  assert.equal(routeCorners([]).length, 0);
});

// ── Every edit reaches a record the pipeline reads ─────────────────────────

test('moving an outlet writes the layout key the routers read', () => {
  const d = fold({ layout: {} },
    E(SITE_EDIT.MOVE_OUTLET, 'room_kitchen', { x: 120, y: 240, index: 0 }));
  assert.deepEqual(d.layout.outlet_room_kitchen_0, { x: 120, y: 240 });
});

test('the second outlet of a room moves under its own key', () => {
  const d = fold({ layout: {} },
    E(SITE_EDIT.MOVE_OUTLET, 'room_living', { x: 10, y: 20, index: 1 }));
  assert.deepEqual(d.layout.outlet_room_living_1, { x: 10, y: 20 });
  assert.equal(d.layout.outlet_room_living_0, undefined);
});

test('adding an outlet raises the room quantity and places it', () => {
  const d = fold({ layout: {}, outletOverrides: {} },
    E(SITE_EDIT.ADD_OUTLET, 'room_lounge', { quantity: 2, index: 1, x: 50, y: 60 }));
  assert.equal(d.outletOverrides.room_lounge.quantity, 2);
  assert.equal(d.outletOverrides.room_lounge.addedOnSite, true);
  assert.deepEqual(d.layout.outlet_room_lounge_1, { x: 50, y: 60 });
});

test('removing the middle outlet closes the gap in the positions', () => {
  const base = { outletOverrides: {}, layout: {
    outlet_r_0: { x: 1, y: 1 }, outlet_r_1: { x: 2, y: 2 }, outlet_r_2: { x: 3, y: 3 } } };
  const d = fold(base, E(SITE_EDIT.REMOVE_OUTLET, 'r', { quantity: 2, index: 1 }));
  assert.equal(d.outletOverrides.r.quantity, 2);
  assert.deepEqual(d.layout.outlet_r_0, { x: 1, y: 1 });
  assert.deepEqual(d.layout.outlet_r_1, { x: 3, y: 3 }, 'the third moved down to second');
  assert.equal(d.layout.outlet_r_2, undefined, 'and nothing is orphaned above it');
});

test('a route edit writes routeEdits, which is what re-applies geometry', () => {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 5 }, { x: 20, y: 5 }];
  const d = fold({}, E(SITE_EDIT.SET_ROUTE, 'final_outlet_room_kitchen', { points: pts }));
  assert.deepEqual(d.routeEdits.final_outlet_room_kitchen.points, pts);
  assert.equal(d.routeEdits.final_outlet_room_kitchen.by, 'Nick');
  assert.equal(d.routeEdits.final_outlet_room_kitchen.at, '2026-09-17T01:00:00.000Z');
});

test('locking a route stores its POINTS, not just its name', () => {
  const pts = [{ x: 1, y: 1 }, { x: 2, y: 2 }];
  let d = fold({}, E(SITE_EDIT.LOCK_ROUTE, 'main_A', { points: pts }));
  // A bare list of ids is what it used to be, and applyLockedGeometry reads
  // `locked[id].points` — so a list held the route in place not at all.
  assert.equal(Array.isArray(d.lockedRoutes), false);
  assert.deepEqual(d.lockedRoutes.main_A.points, pts);
  assert.equal(d.lockedRoutes.main_A.by, 'Nick');
  d = fold(d, E(SITE_EDIT.UNLOCK_ROUTE, 'main_A', { unlocked: true }));
  assert.equal('main_A' in d.lockedRoutes, false);
});

test('moving a return grille moves the layout key its duct is designed from', () => {
  const d = fold({ layout: { returnGrille_2: { x: 1, y: 1 } } },
    E(SITE_EDIT.MOVE_RETURN, 'returnGrille_2', { x: 300, y: 400 }));
  assert.deepEqual(d.layout.returnGrille_2, { x: 300, y: 400 });
});

test('adding and removing a return changes the count the designer reads', () => {
  let d = fold({ layout: { returnGrille: { x: 1, y: 1 } }, returnCount: 1,
                 returnGrilleOverrides: [[600, 400]] },
    E(SITE_EDIT.ADD_RETURN, 'returnGrille_2', { count: 2, x: 9, y: 9 }));
  assert.equal(d.returnCount, 2);
  assert.deepEqual(d.layout.returnGrille_2, { x: 9, y: 9 });
  assert.equal(d.returnGrilleOverrides.length, 2);
  d = fold(d, E(SITE_EDIT.REMOVE_RETURN, 'returnGrille_2', { count: 1 }));
  assert.equal(d.returnCount, 1);
  assert.equal(d.layout.returnGrille_2, undefined);
  assert.equal(d.returnGrilleOverrides.length, 1);
});

test('rotating the fan coil records an angle the assembly can be drawn at', () => {
  const d = fold({ layout: {} }, E(SITE_EDIT.SET_FCU_ORIENTATION, 'indoorUnit', { angle: 90 }));
  assert.equal(d.layout.fanCoilAngle, 90);
});

test('a note and a photo land on the record, against what was selected', () => {
  const d = fold({}, E(SITE_EDIT.ADD_NOTE, 'bto:bto_3', { text: 'Batten in the way.' }),
                     E(SITE_EDIT.ADD_PHOTO, 'job', { dataUrl: 'data:image/jpeg;base64,AAA',
                                                     caption: 'Above the Family outlet' }));
  assert.equal(d.siteNotes.length, 1);
  assert.equal(d.siteNotes[0].target, 'bto:bto_3');
  assert.equal(d.sitePhotos.length, 1);
  assert.match(d.sitePhotos[0].dataUrl, /^data:image\//);
});

// ── BTO overrides, applied to the fitting the pipeline derived ─────────────

const fitting = (id, inlet, outs) => makeBto({
  id, index: 1, position: { x: 100, y: 100 }, inletDiameterMm: inlet, inletAirflowLs: 300,
  fedBy: 'Main A', label: id,
  ports: outs.map((mm, i) => ({ sectionId: 's' + i, diameterMm: mm, airflowLs: 50,
                                servesOutletId: 'o' + i, servesLabel: 'ROOM ' + (i + 1) })) });

test('a removed port goes by INDEX, and the rest renumber', () => {
  const [b] = applyBtoOverrides([fitting('bto_1', 400, [250, 300, 250])],
    { bto_1: { removedPortIndexes: [2] } });
  assert.equal(b.ports.length, 2);
  assert.deepEqual(b.ports.map(p => p.index), [1, 2]);
  assert.deepEqual(b.ports.map(p => p.diameterMm), [250, 250],
    'the ø300 at index 2 is the one that went');
});

test('an added port is honestly unconnected and carries no air', () => {
  const [b] = applyBtoOverrides([fitting('bto_1', 400, [250])],
    { bto_1: { addedPorts: [{ diameterMm: 300 }] } });
  assert.equal(b.ports.length, 2);
  assert.equal(b.ports[1].diameterMm, 300);
  assert.equal(b.ports[1].airflowLs, 0);
  assert.equal(b.ports[1].servesOutletId, null);
  assert.equal(b.ports[1].addedOnSite, true);
  assert.equal(btoSpec(withBody(b)).ports[1].destination, null);
});

test('a port size and a port destination are applied to the right collar', () => {
  const [b] = applyBtoOverrides([fitting('bto_1', 400, [250, 250])],
    { bto_1: { portDiametersMm: { 2: 300 },
               portDestinations: { 1: 'room_study' },
               portDestinationLabels: { 1: 'STUDY' } } });
  assert.deepEqual(b.ports.map(p => p.diameterMm), [250, 300]);
  assert.equal(b.ports[0].servesOutletId, 'room_study');
  assert.equal(b.ports[0].servesLabel, 'STUDY');
  assert.equal(b.ports[0].reconnectedOnSite, true);
});

test('a fitting added on site appears with the duct’s inlet and no collars', () => {
  const network = { sections: [{ id: 'main_B', diameterMm: 400, airflowLs: 265,
                                 points: [{ x: 0, y: 0 }, { x: 50, y: 0 }] }] };
  const out = applyBtoOverrides([], { bto_site_main_B: {
    added: true, sectionId: 'main_B', label: 'BTO-S1', x: 25, y: 0 } }, network);
  assert.equal(out.length, 1);
  assert.equal(out[0].inletDiameterMm, 400);
  assert.equal(out[0].inletAirflowLs, 265);
  assert.equal(out[0].ports.length, 0);
  assert.equal(out[0].addedOnSite, true);
});

test('a deleted fitting is gone from the derived set', () => {
  const out = applyBtoOverrides([fitting('bto_1', 400, [250]), fitting('bto_2', 400, [250])],
    { bto_1: { removed: true } });
  assert.deepEqual(out.map(b => b.id), ['bto_2']);
});

// ── Damper placements ─────────────────────────────────────────────────────

const placements = () => ([
  { id: 'damper_a', sectionId: 'final_a', zone: 'BED 1', x: 10, y: 10 },
  { id: 'damper_b', sectionId: 'final_b', zone: 'BED 2', x: 20, y: 20 }
]);

test('a damper can be moved, reassigned and deleted on site', () => {
  const moved = applyDamperPlacements(placements(), { damper_a: { x: 99, y: 98 } });
  assert.equal(moved[0].x, 99);
  assert.equal(moved[0].moved, true);
  const zoned = applyDamperPlacements(placements(), { damper_b: { zone: 'BED 4' } });
  assert.equal(zoned[1].zone, 'BED 4');
  assert.equal(zoned[1].zoneChangedOnSite, true);
  const gone = applyDamperPlacements(placements(), { damper_a: { removed: true } });
  assert.deepEqual(gone.map(p => p.id), ['damper_b']);
  assert.equal(gone[0].motorNumber, 1, 'the motors renumber');
});

test('a damper added on site lands on the duct it was tapped on', () => {
  const network = { sections: [{ id: 'final_c', diameterMm: 250, airflowLs: 45,
                                 points: [{ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 8, y: 8 }] }] };
  const out = applyDamperPlacements(placements(),
    { damper_final_c: { added: true, sectionId: 'final_c', zone: 'BED 3' } }, network);
  assert.equal(out.length, 3);
  assert.equal(out[2].sectionId, 'final_c');
  assert.equal(out[2].addedOnSite, true);
  assert.deepEqual({ x: out[2].x, y: out[2].y }, { x: 4, y: 4 }, 'halfway along the run');
});

test('a damper can NEVER be added to a return duct, however it is asked for', () => {
  const network = { sections: [{ id: 'return_1', role: 'return', diameterMm: 400,
                                 points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] }] };
  const out = applyDamperPlacements([], { d1: { added: true, sectionId: 'return_1' } }, network);
  assert.deepEqual(out, []);
});

// ── Undo and redo are a cursor, so every edit type undoes the same way ─────

test('undo and redo work for an edit type that writes several records', () => {
  let s = newSiteSession({ by: 'Nick' });
  s = pushEdit(s, E(SITE_EDIT.ADD_RETURN, 'returnGrille_2', { count: 2, x: 1, y: 2 }));
  const base = { layout: { returnGrille: { x: 0, y: 0 } }, returnCount: 1,
                 returnGrilleOverrides: [[600, 400]] };
  assert.equal(applySiteEdits(base, activeEdits(s)).returnCount, 2);
  s = undo(s);
  assert.equal(applySiteEdits(base, activeEdits(s)).returnCount, 1);
  assert.equal(applySiteEdits(base, activeEdits(s)).layout.returnGrille_2, undefined);
  s = redo(s);
  assert.equal(applySiteEdits(base, activeEdits(s)).returnCount, 2);
});

test('folding edits never mutates the design they were folded onto', () => {
  const base = Object.freeze({ layout: Object.freeze({}), outletOverrides: Object.freeze({}) });
  const d = fold(base, E(SITE_EDIT.MOVE_OUTLET, 'r', { x: 5, y: 6, index: 0 }));
  assert.equal(Object.keys(base.layout).length, 0);
  assert.equal(d.layout.outlet_r_0.x, 5);
});

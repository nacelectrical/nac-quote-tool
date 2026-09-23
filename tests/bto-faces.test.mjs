// CAN THE METAL ACTUALLY BE MADE?
//
// Nick: "A body dimension cannot be derived only from the largest collar or
// inlet ... For example, three Ø250 collars cannot be declared to fit across a
// 400 mm or 450 mm face. Two Ø350 collars cannot be declared to fit across a
// 450 mm face."
//
// The old arithmetic pooled a total collar run against a total available space
// and never asked which face anything was on, so it could not have caught
// either example. These tests are the two examples, plus the record Nick asked
// for — face, centre, outside diameter, edge clearance, clearance between
// neighbours, seam allowance, inlet position, outlet positions, required and
// available face sizes, pass/fail — and the rule that a proposal is never
// reported as validated.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FACE, layoutFace, assignCollars, proposeBody, btoFaceLayout,
         collarOutsideDiameterMm, faceLayoutLines,
         DEFAULT_ALLOWANCES } from '../designer/engines/bto-faces.mjs';
import { makeBto, withBody, btoSpec, applyBtoOverrides } from '../designer/engines/bto.mjs';

const collars = (...mm) => mm.map((d, i) => ({ portIndex: i + 1, diameterMm: d,
                                               destination: 'ROOM ' + (i + 1), airflowLs: 50 }));
const fitting = (id, inlet, outs) => makeBto({
  id, index: 1, position: { x: 0, y: 0 },
  inletDiameterMm: inlet, inletAirflowLs: 300, fedBy: 'Main A', label: id,
  ports: outs.map((d, i) => ({ sectionId: 's' + i, diameterMm: d, airflowLs: 50,
                               servesOutletId: 'o' + i, servesLabel: 'ROOM ' + (i + 1) }))
});

// ── Nick's two examples, exactly ───────────────────────────────────────────

test('three ø250 collars do not fit across one 450 mm face', () => {
  const box = { lengthMm: 450, widthMm: 450, heightMm: 450 };
  const f = layoutFace(FACE.SIDE_A, collars(250, 250, 250), box);
  assert.equal(f.fits, false);
  assert.ok(f.requiredWidthMm > 450, 'required ' + f.requiredWidthMm);
  assert.equal(f.availableWidthMm, 450);
  assert.ok(f.issues.some(i => i.code === 'FACE_TOO_NARROW'));
});

test('three ø250 collars do not fit across one 400 mm face either', () => {
  const f = layoutFace(FACE.SIDE_A, collars(250, 250, 250),
                       { lengthMm: 400, widthMm: 400, heightMm: 400 });
  assert.equal(f.fits, false);
});

test('two ø350 collars do not fit across one 450 mm face', () => {
  const f = layoutFace(FACE.FAR_END, collars(350, 350),
                       { lengthMm: 450, widthMm: 450, heightMm: 450 });
  assert.equal(f.fits, false);
  assert.ok(f.requiredWidthMm > 450, 'required ' + f.requiredWidthMm);
});

test('one ø250 collar does fit a 450 mm face — the check is not simply always no', () => {
  const f = layoutFace(FACE.SIDE_A, collars(250),
                       { lengthMm: 450, widthMm: 450, heightMm: 450 });
  assert.equal(f.fits, true);
  assert.deepEqual(f.issues, []);
});

// ── Everything Nick listed has to be on the record ─────────────────────────

test('every collar records its face, centre, outside diameter and clearances', () => {
  const layout = btoFaceLayout(fitting('BTO-A', 400, [250, 250, 250]));
  assert.equal(layout.collars.length, 3);
  for (const c of layout.collars) {
    assert.ok(c.face, 'no face');
    assert.ok(typeof c.faceLabel === 'string' && c.faceLabel.length);
    assert.equal(c.outsideDiameterMm, collarOutsideDiameterMm(c.nominalDiameterMm));
    assert.ok(c.outsideDiameterMm > c.nominalDiameterMm, 'the collar is metal, not a hole');
    assert.ok(typeof c.centreUmm === 'number' && c.centreUmm > 0);
    assert.ok(typeof c.centreVmm === 'number' && c.centreVmm > 0);
    assert.ok(c.edgeClearanceUmm >= 0, 'edge clearance not measured');
    assert.ok(c.edgeClearanceVmm >= 0);
    assert.equal(c.seamAllowanceMm, DEFAULT_ALLOWANCES.seamAllowanceMm);
    assert.ok('clearanceToPreviousMm' in c);
    assert.ok(c.destination, 'a collar with no destination cannot be connected');
  }
});

test('the inlet has a face, a position and a fit of its own', () => {
  const layout = btoFaceLayout(fitting('BTO-A', 400, [250, 250, 250]));
  assert.equal(layout.inlet.face, FACE.INLET_END);
  assert.equal(layout.inlet.nominalDiameterMm, 400);
  assert.ok(layout.inlet.centreUmm > 0 && layout.inlet.centreVmm > 0);
  assert.ok(layout.inlet.requiredWidthMm > 400, 'the inlet needs more than its own diameter');
  assert.ok(layout.inlet.availableWidthMm >= layout.inlet.requiredWidthMm);
  assert.equal(layout.inlet.fits, true);
});

test('each face reports required against available, both ways', () => {
  const layout = btoFaceLayout(fitting('BTO-C2', 350, [250, 250, 250]));
  assert.ok(layout.faces.length > 0);
  for (const f of layout.faces) {
    assert.ok(f.requiredWidthMm > 0 && f.requiredHeightMm > 0);
    assert.ok(f.availableWidthMm > 0 && f.availableHeightMm > 0);
    assert.equal(f.fits, f.requiredWidthMm <= f.availableWidthMm &&
                         f.requiredHeightMm <= f.availableHeightMm);
    assert.equal(f.seamAllowanceMm, DEFAULT_ALLOWANCES.seamAllowanceMm);
    assert.equal(f.edgeClearanceMm, DEFAULT_ALLOWANCES.edgeClearanceMm);
  }
});

// ── A proposal is never a validation ───────────────────────────────────────

test('a derived body is PROPOSED, never validated, however well it works out', () => {
  const layout = btoFaceLayout(fitting('BTO-A', 400, [250, 250, 250]));
  assert.equal(layout.pass, true, 'the arrangement itself is achievable');
  assert.equal(layout.bodySource, 'proposed');
  assert.equal(layout.validated, false, 'a proposal must never be called validated');
  assert.match(layout.status, /FABRICATION REVIEW REQUIRED/);
});

test('an undersized body the fabricator gave us FAILS, and says which face', () => {
  const layout = btoFaceLayout(fitting('BTO-A', 400, [250, 250, 250]),
    { body: { lengthMm: 400, widthMm: 400, heightMm: 400 }, bodySource: 'confirmed' });
  assert.equal(layout.pass, false);
  assert.equal(layout.validated, false);
  assert.match(layout.status, /DOES NOT FIT/);
  assert.ok(layout.issues.some(i => i.face === FACE.INLET_END),
    'a ø400 inlet cannot go on a 400 mm face');
});

test('collars that fit no face at all are named with the reason', () => {
  // Three ø250 collars, one usable face: they cannot all go on it.
  const layout = btoFaceLayout(fitting('BTO-A', 400, [250, 250, 250]),
    { body: { lengthMm: 500, widthMm: 500, heightMm: 500 }, bodySource: 'confirmed',
      collarFaces: [FACE.SIDE_A] });
  assert.equal(layout.pass, false);
  assert.ok(layout.unplacedCollars.length >= 1);
  for (const u of layout.unplacedCollars) {
    assert.ok(u.reason.length > 20, 'a collar with no home needs a reason');
    assert.ok(u.destination, 'and the room it was for');
  }
  assert.ok(layout.issues.some(i => i.code === 'COLLAR_HAS_NO_FACE'));
});

test('a valid multi-face arrangement PASSES against a real body', () => {
  const proposal = proposeBody(400, collars(250, 250, 250));
  assert.equal(proposal.achievable, true);
  const layout = btoFaceLayout(fitting('BTO-A', 400, [250, 250, 250]),
    { body: proposal, bodySource: 'confirmed' });
  assert.equal(layout.pass, true);
  assert.equal(layout.validated, true);
  assert.equal(layout.multiFace, true, 'three ø250 collars have to be spread');
  assert.equal(layout.facesUsed.length, 3);
  assert.match(layout.status, /VALIDATED/);
});

test('a collar wider than the inlet is caught whatever the box is', () => {
  const layout = btoFaceLayout(fitting('bad', 200, [250, 250]),
    { body: { lengthMm: 900, widthMm: 900, heightMm: 900 }, bodySource: 'confirmed' });
  assert.equal(layout.pass, false);
  assert.ok(layout.issues.some(i => i.code === 'COLLAR_LARGER_THAN_INLET'));
});

test('collars are spread across faces rather than crowded onto one', () => {
  const { buckets, unplaced } = assignCollars(collars(250, 250, 250),
    { lengthMm: 450, widthMm: 500, heightMm: 500 });
  assert.equal(unplaced.length, 0);
  const counts = [...buckets.values()].map(v => v.length).sort();
  assert.deepEqual(counts, [1, 1, 1]);
});

// ── The component, the schedule and the order all read the same layout ─────

test('the fitting carries the layout, and is not fabrication-ready while proposed', () => {
  const b = withBody(fitting('BTO-A', 400, [250, 250, 250]));
  assert.ok(b.body.faceLayout, 'no face layout on the fitting');
  assert.equal(b.body.layoutValidated, false);
  const spec = btoSpec(b);
  assert.equal(spec.fabricationReady, false);
  assert.equal(spec.dimensionsVerified, false);
  assert.match(spec.fabricationStatus, /FABRICATION REVIEW REQUIRED/);
  assert.ok(spec.collarFaceLines.length > 3, 'the layout has to be printable');
  assert.ok(spec.collarFaceLines.some(l => /Inlet/.test(l)));
});

test('the fabricator’s confirmed dimensions replace the proposal everywhere', () => {
  const base = fitting('BTO-A', 400, [250, 250, 250]);
  const proposed = withBody(base);
  const proposedText = proposed.body.bodyText;

  // What a SET_BTO_BODY site edit folds into the design.
  const [confirmed] = applyBtoOverrides([base], {
    'BTO-A': { bodyLengthMm: 600, bodyWidthMm: 550, bodyHeightMm: 550,
               bodyConfirmedBy: 'Nick', dimensionsVerified: true }
  });
  const withReal = withBody(confirmed);
  assert.notEqual(withReal.body.bodyText, proposedText);
  assert.equal(withReal.body.bodyText, '600 × 550 × 550 mm');
  assert.equal(withReal.body.dimensionsSource, 'configured');
  assert.equal(withReal.body.verified, true);
  assert.equal(withReal.body.layoutValidated, true, 'and the collars were laid out on it');
  const spec = btoSpec(withReal);
  assert.equal(spec.fabricationReady, true);
  assert.match(spec.fabricationStatus, /VALIDATED/);
  // The proposal is kept beside it so the two can be compared.
  assert.equal(spec.proposedBodyText, proposedText);
});

test('a confirmed body the collars do not fit is reported, not accepted', () => {
  const base = fitting('BTO-C', 400, [350, 350]);
  const [confirmed] = applyBtoOverrides([base], {
    'BTO-C': { bodyLengthMm: 450, bodyWidthMm: 450, bodyHeightMm: 450 }
  });
  const spec = btoSpec(withBody(confirmed));
  assert.equal(spec.dimensionsVerified, true, 'somebody did give us a body');
  assert.equal(spec.fabricationReady, false, 'but the collars do not go on it');
  assert.equal(spec.layoutPass, false);
  assert.match(spec.fabricationStatus, /DOES NOT FIT/);
});

test('the layout prints as lines a shop can mark out from', () => {
  const layout = btoFaceLayout(fitting('BTO-B', 400, [300, 250]));
  const lines = faceLayoutLines(layout);
  assert.ok(lines[0].startsWith('Inlet ø400'));
  assert.ok(lines.some(l => /ø300/.test(l) && /centre/.test(l)));
  assert.ok(lines.some(l => /ø250/.test(l) && /centre/.test(l)));
});

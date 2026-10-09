// ─────────────────────────────────────────────────────────────────────────────
// THE ROUTER, ON PLANS THAT ARE NOT THE SAME HOUSE
//
//   node tools/router-matrix.mjs [outDir]
//
// Runs every plan shape through the real pipeline and prints what came out,
// then reconciles the drawing, the duct schedule, the BOM and the pressure
// calculation against each other.
//
// The review said: "Some safeguards and reference-job tests were added, but
// those results do not establish reliability on new floor plans." Dungannon
// and the three-area house are the same SHAPE of problem — a roughly square
// single storey with central plant and a bedroom wing — so passing on both
// says very little. The fixtures in tests/fixtures/plan-shapes.mjs are chosen
// for what each one does that the others cannot.
//
// These are SYNTHETIC TEST FIXTURES, not NAC jobs.
// ─────────────────────────────────────────────────────────────────────────────

import { writeFileSync, mkdirSync } from 'node:fs';
import { PLAN_SHAPES, buildPlan } from '../tests/fixtures/plan-shapes.mjs';
import { buildThreeAreaHouse } from '../tests/fixtures/three-area-house.mjs';
import { reconcileDesign } from '../designer/engines/reconcile.mjs';

const OUT = process.argv[2] || '/tmp/nac-router-matrix';
mkdirSync(OUT, { recursive: true });

const lines = [];
const say = (s) => { lines.push(s); console.log(s); };

const pad = (v, w) => String(v === null || v === undefined ? '—' : v).padEnd(w);
const rpad = (v, w) => String(v === null || v === undefined ? '—' : v).padStart(w);

say('NAC AI HVAC DESIGNER — router on five different floor plans');
say('Synthetic test fixtures. Not NAC jobs, not anybody\'s house.');
say('');

const runs = [];
for (const spec of PLAN_SHAPES) {
  const r = await buildPlan(spec);
  runs.push({ key: spec.key, title: spec.title, challenge: spec.challenge, d: r.out });
}
const three = await buildThreeAreaHouse();
runs.push({ key: 'three-area', title: 'Three-area house — the existing reference fixture',
  challenge: 'The shape the router was built around. Here as the control: if a change '
    + 'breaks this it breaks the thing that already worked.', d: three.out });

// ── THE TABLE ──────────────────────────────────────────────────────────────
say(pad('PLAN', 15) + rpad('ROOMS', 6) + rpad('COND', 6) + rpad('OUT', 5)
  + rpad('MAINS', 6) + rpad('RUNS', 6) + rpad('DUCT m', 8) + rpad('BTO', 5)
  + rpad('PORTS', 6) + rpad('ZONES', 6) + rpad('DAMP', 6) + rpad('L/s', 6)
  + '  ' + pad('PRESSURE', 14) + 'RECONCILED');
say('─'.repeat(118));

const report = [];
for (const r of runs) {
  const d = r.d;
  const x = reconcileDesign(d);
  const f = x.facts;
  const conditioned = (d.rooms || []).filter(y => y.conditioned).length;
  say(pad(r.key, 15) + rpad((d.rooms || []).length, 6) + rpad(conditioned, 6)
    + rpad(f.outlets, 5) + rpad(f.mains, 6) + rpad(f.sections, 6)
    + rpad(f.totalDuctLengthM, 8) + rpad(f.btos, 5) + rpad(f.btoPorts, 6)
    + rpad(f.zones, 6) + rpad(f.dampers, 6) + rpad(f.allocatedAirflowLs, 6)
    + '  ' + pad(f.pressureStatus, 14)
    + (x.ok ? 'yes' : 'NO — ' + x.mismatches + ' mismatch'));
  report.push({ plan: r.key, title: r.title, challenge: r.challenge,
                facts: f, reconciliation: x });
}

say('');
say('WHAT EACH PLAN ASKS OF THE ROUTER');
say('');
for (const r of runs) {
  say('  ' + r.key);
  say('    ' + r.title);
  for (const w of wrap(r.challenge, 92)) say('      ' + w);
  say('');
}

function wrap(text, width) {
  const words = String(text).split(/\s+/);
  const out = []; let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) { out.push(line.trim()); line = w; }
    else line += ' ' + w;
  }
  if (line.trim()) out.push(line.trim());
  return out;
}

// ── RECONCILIATION DETAIL ──────────────────────────────────────────────────
say('RECONCILIATION — the drawing, the schedule, the BOM and the pressure');
say('');
let allOk = true;
for (const r of report) {
  const x = r.reconciliation;
  if (!x.ok) allOk = false;
  say('  ' + pad(r.plan, 15) + x.checked + ' checks, ' + x.mismatches + ' mismatches, '
    + x.unknowns + ' unknown');
  for (const f of x.findings) {
    say('      ' + f.level + '  ' + f.code);
    for (const w of wrap(f.detail, 86)) say('          ' + w);
  }
}
say('');
say(allOk
  ? 'Every plan reconciles: one system described four ways, with no disagreement.'
  : 'AT LEAST ONE PLAN DOES NOT RECONCILE — see above.');

writeFileSync(OUT + '/router-matrix.json', JSON.stringify(report, null, 2));
writeFileSync(OUT + '/router-matrix.txt', lines.join('\n') + '\n');
say('');
say('written to ' + OUT);
process.exit(allOk ? 0 : 1);

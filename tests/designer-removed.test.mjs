// ─────────────────────────────────────────────────────────────────────────────
// THE DUCT DESIGNER IS GONE, AND STAYS GONE
//
// Nick, 4 November 2026: "Remove obsolete navigation and automatic background
// calls as well as the visible controls... Do not merely hide the designer
// while continuing to run it."
//
// Hiding a screen is one line. Removing the thing behind it is thirty
// thousand, and the way it comes back is one import at a time. This walks the
// real import graph from every screen and endpoint the application serves and
// fails if any duct-design engine is reachable again — including through a
// chain of four innocent-looking modules.
//
// It also holds the other half: the engines that were KEPT because plan
// reading, sizing, equipment and pricing need them must still be here.
// ─────────────────────────────────────────────────────────────────────────────

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

/** Everything the duct designer was. None of it may come back. */
const DUCT_DESIGN = [
  'airflow', 'area-router', 'bom', 'bto', 'bto-faces', 'bto-pricing',
  'design-rules', 'design-stage', 'ducts', 'fitting-assembly', 'minimum-airflow',
  'mmem-fittings', 'nac-router', 'nac-schedule', 'order', 'outlet-register',
  'outlets', 'pipeline', 'placement', 'pressure', 'reconcile', 'report-doc',
  'return-model', 'returnair', 'router', 'schedules', 'site-edit', 'site-store',
  'spigot-selection', 'supply-graph', 'supply-spigots', 'zone-dampers', 'zones',
  'zoning-safety'
];

/** Kept on purpose: a quote needs every one of these. */
const KEPT = [
  'rooms', 'classify', 'dimensions', 'chains', 'interpret', 'calibration',
  'scale-invalidation', 'loads', 'units', 'model',
  'equipment', 'catalogue', 'unit-specs', 'supplier-pricing', 'system-options',
  'costing', 'pricing-mode', 'quote-draft', 'issued-offer', 'presentation',
  'presentation-content', 'presentation-share', 'zoning-groups'
];

const IMPORT = /(?:^|[^\w$.])(?:import\s+(?:[\s\S]*?)\s+from\s*|import\s*|await\s+import\s*\(\s*|export\s+(?:\*|\{[\s\S]*?\})\s+from\s*)['"]([^'"]+)['"]/g;
const REQUIRE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

function depsOf(file) {
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { return []; }
  const out = new Set();
  for (const re of [IMPORT, REQUIRE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const spec = m[1];
      if (!/^[./]/.test(spec)) continue;
      if (spec.startsWith('/opt') || spec.startsWith('/usr')) continue;
      const base = spec.startsWith('/') ? ROOT + spec : resolve(dirname(file), spec);
      for (const cand of [base, base + '.mjs', base + '.js']) {
        if (existsSync(cand)) { out.add(cand); break; }
      }
    }
  }
  return [...out];
}

/** Every file the application serves, and everything they pull in. */
function reachable() {
  const entries = readdirSync(ROOT).filter(f => f.endsWith('.html')).map(f => ROOT + '/' + f)
    .concat(readdirSync(ROOT + '/server').map(f => ROOT + '/server/' + f))
    .concat(readdirSync(ROOT + '/api').map(f => ROOT + '/api/' + f));
  const seen = new Set();
  const trail = new Map();
  const q = entries.map(e => [e, e]);
  while (q.length) {
    const [f, via] = q.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    trail.set(f, via);
    for (const d of depsOf(f)) if (!seen.has(d)) q.push([d, via]);
  }
  return { seen, trail };
}

test('no duct-design engine is reachable from anything the application serves', () => {
  const { seen, trail } = reachable();
  const back = [];
  for (const f of seen) {
    const name = f.split('/').pop().replace(/\.mjs$/, '');
    if (f.includes('/designer/engines/') && DUCT_DESIGN.includes(name)) {
      back.push(name + ' (pulled in from ' + trail.get(f).split('/').pop() + ')');
    }
  }
  assert.deepEqual(back, [], 'the duct designer is running again');
});

test('the duct-design engines are not in the repository at all', () => {
  const present = DUCT_DESIGN
    .filter(n => existsSync(ROOT + '/designer/engines/' + n + '.mjs'));
  assert.deepEqual(present, [], 'hidden rather than removed');
});

test('the designer screen and its shell are gone', () => {
  for (const f of ['designer/app.mjs', 'designer/ui/tabs.mjs', 'designer/ui/site-adjust.mjs',
                   'designer/ui/plan-viewer.mjs', 'designer/ui/reports.mjs',
                   'designer/ui/report-html.mjs', 'designer/ui/report-pdf.mjs',
                   'designer/ui/quick-mode.mjs', 'designer/ui/flex-renderer.mjs']) {
    assert.equal(existsSync(ROOT + '/' + f), false, f + ' is still here');
  }
});

test('the door the designer was behind still opens, and explains itself', () => {
  // Every intake notification NAC has sent links to /designer.html. The page
  // is a signpost now; it must not 404 and must not pretend to be a designer.
  const html = readFileSync(ROOT + '/designer.html', 'utf8');
  assert.match(html, /retired/i);
  assert.match(html, /quote-builder\.html/);
  assert.ok(!/app\.mjs|DesignerApp/.test(html), 'it still boots the designer');
  // And it carries an intake link across rather than dropping it on the floor.
  assert.match(html, /draft/);
});

test('nothing the application serves asks for a duct design before quoting', () => {
  // The gate that used to refuse a quote over fittings, plenums, duct sizes
  // and static pressure keeps only the checks that are about the offer.
  const gate = readFileSync(ROOT + '/designer/engines/quote-gate.mjs', 'utf8');
  for (const dead of ['BTO_PRICE_REQUIRED', 'FITTINGS_NOT_AVAILABLE', 'PLENUM_INVALID',
                      'DUCT_SIZE_INCONSISTENT', 'PRESSURE_NOT_CALCULATED',
                      'SUPPLY_GRAPH_INVALID', 'OUTLET_SCHEDULE_DISAGREEMENT',
                      'SCALE_NOT_VERIFIED']) {
    assert.ok(!gate.includes(dead + ':'), dead + ' can still block a quote');
  }
});

test('the engines a quote actually needs are all still here', () => {
  const missing = KEPT.filter(n => !existsSync(ROOT + '/designer/engines/' + n + '.mjs'));
  assert.deepEqual(missing, [], 'removed something quoting needs');
});

test('the plan scale rules survived the move out of design-stage', async () => {
  // recordCalibration() and the list of sources that may stand behind a price
  // lived in design-stage.mjs beside the stage gate. The gate went; these are
  // how a plan is read and had to come with us.
  const cal = await import('../designer/engines/calibration.mjs');
  assert.equal(typeof cal.recordCalibration, 'function');
  assert.ok(cal.VERIFIED_SCALE_SOURCES.includes(cal.SCALE_SOURCE.PRINTED_DIMENSION));
  assert.ok(cal.VERIFIED_SCALE_SOURCES.includes(cal.SCALE_SOURCE.MEASURED));
  // Nick: "Never derive scale from cars, furniture or guessed objects."
  assert.ok(!cal.VERIFIED_SCALE_SOURCES.includes(cal.SCALE_SOURCE.DRAWN_OBJECT));
});

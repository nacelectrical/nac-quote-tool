// WHAT THE SHEET SAYS ABOUT ITSELF.
//
// Three defects, all of them presentation rather than engineering, and all of
// them the kind that make a reader distrust the numbers that ARE right:
//
//   · the Study printed 0 L/s of design airflow and 5.4% of system on the same
//     line — 5.4% being its share of the airflow it was RECOMMENDED, worked out
//     before spill air was redistributed and never restated;
//   · the page number was right-aligned to land exactly on the margin, with
//     nothing in hand, so a viewer or printer that rounds clips its last glyph
//     and "Page 14 of 15" reads as "Page 14 of 1";
//   · `BTO-C1` broke over two lines in the fabrication schedule, which in a
//     workshop reads as a different fitting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shareOfSystemPct, applySystemShares } from '../designer/engines/airflow.mjs';
import { internalReportDoc } from '../designer/engines/report-doc.mjs';
import { renderReportPdf, columnLayout, columnWidths,
         FOOTER } from '../designer/ui/report-pdf.mjs';
import { buildApproved } from './fixtures/approved-job.mjs';

const approved = await buildApproved();
const out = approved.out;
const row = (label) => out.airflow.rows.find(r => r.label === label);
const designTotal = out.airflow.rows.reduce((n, r) => n + r.adjustedLs, 0);

// ── A room with no design airflow has no share of the system ───────────────

test('0 L/s of design airflow is 0% of system', () => {
  assert.equal(shareOfSystemPct(0, 799), 0);
  assert.equal(shareOfSystemPct(0, 0), 0);
  assert.equal(shareOfSystemPct(50, 0), 0, 'no system airflow is not a divide by zero');
});

test('the Study takes spill air, so it is 0 L/s AND 0% of system', () => {
  const study = row('STUDY');
  assert.ok(study, 'the approved job has a Study on spill air');
  assert.equal(study.adjustedLs, 0, 'design airflow');
  assert.equal(study.systemSharePct, 0, 'share of system');
  // And the check is worth something: the OLD number is still there to be got
  // wrong. 43 L/s of recommended airflow is 5.4% of the system.
  assert.ok(study.recommendedLs > 0);
  assert.ok(shareOfSystemPct(study.recommendedLs, designTotal) > 5,
    'the recommended figure would still give a non-zero share — so this test ' +
    'fails if anything goes back to using it');
});

test('every share is the DESIGN airflow’s, never the recommendation’s', () => {
  for (const r of out.airflow.rows) {
    assert.equal(r.systemSharePct, shareOfSystemPct(r.adjustedLs, designTotal), r.label);
  }
  // The rooms the Study spills into carry its air, and their shares say so.
  const living = row('LIVING');
  assert.ok(living.adjustedLs > living.recommendedLs, 'LIVING took spill air');
  assert.ok(living.systemSharePct > shareOfSystemPct(living.recommendedLs, designTotal),
    'and its share went up with it');
});

test('the shares add up to the whole system', () => {
  const sum = out.airflow.rows.reduce((n, r) => n + r.systemSharePct, 0);
  assert.ok(Math.abs(sum - 100) <= 0.5, 'shares total ' + sum + '%');
});

test('re-stating the shares moves no airflow', () => {
  const rows = out.airflow.rows.map(r => ({ ...r }));
  const before = rows.map(r => r.adjustedLs);
  applySystemShares(rows);
  assert.deepEqual(rows.map(r => r.adjustedLs), before);
});

// ── The two tables cannot disagree ─────────────────────────────────────────

test('the Airflow and Zone schedules use the same percentage calculation', () => {
  const zones = out.zones.zones;
  assert.ok(zones.length > 1);
  for (const z of zones) {
    assert.equal(z.systemSharePct, shareOfSystemPct(z.airflowLs, out.airflow.allocatedAirflowLs),
      z.name);
  }
  // A zone of exactly one room must read the same as that room's line.
  for (const z of zones) {
    if ((z.rooms || []).length !== 1) continue;
    const r = row(z.rooms[0]);
    if (!r) continue;
    assert.equal(z.systemSharePct, r.systemSharePct,
      z.name + ' zone ' + z.systemSharePct + '% vs room ' + r.systemSharePct + '%');
  }
});

test('the Study reads 0% on BOTH tables', () => {
  const z = out.zones.zones.find(x => (x.rooms || []).includes('STUDY') ||
                                      /study/i.test(x.name));
  assert.ok(z, 'the Study has a zone');
  assert.equal(z.airflowLs, 0);
  assert.equal(z.systemSharePct, 0);
  assert.equal(row('STUDY').systemSharePct, 0);
});

test('the report prints the share it was given, for both tables', () => {
  const doc = internalReportDoc(out);
  const tables = doc.blocks.filter(b => b.t === 'table');
  const air = tables.find(t => t.cols.some(c => c.label === 'Design (L/s)'));
  assert.ok(air, 'the airflow table is on the sheet');
  const studyRow = air.rows.find(r => r[0] === 'STUDY');
  assert.deepEqual([studyRow[3], studyRow[4]], ['0', '0%'],
    'design airflow and share, as printed');
  const zoneTable = tables.find(t => t.cols.some(c => c.label === 'Always open'));
  assert.ok(zoneTable, 'the zone schedule is on the sheet');
  const studyZone = zoneTable.rows.find(r => /study/i.test(r[0]));
  assert.equal(studyZone[4], '0%');
});

// ── Every footer carries the whole page number ─────────────────────────────

const pdf = renderReportPdf(internalReportDoc(out));
const raw = Buffer.from(pdf).toString('latin1');
const pageCount = (raw.match(/\/Type \/Page[^s]/g) || []).length;

test('the internal sheet is more than one page', () => {
  assert.ok(pageCount > 1, 'only ' + pageCount + ' page(s)');
});

test('every page carries a complete "Page X of Y"', () => {
  const found = [...raw.matchAll(/\(Page (\d+) of (\d+)\)/g)]
    .map(m => ({ n: Number(m[1]), of: Number(m[2]) }));
  assert.equal(found.length, pageCount,
    found.length + ' footer(s) for ' + pageCount + ' page(s)');
  for (const f of found) {
    assert.equal(f.of, pageCount, 'page ' + f.n + ' says "of ' + f.of + '"');
  }
  assert.deepEqual(found.map(f => f.n), Array.from({ length: pageCount }, (_, i) => i + 1));
  // The symptom, named: a truncated total reads as a one-page document.
  assert.ok(!/\(Page \d+ of 1\)/.test(raw) || pageCount === 1);
});

test('the page number stays inside the printable margin, with room to spare', () => {
  for (const width of [595.28, 841.89]) {           // portrait and landscape
    for (const total of [1, 9, 15, 99, 150, 999]) {
      for (const n of [1, total]) {
        const text = 'Page ' + n + ' of ' + total;
        const box = FOOTER.pageNumberBox(width, text);
        assert.ok(box.right <= box.limit - 2,
          text + ' on a ' + width + ' pt page ends at ' + box.right.toFixed(2) +
          ' against a limit of ' + box.limit.toFixed(2));
        assert.ok(box.x > FOOTER.margin, text + ' starts left of the margin');
      }
    }
  }
});

test('the footer leaves a real gap, not a hairline', () => {
  const box = FOOTER.pageNumberBox(595.28, 'Page 15 of 15');
  assert.ok(box.limit - box.right >= 4,
    'only ' + (box.limit - box.right).toFixed(2) + ' pt of clearance');
});

// ── A BTO keeps its name ───────────────────────────────────────────────────

test('every BTO id is set on one line, at a legible size', () => {
  const doc = internalReportDoc(out);
  const schedule = doc.blocks.filter(b => b.t === 'table')
    .find(t => t.cols[0].label === 'BTO');
  assert.ok(schedule, 'the BTO fabrication schedule is on the sheet');
  assert.equal(schedule.cols[0].nw, true, 'the id column is marked no-wrap');
  const widths = columnWidths(schedule.cols);
  const { cellSize, wrapped } = columnLayout(schedule.cols, schedule.rows, widths, 7.5, 4);
  assert.ok(cellSize[0] >= FOOTER.minSize,
    'ids are set at ' + cellSize[0] + ' pt, under the legible floor');
  for (let i = 0; i < schedule.rows.length; i++) {
    assert.equal(wrapped[i][0].length, 1,
      schedule.rows[i][0] + ' broke over ' + wrapped[i][0].length + ' lines');
    assert.equal(wrapped[i][0][0], schedule.rows[i][0], 'and it is not clipped');
  }
});

test('BTO-C1 and BTO-C2 reach the page whole', () => {
  assert.match(raw, /\(BTO-C1\)/);
  assert.match(raw, /\(BTO-C2\)/);
  // The broken form: `BTO-C` on one line and a bare `1` under it.
  assert.ok(!/\(BTO-C\)[\s\S]{0,200}?\(1\) Tj/.test(raw), 'a BTO id was split');
});

test('a longer id shrinks rather than wrapping', () => {
  const cols = [{ label: 'BTO', w: 1.05, nw: true }, { label: 'Configuration', w: 2.0 },
                { label: 'a' }, { label: 'b' }, { label: 'c', w: 1.6 },
                { label: 'd', w: 1.2 }, { label: 'e', w: 1.5 },
                { label: 'f', w: 1.8 }, { label: 'g', w: 1.2 }];
  const rows = [['BTO-A', '', '', '', '', '', '', '', ''],
                ['BTO-C12', '', '', '', '', '', '', '', '']];
  const widths = columnWidths(cols);
  const { cellSize, wrapped } = columnLayout(cols, rows, widths, 7.5, 4);
  assert.equal(wrapped[1][0].length, 1, 'BTO-C12 wrapped');
  assert.equal(wrapped[1][0][0], 'BTO-C12');
  assert.ok(cellSize[0] >= FOOTER.minSize && cellSize[0] <= 7.5);
});

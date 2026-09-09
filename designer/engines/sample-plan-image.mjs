// NAC AI HVAC DESIGNER — a drawn sample plan for the PART 36 test project.
//
// The image is generated from the SAME chain data the interpretation engine
// reconstructs, so what the estimator sees on screen is exactly what the
// engines are reading: chained perimeter dimension rows with wall thicknesses
// in the chain, an outer overall row, opening widths on a separate row, and
// annotations that look numeric but are not lengths.

import { SAMPLE_PLAN_META, PX_PER_MM, H_CHAIN_SEGMENTS, V_CHAIN_SEGMENTS,
         H_STATIONS, V_STATIONS, H_OVERALL_MM, V_OVERALL_MM, SAMPLE_ROOMS } from './sample-plan.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function samplePlanSvg() {
  const M = SAMPLE_PLAN_META;
  const o = M.originPx;
  const X = (mm) => (o.x + mm * PX_PER_MM).toFixed(1);
  const Y = (mm) => (o.y + mm * PX_PER_MM).toFixed(1);
  const W = M.imageWidthPx, H = M.imageHeightPx;

  const p = [];
  p.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);

  // ── Rooms ─────────────────────────────────────────────────────────────────
  for (const r of SAMPLE_ROOMS) {
    const x1 = H_STATIONS[r.h[0]], x2 = H_STATIONS[r.h[1]];
    const y1 = V_STATIONS[r.v[0]], y2 = V_STATIONS[r.v[1]];
    const cx = (Number(X(x1)) + Number(X(x2))) / 2;
    // Sit the plan's own room name near the top of the room — the designer
    // draws its verification label in the centre.
    const cy = Number(Y(y1)) + 18;
    p.push(`<rect x="${X(x1)}" y="${Y(y1)}" width="${(Number(X(x2)) - Number(X(x1))).toFixed(1)}" ` +
      `height="${(Number(Y(y2)) - Number(Y(y1))).toFixed(1)}" fill="#fbfbfd" stroke="none"/>`);
    p.push(`<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" font-family="Helvetica,Arial" font-size="11" ` +
      `font-weight="bold" fill="#20242e" text-anchor="middle">${esc(r.label.toUpperCase())}</text>`);
  }

  // ── Walls, drawn at their real thickness from the chain ───────────────────
  // Vertical walls sit at every odd-indexed station pair (the wall segments).
  let acc = 0;
  H_CHAIN_SEGMENTS.forEach((seg, i) => {
    if (i % 2 === 0) {                        // even index = a wall segment
      p.push(`<rect x="${X(acc)}" y="${Y(0)}" width="${(seg * PX_PER_MM).toFixed(2)}" ` +
        `height="${(V_OVERALL_MM * PX_PER_MM).toFixed(1)}" fill="#20242e"/>`);
    }
    acc += seg;
  });
  acc = 0;
  V_CHAIN_SEGMENTS.forEach((seg, i) => {
    if (i % 2 === 0) {
      p.push(`<rect x="${X(0)}" y="${Y(acc)}" width="${(H_OVERALL_MM * PX_PER_MM).toFixed(1)}" ` +
        `height="${(seg * PX_PER_MM).toFixed(2)}" fill="#20242e"/>`);
    }
    acc += seg;
  });

  // ── Openings punched through the front wall ───────────────────────────────
  const openings = [
    { centreMm: 1900, widthMm: 1800, kind: 'window' },
    { centreMm: 4700, widthMm: 820, kind: 'door' },
    { centreMm: 14500, widthMm: 2400, kind: 'slider' }
  ];
  for (const op of openings) {
    const x = X(op.centreMm - op.widthMm / 2);
    const w = (op.widthMm * PX_PER_MM).toFixed(1);
    p.push(`<rect x="${x}" y="${Y(0)}" width="${w}" height="${(110 * PX_PER_MM).toFixed(2)}" fill="#ffffff"/>`);
    if (op.kind === 'window') {
      p.push(`<line x1="${x}" y1="${Y(55)}" x2="${Number(x) + Number(w)}" y2="${Y(55)}" stroke="#20242e" stroke-width="1"/>`);
    } else {
      p.push(`<path d="M ${x} ${Y(110)} a ${w} ${w} 0 0 1 ${w} ${w}" fill="none" stroke="#7a8090" stroke-width="0.8"/>`);
      p.push(`<line x1="${x}" y1="${Y(110)}" x2="${x}" y2="${Number(Y(110)) + Number(w)}" stroke="#20242e" stroke-width="1.4"/>`);
    }
  }

  // ── Dimension rows ────────────────────────────────────────────────────────
  const tick = (x, y1, y2) => `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="#4a5060" stroke-width="0.7"/>`;
  const dimText = (x, y, t, vertical) => vertical
    ? `<text x="${x}" y="${y}" font-family="Helvetica,Arial" font-size="10" fill="#20242e" ` +
      `text-anchor="middle" transform="rotate(-90 ${x} ${y})">${esc(t)}</text>`
    : `<text x="${x}" y="${y}" font-family="Helvetica,Arial" font-size="10" fill="#20242e" text-anchor="middle">${esc(t)}</text>`;

  // Horizontal row 1 (the setting-out chain), above the building.
  const hRow1Y = Number(Y(0)) - 24;
  p.push(`<line x1="${X(0)}" y1="${hRow1Y}" x2="${X(H_OVERALL_MM)}" y2="${hRow1Y}" stroke="#4a5060" stroke-width="0.8"/>`);
  acc = 0;
  for (const seg of H_CHAIN_SEGMENTS) {
    p.push(tick(X(acc), hRow1Y - 5, Number(Y(0))));
    p.push(dimText(Number(X(acc + seg / 2)), hRow1Y - 4, String(seg)));
    acc += seg;
  }
  p.push(tick(X(H_OVERALL_MM), hRow1Y - 5, Number(Y(0))));

  // Horizontal row 0 (the overall), further out.
  const hRow0Y = Number(Y(0)) - 56;
  p.push(`<line x1="${X(0)}" y1="${hRow0Y}" x2="${X(H_OVERALL_MM)}" y2="${hRow0Y}" stroke="#4a5060" stroke-width="0.8"/>`);
  p.push(tick(X(0), hRow0Y - 5, hRow0Y + 5));
  p.push(tick(X(H_OVERALL_MM), hRow0Y - 5, hRow0Y + 5));
  p.push(dimText(Number(X(H_OVERALL_MM / 2)), hRow0Y - 4, String(H_OVERALL_MM)));

  // Vertical row 1, left of the building.
  const vRow1X = Number(X(0)) - 24;
  p.push(`<line x1="${vRow1X}" y1="${Y(0)}" x2="${vRow1X}" y2="${Y(V_OVERALL_MM)}" stroke="#4a5060" stroke-width="0.8"/>`);
  acc = 0;
  for (const seg of V_CHAIN_SEGMENTS) {
    p.push(`<line x1="${vRow1X - 5}" y1="${Y(acc)}" x2="${X(0)}" y2="${Y(acc)}" stroke="#4a5060" stroke-width="0.7"/>`);
    p.push(dimText(vRow1X - 4, Number(Y(acc + seg / 2)), String(seg), true));
    acc += seg;
  }

  // Vertical row 0 (the overall).
  const vRow0X = Number(X(0)) - 56;
  p.push(`<line x1="${vRow0X}" y1="${Y(0)}" x2="${vRow0X}" y2="${Y(V_OVERALL_MM)}" stroke="#4a5060" stroke-width="0.8"/>`);
  p.push(dimText(vRow0X - 4, Number(Y(V_OVERALL_MM / 2)), String(V_OVERALL_MM), true));

  // Row 2 — opening widths, on the wall line itself.
  for (const op of openings) {
    p.push(dimText(Number(X(op.centreMm)), Number(Y(0)) + 44, String(op.widthMm)));
  }

  // ── Annotations that are NOT lengths ──────────────────────────────────────
  p.push(`<text x="${X(4000)}" y="${Y(6000)}" font-family="Helvetica,Arial" font-size="10" fill="#5a6070">R2.5</text>`);
  p.push(`<text x="${X(4600)}" y="${Y(6400)}" font-family="Helvetica,Arial" font-size="10" fill="#5a6070">FFL 12.50</text>`);
  p.push(`<text x="${X(9500)}" y="${Y(1800)}" font-family="Helvetica,Arial" font-size="10" fill="#5a6070">BED 3</text>`);
  p.push(`<text x="${X(9800)}" y="${Y(2100)}" font-family="Helvetica,Arial" font-size="10" fill="#5a6070">3</text>`);
  p.push(dimText(Number(X(0)) - 110, Number(Y(2000)), '900', true));
  p.push(`<text x="${Number(X(0)) - 118}" y="${Y(3400)}" font-family="Helvetica,Arial" font-size="8" ` +
    `fill="#8a90a0" transform="rotate(-90 ${Number(X(0)) - 118} ${Y(3400)})">BOUNDARY SETBACK</text>`);

  // Spaces the estimator would not condition, labelled but deliberately absent
  // from SAMPLE_ROOMS — a real plan always has more labels than rooms.
  const extras = [
    { label: 'PORTICO', h: [1, 2], v: [7, 8] },
    { label: 'STORE',   h: [3, 4], v: [7, 8] },
    { label: 'VOID',    h: [5, 6], v: [7, 8] }
  ];
  for (const e of extras) {
    const cx = (Number(X(H_STATIONS[e.h[0]])) + Number(X(H_STATIONS[e.h[1]]))) / 2;
    p.push(`<text x="${cx.toFixed(1)}" y="${Number(Y(V_STATIONS[e.v[0]])) + 18}" ` +
      `font-family="Helvetica,Arial" font-size="11" font-weight="bold" fill="#20242e" ` +
      `text-anchor="middle">${esc(e.label)}</text>`);
  }

  // ── Title block ───────────────────────────────────────────────────────────
  const tbY = H - 92;
  p.push(`<rect x="${W - 470}" y="${tbY}" width="450" height="72" fill="none" stroke="#20242e" stroke-width="1"/>`);
  p.push(`<text x="${W - 456}" y="${tbY + 22}" font-family="Helvetica,Arial" font-size="13" font-weight="bold" fill="#20242e">PROPOSED RESIDENCE — GROUND FLOOR PLAN</text>`);
  p.push(`<text x="${W - 456}" y="${tbY + 41}" font-family="Helvetica,Arial" font-size="11" fill="#40465a">14 WATTLEBIRD DRIVE, SPRINGFIELD LAKES QLD 4300</text>`);
  p.push(`<text x="${W - 456}" y="${tbY + 60}" font-family="Helvetica,Arial" font-size="11" fill="#40465a">${esc(M.scaleLabelText)}   ·   DRAWING A-101   ·   REV C</text>`);
  p.push(`<text x="${W - 470}" y="${tbY - 12}" font-family="Helvetica,Arial" font-size="9" fill="#8a90a0">ALL DIMENSIONS IN MILLIMETRES. DO NOT SCALE OFF DRAWING.</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    p.join('') + '</svg>';
}

/** A data URL the plan viewer can load directly. */
export function samplePlanDataUrl() {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(samplePlanSvg());
}

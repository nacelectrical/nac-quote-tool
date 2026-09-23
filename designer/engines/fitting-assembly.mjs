// ─────────────────────────────────────────────────────────────────────────────
// BUILDING A MAIN OUT OF PARTS NAC CAN ACTUALLY BUY
//
// Nick: "only use these in design also" — and then, of the five fittings whose
// inlets and outlets are still unknown: "use only what ive given."
//
// So this solver knows four parts and nothing else:
//
//   DB8   MMADB8    ø400 in  →  3 × ø300
//   B11   MMAB11    ø400 in  →  ø350 + ø250
//   Y5    MMADY16   ø400 in  →  2 × ø300
//   Y4    MMADY14   ø350 in  →  2 × ø250, or 2 × ø300
//
// Given a main's inlet diameter and the necks its outlets need, it finds an
// assembly of those parts that reaches every one of them — or says plainly
// that no assembly does. It never invents a fitting and it never quietly
// changes the brief to one it can solve.
//
// TWO RULES IT WILL NOT BREAK
//
//   · A leg is never SMALLER than the neck it feeds. Putting a ø250 leg on a
//     ø300 outlet is throttling the room to make the parts list work.
//   · A leg that is bigger is allowed, and is recorded as an upsize with the
//     size the calculation actually asked for kept beside it. That is what
//     happens on site when the stocked fitting is a size up, and it is the
//     kind of thing that should appear on a schedule rather than in somebody's
//     memory.
//
// WHAT THE FOUR PARTS IMPLY, and it is worth knowing before reading a failure:
// nothing NAC has given takes a ø300 or a ø250 inlet, so a ø300 or ø250 leg
// terminates — it feeds exactly one outlet. A ø400 main therefore reaches at
// most THREE outlets: three ø300 legs (DB8), or a ø250 outlet plus a ø350 leg
// carrying a Y4 to two more (B11 → Y4). A main that has to feed four is not a
// main that can be built from this list.
// ─────────────────────────────────────────────────────────────────────────────

import { SELECTABLE_FITTINGS, describeFitting } from './mmem-fittings.mjs';

/** Every outlet set a part offers, as its own option. */
function partOptions() {
  const out = [];
  for (const f of SELECTABLE_FITTINGS) {
    const sets = [f.outletsMm, ...(f.alternativeOutletsMm || [])].filter(Boolean);
    for (const legs of sets) {
      out.push({ code: f.code, name: f.name, inletMm: Number(f.inletMm),
                 legsMm: [...legs].map(Number), cost: f.cost, fitting: f });
    }
  }
  return out;
}

export const PART_OPTIONS = partOptions();

/** The parts that accept this inlet diameter. */
export function partsForInlet(inletMm) {
  return PART_OPTIONS.filter(p => p.inletMm === Number(inletMm));
}

/** How many outlets a leg of this size can ever reach, with these parts. */
function reachOf(sizeMm, depth = 0) {
  if (depth > 4) return 1;
  const parts = partsForInlet(sizeMm);
  if (!parts.length) return 1;                    // terminates at one outlet
  let best = 1;
  for (const p of parts) {
    best = Math.max(best, p.legsMm.reduce((n, l) => n + reachOf(l, depth + 1), 0));
  }
  return best;
}

/** The most outlets any assembly can reach from this inlet. Cached. */
const REACH = new Map();
export function maxOutletsFrom(inletMm) {
  const key = Number(inletMm);
  if (!REACH.has(key)) REACH.set(key, reachOf(key));
  return REACH.get(key);
}

/** Split `items` into `n` non-empty groups, every distinct way. */
function partitions(items, n) {
  if (n === 1) return [[items]];
  if (items.length < n) return [];
  const out = [];
  const assign = new Array(items.length).fill(0);
  const walk = (i, used) => {
    if (i === items.length) {
      if (used < n) return;
      const groups = Array.from({ length: n }, () => []);
      items.forEach((it, k) => groups[assign[k]].push(it));
      if (groups.every(g => g.length)) out.push(groups);
      return;
    }
    for (let g = 0; g <= Math.min(used, n - 1); g++) {
      assign[i] = g;
      walk(i + 1, Math.max(used, g + 1));
    }
  };
  walk(0, 0);
  return out;
}

const totalCost = (node) =>
  (node.cost || 0) + (node.legs || []).reduce((n, l) => n + (l.assembly ? totalCost(l.assembly) : 0), 0);

const totalUpsize = (node) =>
  (node.legs || []).reduce((n, l) =>
    n + (l.assembly ? totalUpsize(l.assembly) : (l.upsizedFromMm ? 1 : 0)), 0);

/**
 * An assembly of stocked parts that feeds every neck, or null.
 *
 * `necks` is the list of outlet neck diameters this inlet has to reach, in
 * millimetres. The cheapest assembly wins, and among equal-cost ones the one
 * that upsizes fewest outlets.
 */
export function solveAssembly(inletMm, necks, depth = 0) {
  const wanted = [...(necks || [])].map(Number).filter(n => n > 0);
  if (!wanted.length) return null;
  if (depth > 4) return null;

  // One outlet straight off this leg — no fitting needed at all.
  if (wanted.length === 1) {
    return Number(inletMm) >= wanted[0] ? { terminal: true, sizeMm: Number(inletMm) } : null;
  }

  let best = null;
  for (const part of partsForInlet(inletMm)) {
    if (part.legsMm.length > wanted.length) continue;       // a leg with nothing on it
    for (const groups of partitions(wanted, part.legsMm.length)) {
      // Try the groups against the legs in both orders of size, so a mixed
      // part like the B11 can put its big group on its big leg.
      const legOrder = [...part.legsMm.keys()];
      const built = [];
      let ok = true;
      // Biggest group to biggest leg is the only ordering that can work when
      // the legs differ, and it costs nothing when they do not.
      const byLeg = [...legOrder].sort((a, b) => part.legsMm[b] - part.legsMm[a]);
      const byGroup = [...groups.keys()].sort((a, b) =>
        (Math.max(...groups[b]) - Math.max(...groups[a])) || (groups[b].length - groups[a].length));

      for (let i = 0; i < byLeg.length; i++) {
        const legMm = part.legsMm[byLeg[i]];
        const group = groups[byGroup[i]];
        if (group.length === 1) {
          if (legMm < group[0]) { ok = false; break; }      // never throttle a room
          built.push({ legMm, neckMm: group[0],
                       upsizedFromMm: legMm > group[0] ? group[0] : null });
        } else {
          const sub = solveAssembly(legMm, group, depth + 1);
          if (!sub) { ok = false; break; }
          built.push({ legMm, assembly: sub });
        }
      }
      if (!ok) continue;

      const node = { code: part.code, name: part.name, inletMm: part.inletMm,
                     cost: part.cost, legs: built,
                     description: describeFitting(part.fitting) };
      if (!best) { best = node; continue; }
      // ── THE DESIGN FIRST, THEN THE PRICE ────────────────────────────────
      // Three ø250 outlets off a ø400 can be a DB8 at $75 with all three
      // upsized to ø300, or a B11 feeding a Y4 at $105 with none. The cheap
      // one quietly changes three rooms' branch sizes to save thirty dollars,
      // and the balance on the day is somebody else's problem. So the fewest
      // departures from the calculated design wins, and price breaks the tie.
      const u = totalUpsize(node), ub = totalUpsize(best);
      if (u < ub || (u === ub && totalCost(node) < totalCost(best))) best = node;
    }
  }
  return best;
}

/** Every part in an assembly, flattened, with its quantity. */
export function partsIn(assembly) {
  const counts = new Map();
  const walk = (n) => {
    if (!n || n.terminal) return;
    counts.set(n.code, (counts.get(n.code) || 0) + 1);
    for (const l of n.legs || []) walk(l.assembly);
  };
  walk(assembly);
  return [...counts.entries()].map(([code, quantity]) => {
    const p = PART_OPTIONS.find(x => x.code === code);
    return { code, quantity, cost: p.cost, name: p.name,
             lineTotal: Math.round(p.cost * quantity * 100) / 100 };
  });
}

/** Every outlet an assembly reaches, and whether its leg was upsized. */
export function outletsIn(assembly) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.terminal) { out.push({ legMm: n.sizeMm, neckMm: n.sizeMm, upsizedFromMm: null }); return; }
    for (const l of n.legs || []) {
      if (l.assembly) walk(l.assembly);
      else out.push({ legMm: l.legMm, neckMm: l.neckMm, upsizedFromMm: l.upsizedFromMm });
    }
  };
  walk(assembly);
  return out;
}

/** A one-line reason an inlet cannot reach these necks. */
export function whyNot(inletMm, necks) {
  const wanted = [...(necks || [])].map(Number).filter(n => n > 0);
  const reach = maxOutletsFrom(inletMm);

  // The root cause first, where there is one: a size nothing stocked takes.
  // "Reaches at most one outlet" is true of a ø300 and does not say why.
  if (wanted.length > 1 && !partsForInlet(inletMm).length) {
    return 'Nothing NAC stock takes a \u00f8' + inletMm + ' inlet, so a \u00f8' + inletMm
      + ' duct can only run straight to one outlet. This one has to feed ' + wanted.length + '.';
  }
  if (wanted.length > reach) {
    return 'A ø' + inletMm + ' main reaches at most ' + reach + ' outlet(s) with the '
      + 'fittings NAC stock, and this one has to feed ' + wanted.length + '. Split it into '
      + Math.ceil(wanted.length / reach) + ' mains, or supply the fittings that are still '
      + 'unspecified (DB6, B9, B8, and the DY18 and DY12 outlets).';
  }
  const tooBig = wanted.filter(n => n > inletMm);
  if (tooBig.length) {
    return 'An outlet needs a ø' + Math.max(...tooBig) + ' neck off a ø' + inletMm
      + ' main. No stocked fitting makes a leg bigger than its inlet.';
  }
  const legSizes = [...new Set(PART_OPTIONS.filter(p => p.inletMm === Number(inletMm))
    .flatMap(p => p.legsMm))].sort((a, b) => a - b);
  if (!legSizes.length) {
    return 'Nothing NAC stock takes a ø' + inletMm + ' inlet, so a ø' + inletMm
      + ' duct can only run straight to one outlet.';
  }
  return 'No combination of the stocked fittings reaches these outlets from a ø'
    + inletMm + ' main: ' + wanted.map(n => 'ø' + n).join(', ') + '. The legs available '
    + 'on a ø' + inletMm + ' inlet are ' + legSizes.map(l => 'ø' + l).join(', ') + '.';
}

/**
 * Can every main in this design be built from stocked parts?
 *
 * Reads the design's own network — the mains off the plenum, and the outlet
 * each final duct feeds — so it answers for the design as it stands rather
 * than for an idealised one.
 */
export function checkDesignAssemblies(design) {
  const sections = design?.network?.sections || [];
  const mains = sections.filter(s => s.role === 'main');
  const byParent = new Map();
  for (const s of sections) {
    if (!byParent.has(s.parentId)) byParent.set(s.parentId, []);
    byParent.get(s.parentId).push(s);
  }
  const finalsUnder = (id) => {
    const out = [];
    const walk = (sid) => {
      for (const c of byParent.get(sid) || []) {
        if (c.role === 'final') out.push(c); else walk(c.id);
      }
    };
    walk(id);
    return out;
  };

  const rows = [];
  for (const m of mains) {
    const finals = finalsUnder(m.id);
    const necks = finals.map(f => Number(f.diameterMm) || 0).filter(Boolean);
    const assembly = solveAssembly(m.diameterMm, necks);
    rows.push({
      mainId: m.id,
      mainKey: m.mainKey || null,
      inletMm: Number(m.diameterMm) || null,
      outletCount: necks.length,
      necksMm: necks,
      buildable: !!assembly,
      assembly,
      parts: assembly ? partsIn(assembly) : [],
      partsCost: assembly ? partsIn(assembly).reduce((n, p) => n + p.lineTotal, 0) : null,
      upsized: assembly ? outletsIn(assembly).filter(o => o.upsizedFromMm) : [],
      reason: assembly ? null : whyNot(m.diameterMm, necks)
    });
  }

  const unbuildable = rows.filter(r => !r.buildable);
  return {
    ok: rows.length > 0 && unbuildable.length === 0,
    rows,
    unbuildable,
    partsCost: rows.every(r => r.buildable)
      ? Math.round(rows.reduce((n, r) => n + r.partsCost, 0) * 100) / 100 : null,
    summary: !rows.length ? 'No mains to check.'
      : unbuildable.length
        ? unbuildable.length + ' of ' + rows.length + ' main(s) cannot be built from the '
          + 'fittings NAC stock.'
        : 'Every main can be built from stocked fittings.'
  };
}

export default { solveAssembly, checkDesignAssemblies, partsIn, outletsIn, whyNot,
                 maxOutletsFrom, partsForInlet, PART_OPTIONS };

// ─────────────────────────────────────────────────────────────────────────────
// WHAT IS ACTUALLY A SUPPLY MAIN
//
// A supply main is one thing and one thing only: a duct leaving a spigot on the
// supply plenum. Not a room branch. Not a final run to an outlet. Not "a
// section that happens to have no parent recorded".
//
// That last one is what went wrong. The pipeline identified mains as
// `!section.parentId`, which is a definition by absence — it asks what a
// section is NOT connected to. When the router produced a flat list with no
// parent links (which it does whenever routing has not run properly), every
// duct in the job qualified. On 34 Kauri that made ten mains out of one, summed
// their airflow to 1921 L/s against 800 L/s of outlets by counting the same air
// three times over, and built a fabricated plenum 4,660 mm wide with ten ø400
// collars on it for a domestic house.
//
// None of that is a rounding error. It is a physically impossible machine, and
// it reached a bill of materials and a price.
//
// So a main is identified POSITIVELY — by its role and its attachment to the
// plenum — and the arithmetic that has to be true of any real supply system is
// asserted as an invariant rather than reported as a warning somebody can
// acknowledge. Nick: "Do not acknowledge or override this error. Correct the
// component graph."
// ─────────────────────────────────────────────────────────────────────────────

const rows = (v) => Array.isArray(v) ? v : [];
const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

/** Airflow either side of a junction never agrees to the litre. */
export const RECONCILE_TOLERANCE_LS = 1;

/**
 * The ducts that genuinely leave the supply plenum.
 *
 * A section qualifies when it says it is a main. If nothing in the network
 * claims to be a main, the answer is an empty list — NOT "everything", which is
 * what the old rule effectively returned.
 */
export function supplyMains(network) {
  const sections = rows(network?.sections);
  const mains = sections.filter(s => s.role === 'main' && s.role !== 'return');
  if (mains.length) return mains;

  // A network built before roles were recorded may still be describable: a
  // section attached to the plenum by id is a main whatever it calls itself.
  const byPlenum = sections.filter(s =>
    s.role !== 'return' && (s.parentId === 'plenum' || s.feedsFrom === 'plenum'));
  return byPlenum;
}

/** Everything downstream of a main: branches, distribution arms, finals. */
export function downstreamSections(network) {
  const sections = rows(network?.sections);
  const mainIds = new Set(supplyMains(network).map(s => s.id));
  return sections.filter(s => s.role !== 'return' && !mainIds.has(s.id));
}

/**
 * Does the supply graph describe a machine that could exist?
 *
 * Three questions, and a failure on any of them stops a quote, an approval, a
 * bill of materials, a plenum and a static-pressure calculation.
 *
 * @param {object} args
 * @param {object} args.network        the routed supply graph
 * @param {number} args.outletTotalLs  what the outlets actually deliver
 * @param {number|null} args.spigotCount  the SELECTED spigot count, when chosen
 * @returns {{ok:boolean, failures:Array, mains:Array, mainTotalLs:number}}
 */
export function checkSupplyGraph({ network, outletTotalLs, spigotCount = null } = {}) {
  const failures = [];
  const mains = supplyMains(network);
  const mainTotalLs = mains.reduce((t, s) => t + n(s.airflowLs), 0);
  const outlets = n(outletTotalLs);
  const sections = rows(network?.sections).filter(s => s.role !== 'return');

  // ── 1. THE INVARIANT ─────────────────────────────────────────────────────
  // Every litre that reaches an outlet left the plenum through a main. The two
  // totals are the same air measured at two points, so they are the same
  // number.
  if (sections.length && outlets > 0) {
    if (!mains.length) {
      failures.push({
        code: 'NO_SUPPLY_MAIN',
        severity: 'CRITICAL',
        message: 'The supply graph has ' + sections.length + ' duct(s) but none of them leaves '
          + 'the plenum. Room branches and final runs are not supply mains, so there is nothing '
          + 'to reconcile the ' + Math.round(outlets) + ' L/s of outlets against.'
      });
    } else if (Math.abs(mainTotalLs - outlets) > RECONCILE_TOLERANCE_LS) {
      const ratio = outlets > 0 ? mainTotalLs / outlets : 0;
      failures.push({
        code: 'SUPPLY_MAINS_DO_NOT_RECONCILE',
        severity: 'CRITICAL',
        message: 'The supply mains carry ' + Math.round(mainTotalLs) + ' L/s against '
          + Math.round(outlets) + ' L/s of outlets'
          + (ratio > 1.5
              ? ' — about ' + ratio.toFixed(1) + '× too much, which is what counting a room '
                + 'branch or a final run as a second main does.'
              : '.')
          + ' The same air is being counted at more than one point in the graph.',
        mainTotalLs: Math.round(mainTotalLs),
        outletTotalLs: Math.round(outlets),
        mainCount: mains.length
      });
    }
  }

  // ── 2. NOTHING IS BOTH A MAIN AND A BRANCH ───────────────────────────────
  const misfiled = mains.filter(s => s.parentId && s.parentId !== 'plenum');
  if (misfiled.length) {
    failures.push({
      code: 'MAIN_HAS_A_PARENT',
      severity: 'CRITICAL',
      message: misfiled.length + ' duct(s) are recorded as supply mains but hang off another '
        + 'duct: ' + misfiled.map(s => s.id).join(', ') + '. A main leaves the plenum.'
    });
  }

  // ── 3. THE MAINS MATCH THE SPIGOTS THEY LEAVE THROUGH ────────────────────
  if (spigotCount !== null && mains.length && mains.length !== spigotCount) {
    failures.push({
      code: 'MAIN_COUNT_NOT_SPIGOT_COUNT',
      severity: 'CRITICAL',
      message: 'The plenum has ' + spigotCount + ' selected spigot(s) but the graph carries '
        + mains.length + ' supply main(s). Every main leaves through exactly one spigot.'
    });
  }

  return { ok: failures.length === 0, failures, mains, mainTotalLs: Math.round(mainTotalLs) };
}

// ─────────────────────────────────────────────────────────────────────────────
// THE PLENUM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The widest a fabricated domestic supply plenum may be.
 *
 * A 4,660 mm plenum is not a plenum, it is a duct running the width of a house.
 * It appeared because the collar count came from the number of ducts in the
 * graph rather than the number of spigots selected, so it is caught here as a
 * hard failure rather than priced into a bill of materials.
 */
export const MAX_DOMESTIC_PLENUM_WIDTH_MM = 1800;

/**
 * Check a fabricated plenum against the spigots it is supposed to carry.
 *
 * @param {object} plenum       the arrangement record
 * @param {number} spigotCount  the SELECTED spigot count — never a duct count
 */
export function checkPlenum(plenum, spigotCount) {
  const failures = [];
  if (!plenum) return { ok: true, failures };

  const collars = plenum.collarCount ?? null;
  if (spigotCount !== null && spigotCount !== undefined && collars !== null
      && collars !== spigotCount) {
    failures.push({
      code: 'PLENUM_COLLARS_NOT_SPIGOT_COUNT',
      severity: 'CRITICAL',
      message: 'The supply plenum is drawn with ' + collars + ' collar(s) for '
        + spigotCount + ' selected spigot(s). The collar count IS the spigot count — it is '
        + 'not the number of ducts in the graph.'
    });
  }

  const width = n(plenum.bodyWidthMm);
  if (width > MAX_DOMESTIC_PLENUM_WIDTH_MM) {
    failures.push({
      code: 'PLENUM_IMPLAUSIBLY_WIDE',
      severity: 'CRITICAL',
      message: 'A ' + Math.round(width) + ' mm supply plenum is not a domestic fitting. '
        + 'Above ' + MAX_DOMESTIC_PLENUM_WIDTH_MM + ' mm this is a fabrication error, not a '
        + 'quotable part.'
    });
  }
  return { ok: failures.length === 0, failures };
}

// ─────────────────────────────────────────────────────────────────────────────
// DUCT SIZE CONSISTENCY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every supply duct honours the configured minimum branch diameter.
 *
 * The report said "Minimum supply branch ø250" in its own header and then built
 * seven ø200 branches. One source of truth means the rule and the metal agree.
 */
export function checkDuctSizes(network, minimumBranchMm) {
  const failures = [];
  const min = n(minimumBranchMm);
  if (!min) return { ok: true, failures };

  const undersized = rows(network?.sections)
    .filter(s => s.role !== 'return' && s.role !== 'main')
    .filter(s => n(s.diameterMm) > 0 && n(s.diameterMm) < min);

  if (undersized.length) {
    const sizes = [...new Set(undersized.map(s => 'ø' + s.diameterMm))].join(', ');
    failures.push({
      code: 'BRANCH_BELOW_CONFIGURED_MINIMUM',
      severity: 'CRITICAL',
      message: undersized.length + ' supply duct(s) are ' + sizes + ', under the configured '
        + 'ø' + min + ' minimum: ' + undersized.map(s => s.id).join(', ')
        + '. The configured minimum and the drawn duct must be the same number.',
      sections: undersized.map(s => ({ id: s.id, diameterMm: s.diameterMm }))
    });
  }
  return { ok: failures.length === 0, failures };
}

// ─────────────────────────────────────────────────────────────────────────────
// STATIC PRESSURE
// ─────────────────────────────────────────────────────────────────────────────

export const PRESSURE_STATUS = Object.freeze({
  CALCULATED: 'CALCULATED',
  NOT_CALCULATED: 'NOT CALCULATED — ROUTES REQUIRED'
});

/**
 * Is there enough routed length to calculate a static pressure at all?
 *
 * The Kauri report chose an index run, added its losses to 107 Pa, compared
 * that against 160 Pa available and called the check passed — with every duct
 * length recorded as zero and a total route length of 0.0 m. A pressure drop
 * over no duct is not a low pressure drop, it is an absent calculation.
 */
export function pressureReadiness(network) {
  const sections = rows(network?.sections).filter(s => s.role !== 'return');
  const total = n(network?.totalDuctLengthM);
  const measured = sections.filter(s => n(s.lengthM) > 0);

  if (!sections.length || total <= 0 || measured.length === 0) {
    return {
      ok: false,
      status: PRESSURE_STATUS.NOT_CALCULATED,
      reason: !sections.length
        ? 'No supply routes exist yet.'
        : 'Every duct length is zero — routes have not been measured, so there is nothing '
          + 'to add up. A pressure drop over no duct is not a low pressure drop.'
    };
  }
  if (measured.length < sections.length) {
    return {
      ok: false,
      status: PRESSURE_STATUS.NOT_CALCULATED,
      reason: (sections.length - measured.length) + ' of ' + sections.length + ' ducts have '
        + 'no measured length, so the index run cannot be identified.'
    };
  }

  // ── MEASURED METRES AND ALLOWED METRES ARE NOT THE SAME METRES ───────────
  // A run carrying the standard drop allowance has a length the calculation can
  // use, so the check runs. It is still an assumption, and a pressure result
  // that leans on one says which runs it leaned on rather than reading as
  // though somebody had been up in the roof with a tape.
  const onAllowance = sections.filter(s => s.lengthSource === 'standard_allowance');
  return {
    ok: true,
    status: PRESSURE_STATUS.CALCULATED,
    reason: null,
    allowanceSections: onAllowance.map(s => s.id),
    basedOnAllowances: onAllowance.length > 0,
    allowanceNote: onAllowance.length
      ? onAllowance.length + ' of ' + sections.length + ' runs carry the standard drop allowance '
        + 'rather than a measured length. Measure them before commissioning figures are relied on.'
      : null
  };
}

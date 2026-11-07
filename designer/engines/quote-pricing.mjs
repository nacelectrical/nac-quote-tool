// ─────────────────────────────────────────────────────────────────────────────
// WORKING OUT THE PRICE, FROM THE PRICES NAC HAS ENTERED
//
// Nick, 7 November 2026: "I need it to create pricing for me based on all the
// prices I have given you."
//
// Everything needed for this has been in the application for weeks, in pieces
// that never met: the MMEM supplier costs, the zone kits with their own costs,
// the per-zone accessories, the installation allowances on the Settings
// screen, and a declared pricing method. The quote screen asked the estimator
// to type one number and add all of that up in his head.
//
// THE METHOD IS NAC'S AND IT IS ALREADY WRITTEN DOWN
//
// pricing-mode.mjs: COST_PLUS_JOB_FEE — what the job costs NAC to buy and do,
// plus a fixed fee. The fee IS the margin. Nothing here invents a second way
// to arrive at a price, and nothing here is a sell price in disguise.
//
//     job cost  =  the equipment, at what NAC pays for it
//               +  the zone kit and its sensors
//               +  the installation allowances NAC has set
//     price     =  job cost + the job fee, then GST
//
// WHAT IT REFUSES TO DO
//
// Treat a number nobody has entered as zero. Every allowance ships null on
// purpose — they are NAC's own commercial figures and nobody else can supply
// them — and `Number(null)` is 0, which would quietly price a job at less than
// it costs. An allowance that is not set is reported as NOT SET and the price
// is not offered. A figure of 0 that somebody actually entered is honoured as
// zero, because that is a decision.
//
// It is a SUGGESTION. It fills the price box; it does not lock it. A typed
// price always wins, as it does everywhere else in this application.
// ─────────────────────────────────────────────────────────────────────────────

import { PRICING_MODE } from './pricing-mode.mjs';
import { supplierCostOf } from './option-pricing.mjs';
import { ZONE_CONTROLLERS, ZONE_ACCESSORIES } from './catalogue.mjs';

/** ABSENT and ZERO are different facts, and this is where they part. */
const n = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const money = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;

/** The allowances, in the order they read on the Settings screen. */
const ALLOWANCES = Object.freeze([
  ['ductwork', 'Ductwork'],
  ['returns', 'Return air'],
  ['plenums', 'Plenums'],
  ['electrical', 'Electrical'],
  ['refrigeration', 'Refrigeration'],
  ['condensate', 'Condensate'],
  ['labour', 'Installation labour'],
  ['roofAccess', 'Roof access and site difficulty'],
  ['flat', 'Installation allowance']
]);

/**
 * Price one quote-only job.
 *
 * @param {object} draft        a normalised quote draft
 * @param {object} opts         { settings, system, outlets, zones }
 * @returns {{ok, mode, lines, missing, costExGst, feeExGst, sellExGst,
 *            gstRate, gst, sellIncGst, notes }}
 */
export function priceFromCosts(draft, opts = {}) {
  const settings = opts.settings || {};
  const c = settings.commercial || {};
  const gstRate = n(c.gstRate) ?? 0.1;

  const lines = [];
  const missing = [];
  const notes = [];
  const add = (key, label, exGst, source) =>
    lines.push({ key, label, exGst: money(exGst), source });
  const cannot = (key, label, why) => missing.push({ key, label, why });

  // ── 1. THE MACHINE, AT WHAT NAC PAYS FOR IT ───────────────────────────
  const sys = opts.system || null;
  if (!sys) {
    cannot('equipment', 'Equipment', 'No system has been chosen on this quote.');
  } else {
    const cost = supplierCostOf(sys);
    if (cost.cost === null) {
      cannot('equipment', 'Equipment', cost.message);
    } else {
      // MMEM is a trade list and is quoted ex GST; a figure typed by hand may
      // be either, and the screen records which.
      const exGst = cost.gstInclusive ? cost.cost / (1 + gstRate) : cost.cost;
      add('equipment', [sys.brand, sys.model].filter(Boolean).join(' ') || 'Equipment',
          exGst, cost.source);
    }
  }

  // ── 2. THE ZONE CONTROL ───────────────────────────────────────────────
  const ctrl = draft?.controller || {};
  const kit = ZONE_CONTROLLERS.find(k => k.id === String(ctrl.id || '')) || null;
  const zoneCount = n(draft?.scope?.zoneCount) ?? 0;
  if (kit) {
    if (kit.includedInSystem) {
      notes.push(kit.name + ' is supplied with the system, so it adds nothing to the cost.');
    } else if (n(kit.cost) === null) {
      cannot('controller', 'Zone control', kit.name + ' carries no cost on the price list.');
    } else {
      add('controller', kit.name, kit.cost, kit.note || 'NAC price list');
    }
    // Per-zone accessories, where the kit takes them.
    const sensors = n(draft?.sensorCount);
    if (sensors !== null && sensors > 0) {
      const acc = ZONE_ACCESSORIES.find(a => (kit.accessoryIds || []).includes(a.id))
        || ZONE_ACCESSORIES[0] || null;
      if (!acc || n(acc.cost) === null) {
        cannot('sensors', 'Zone sensors',
          'No cost on file for the sensor that goes with ' + kit.name + '.');
      } else {
        add('sensors', sensors + ' × ' + acc.name, sensors * acc.cost,
            'NAC price list');
      }
    }
  } else if (ctrl.name) {
    cannot('controller', 'Zone control',
      '"' + ctrl.name + '" was typed by hand, so it is not on the price list and '
      + 'carries no cost. Enter what it costs, or choose a kit from the list.');
  }

  // ── 3. WHAT IT TAKES TO INSTALL ───────────────────────────────────────
  //
  // Every one of these is NAC's own figure and ships empty. Not set is not
  // zero: a job priced as though the ductwork were free is a job priced at a
  // loss, and nothing on the screen would have said so.
  const a = c.proposalAllowance || {};
  const anySet = ALLOWANCES.some(([k]) => n(a[k]) !== null)
    || n(a.perOutlet) !== null || n(a.perZone) !== null;

  if (!anySet) {
    cannot('allowances', 'Installation allowances',
      'None is set. These are NAC’s own figures — ductwork, return air, '
      + 'electrical, refrigeration and the rest — and until they are entered on '
      + 'the Settings screen this cannot say what the job costs to install.');
  } else {
    for (const [key, label] of ALLOWANCES) {
      const v = n(a[key]);
      if (v !== null) add('allow_' + key, label, v, 'NAC installation allowance');
    }
    const outlets = n(opts.outlets) ?? n(draft?.scope?.outletCount);
    const perOutlet = n(a.perOutlet);
    if (perOutlet !== null) {
      if (outlets === null) {
        cannot('perOutlet', 'Per-outlet allowance',
          'An allowance is set per outlet, and no outlet count is recorded.');
      } else {
        add('allow_perOutlet', outlets + ' outlet(s) at $' + perOutlet.toFixed(2),
            outlets * perOutlet, 'NAC installation allowance');
      }
    }
    const perZone = n(a.perZone);
    if (perZone !== null) {
      if (!zoneCount) {
        cannot('perZone', 'Per-zone allowance',
          'An allowance is set per zone, and no zone count is recorded.');
      } else {
        add('allow_perZone', zoneCount + ' zone(s) at $' + perZone.toFixed(2),
            zoneCount * perZone, 'NAC installation allowance');
      }
    }
  }

  // ── 4. CONTINGENCY, WHERE NAC CARRIES ONE ─────────────────────────────
  let costExGst = money(lines.reduce((t, l) => t + l.exGst, 0));
  const pct = n(a.contingencyPct);
  if (pct !== null && pct > 0 && !missing.length) {
    const amount = costExGst * (pct / 100);
    add('contingency', 'Contingency at ' + pct + '%', amount, 'NAC setting');
    costExGst = money(costExGst + amount);
  }

  // ── 5. THE FEE, WHICH IS THE MARGIN ───────────────────────────────────
  const feeRaw = n(c.jobFee);
  let feeExGst = null;
  if (feeRaw === null) {
    cannot('jobFee', 'Job fee',
      'No job fee is set. On NAC’s method the fee IS the margin, so without it '
      + 'there is no price to work out.');
  } else {
    feeExGst = c.jobFeeExGst === false ? money(feeRaw / (1 + gstRate)) : money(feeRaw);
  }

  const ok = missing.length === 0 && feeExGst !== null && lines.length > 0;
  const sellExGst = ok ? money(costExGst + feeExGst) : null;
  const gst = ok ? money(sellExGst * gstRate) : null;

  return {
    ok,
    mode: PRICING_MODE.COST_PLUS_JOB_FEE,
    lines,
    missing,
    notes,
    costExGst: lines.length ? costExGst : null,
    feeExGst,
    sellExGst,
    gstRate,
    gst,
    // What goes in the price box. Rounded to the dollar, because NAC quotes in
    // whole dollars and a customer reading $17,816.73 reads a machine's answer.
    sellIncGst: ok ? Math.round(sellExGst + gst) : null
  };
}

export default { priceFromCosts, ALLOWANCES };

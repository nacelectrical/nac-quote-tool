// NAC AI HVAC DESIGNER — what goes in the two documents.
//
// ONE SOURCE, TWO RENDERERS.
//
// The internal sheet and the customer summary used to be built as HTML strings.
// The PDF has to carry the same content, and two separate builders is how a
// supplier cost ends up in a customer document by accident. So the content is
// decided here, once, as plain data; designer/ui/report-html.mjs turns it into
// a print page and designer/ui/report-pdf.mjs into a PDF file. Neither renderer
// knows anything about HVAC, and neither can add a figure this file withheld.
//
// The customer document is defined by what it CONTAINS, not by what is stripped
// out of the internal one: customerReportDoc builds its own block list from
// scratch and never touches d.bom, d.labour or d.commercials. There is a test
// (tests/report-doc.test.mjs) that scans the finished customer document for any
// dollar figure, margin, supplier or cost wording and fails if one appears.

import { AUTO_ROUTE_NOTICE } from './router.mjs';
import { isConditionedRoom } from './classify.mjs';

export const REPORT_KIND = { INTERNAL: 'internal', CUSTOMER: 'customer' };

const money = (n) => n === null || n === undefined || !isFinite(n) ? '—'
  : '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const nn = (n, dp = 1) => n === null || n === undefined || !isFinite(n) ? '—' : Number(n).toFixed(dp);
const str = (v) => v === null || v === undefined ? '—' : String(v);

// ── Block constructors ─────────────────────────────────────────────────────
const h2      = (text) => ({ t: 'h2', text });
const kv      = (items) => ({ t: 'kv', items: items.map(([l, v, s]) => [str(l), str(v), s ? String(s) : '']) });
const note    = (text) => ({ t: 'note', text: String(text) });
const flag    = (level, text) => ({ t: 'flag', level, text: String(text) });
const bullets = (items) => ({ t: 'bullets', items: items.map(String) });
const image   = (src, caption) => ({ t: 'image', src, caption: caption || '' });
const pageBreak = () => ({ t: 'pagebreak' });
/**
 * START A NEW PAGE ONLY IF THERE IS NOT ENOUGH LEFT OF THIS ONE.
 *
 * Nick: "Page 5 is mostly blank. Allow tables to continue naturally so the
 * internal report does not contain an unnecessarily empty page."
 *
 * A hard break before each major section did that: the room loads ran five rows
 * onto a fresh page, the break after it threw the rest of that page away, and
 * the sheet carried a sheet of paper with five numbers on it. A section only
 * needs its own page when what is left of this one cannot hold its heading and
 * the first few rows — so that is the question asked, instead of breaking every
 * time regardless.
 */
const softBreak = (min = 170) => ({ t: 'softbreak', min });
/**
 * A FLOOR PLAN ON ITS OWN LANDSCAPE SHEET.
 *
 * Nick: "A dedicated landscape floor-plan page." A house plan is wider than it
 * is tall, so on a portrait page it is scaled to the narrow dimension and the
 * duct sizes stop being readable — which makes the one page an installer
 * actually carries the one page that does not work. A PDF carries a MediaBox
 * per page, so this block turns itself sideways and nothing else changes.
 */
const planPage = (src, caption, legend) =>
  ({ t: 'planpage', src, caption: caption || '', legend: legend || null });
/** An enlarged crop of the equipment area, printed at a size you can read. */
const inset = (src, caption) => ({ t: 'inset', src, caption: caption || '' });

/** cols: [{ label, r?, w? }]; rows built through `get` so the cells are strings. */
function table(cols, rows, get) {
  return {
    t: 'table',
    cols: cols.map(c => ({ label: c.label, r: !!c.r, w: c.w || null })),
    rows: (rows || []).map(r => get(r).map(str))
  };
}

export const ENGINEERING_DISCLAIMER =
  'Design calculations are installation estimates based on the information entered and/or ' +
  'detected from the uploaded plans. Final room measurements, equipment selection, airflow, ' +
  'static pressure, duct installation and commissioning must be verified against manufacturer ' +
  'specifications and actual site conditions.';

function header(design, title, kind) {
  return {
    kind,
    title,
    designId: design.id || '',
    jobDescription: design.job?.description || '',
    dateText: new Date().toLocaleDateString('en-AU'),
    customer: {
      name: design.customer?.name || '—',
      address: design.customer?.address || '—',
      phone: design.customer?.phone || '—',
      email: design.customer?.email || '—'
    },
    abn: '97 636 392 982',
    business: 'NAC Electrical Air & Refrigeration',
    website: 'nacelectrical.com.au'
  };
}

/** THE INTERNAL HVAC DESIGN SHEET — the full working, NAC only. */
export function internalReportDoc(design, { planSnapshot = null,
                                            planPlate = null,
                                            planLegend = null,
                                            equipmentInset = null,
                                            btoDetails = [] } = {}) {
  const d = design;
  const load = d.systemLoad, u = d.selectedUnit;
  const b = [];

  b.push(h2('Design summary'));
  b.push(kv([
    ['Conditioned area', nn(load?.totalConditionedAreaSqM, 2) + ' m²', (load?.roomCount || 0) + ' rooms'],
    ['Design cooling', nn(load?.designCoolingKw, 2) + ' kW', nn(load?.averageWattsPerM2, 0) + ' W/m²'],
    ['Design heating', nn(load?.designHeatingKw, 2) + ' kW'],
    ['NAC 145 W/m² rule', nn(load?.legacy?.kw, 1) + ' kW',
      (load?.varianceVsLegacyPct > 0 ? '+' : '') + nn(load?.varianceVsLegacyPct, 1) + '% variance'],
    ['Selected system', u ? u.brandName + ' ' + u.model : '—', u ? u.capacityKw + ' kW ' + u.phase : ''],
    ['Total airflow', (d.airflow?.allocatedAirflowLs ?? '—') + ' L/s'],
    ['Outlets', d.outlets?.totals?.total ?? '—'],
    ['Zones', d.zones?.zoneCount ?? '—', d.controller?.name || ''],
    ['Total duct length', nn(d.network?.totalDuctLengthM, 1) + ' m'],
    ['Return', d.returnDesign
      ? d.returnDesign.returnCount + ' × ' + (d.returnDesign.returns?.[0]?.grilleSize || '') : '—',
      d.returnDesign ? d.returnDesign.perReturnLs + ' L/s each' : ''],
    ['Estimated static', nn(d.pressure?.estimatedRequirementPa, 0) + ' Pa',
      d.pressure && !d.pressure.checkCompleted ? d.pressure.statusLabel
        : d.pressure?.unitAvailableStaticPa ? 'of ' + d.pressure.unitAvailableStaticPa + ' Pa available'
        : 'unit ESP not on file'],
    ['Plan calibration', d.calibration ? nn(d.calibration.pixelsPerMm, 5) + ' px/mm' : 'NOT CALIBRATED'],
    // THE RULES THIS JOB WAS DESIGNED TO, ON THE JOB'S OWN SHEET. They travel
    // with the design, so an installer opening it in six months gets the sizes
    // it was approved with — and can see which of them are this job's own.
    ['Minimum supply branch', d.designRules
      ? 'ø' + d.designRules.minimumSupplyBranchDiameterMm : '—',
      d.designRules?.source?.minimumSupplyBranchDiameterMm === 'design'
        ? 'set on this job' : 'application default'],
    ['Minimum BTO-to-outlet run', d.designRules
      ? nn(d.designRules.minimumBtoToOutletDuctLengthM, 1) + ' m' : '—',
      d.designRules?.source?.minimumBtoToOutletDuctLengthM === 'design'
        ? 'set on this job' : 'application default']
  ]));

  // ── CAN THIS BE QUOTED? SAID ON PAGE ONE ────────────────────────────────
  //
  // The internal sheet is always produced; a customer quote is not. Whoever is
  // holding this needs to know which of the two they have before they get to
  // the costing on the last page.
  if (d.quoteGate && !d.quoteGate.ok) {
    b.push(flag('warn', 'CUSTOMER QUOTE BLOCKED — ' + d.quoteGate.summary + ' ' +
      d.quoteGate.blockers.map(x => x.code).join(', ') + '. This internal design sheet ' +
      'is complete and may be used; the customer quote cannot be finalised or issued ' +
      'until the pricing below is resolved.'));
  }

  // ── PAGE 1 CARRIES THE THINGS THAT STOP THE JOB ─────────────────────────
  //
  // Nick: "Page 1: summary and major warnings." A CRITICAL that only appears on
  // page 7 is a CRITICAL nobody reads before they order the equipment. The full
  // warning schedule still prints later; these are the ones that block approval,
  // stated where the sheet opens.
  const majorWarnings = (d.warnings || []).filter(w => w.severity === 'CRITICAL');
  if (majorWarnings.length) {
    b.push(h2('Major warnings'));
    for (const w of majorWarnings) {
      b.push(flag('crit', 'CRITICAL — ' + w.code + '. ' + w.message + ' ' +
        (w.acknowledged
          ? 'Acknowledged by ' + w.acknowledgedBy + ' on ' +
            new Date(w.acknowledgedAt).toLocaleString('en-AU') + '.'
          : 'NOT ACKNOWLEDGED — this design cannot be approved until it is.')));
    }
  }

  if (planSnapshot) {
    // The plan gets a sheet of its own, turned sideways, at the biggest size it
    // will go. Everything that explains it goes with it.
    // `planPlate` is the drawing WITHOUT the key baked into it, and `planLegend`
    // is the key on its own — captured apart so the landscape page can set the
    // drawing to the full height of the paper and stand the key beside it.
    b.push(planPage(planPlate || planSnapshot,
      'Rooms, duct routes and equipment positions as marked up in NAC AI HVAC Designer. ' +
      'Duct colour is SIZE, never zone: ø400 magenta · ø350 purple · ø300 green · ø250 amber · ' +
      'ø200 blue · return dashed grey. Line weight follows diameter. Every size is also ' +
      'written on its run, so the drawing does not depend on colour alone.',
      planPlate ? planLegend : null));
    b.push(h2('Floor plan overlay'));
    if (d.autoRoute?.generated) {
      b.push(note(AUTO_ROUTE_NOTICE));
      b.push(note('This layout was generated automatically at ' +
        (d.autoRoute.confidence || 'unknown') + ' confidence. A floor plan does not show ' +
        'trusses, bulkheads, beams, inaccessible roof zones or existing services. Route ' +
        'positions are a first-pass design suggestion and must be confirmed on site.'));
    }
  }

  if (equipmentInset) {
    // ── THE EQUIPMENT AREA, ENLARGED ──────────────────────────────────────
    //
    // At whole-house scale the fan coil, its two plenums and five collars are
    // about a centimetre of paper. This is the crop an installer sets the unit
    // from, so it prints large and says exactly what is in it.
    b.push(h2('Equipment arrangement'));
    b.push(inset(equipmentInset,
      'RETURN PLENUM → FAN COIL → SUPPLY PLENUM, enlarged from the plan above.'));
    const mains = (d.network?.sections || []).filter(s => s.role === 'main' && !s.parentId);
    b.push(bullets([
      'Return plenum fitted to the fan-coil intake face, carrying ' +
        ((d.returnComponents?.ducts || []).length || d.returnDesign?.returnCount || 0) +
        ' × ø' + (d.returnDesign?.ductDiameterMm || 400) + ' return inlet collars.',
      'Fan-coil body: ' + (u ? u.brandName + ' ' + u.model : 'unit not selected') + '.',
      'Supply plenum fitted to the fan-coil discharge face, carrying ' +
        mains.length + ' × ø' + (mains[0]?.diameterMm || 400) + ' outlet collars.',
      'Return-air arrows point TOWARD the fan coil; supply-air arrows point AWAY from it.',
      mains.length
        ? 'Supply mains off the plenum: ' + mains.map(m =>
            'Main ' + m.mainKey + ' ø' + m.diameterMm + ' ' + m.airflowLs + ' L/s').join(' · ')
        : 'No supply mains have been routed.',
      'Each main terminates at its own BTO. Main C feeds BTO-C, which is downstream of ' +
        'the main and is not bolted to the plenum.',
      'The return path never joins a supply main, a supply plenum or any BTO. Where a ' +
        'return crosses a supply duct the lower run is broken and bridged — that is a ' +
        'crossing, not a connection.'
    ]));
  }

  b.push(h2('Room schedule'));
  b.push(table(
    [{ label: 'Room', w: 2.2 }, { label: 'Width (m)', r: true }, { label: 'Length (m)', r: true },
     { label: 'Area (m²)', r: true }, { label: 'Ceiling (m)', r: true }, { label: 'Cond.' },
     { label: 'Source', w: 1.8 },
     // Wide enough for the word. At the default it broke as CONFIDENC / E.
     { label: 'Confidence', r: true, w: 1.35 }, { label: 'Status' }],
    d.rooms || [],
    r => [r.label, r.widthMm ? (r.widthMm / 1000).toFixed(2) : '—',
          r.lengthMm ? (r.lengthMm / 1000).toFixed(2) : '—', nn(r.areaSqM, 2),
          (r.ceilingHeightMm / 1000).toFixed(2), isConditionedRoom(r) ? 'Yes' : 'No',
          r.measurement?.sourceLabel || '—', Math.round(r.confidence) + '% ' + r.confidenceBand, r.status]));

  if (load) {
    b.push(h2('Room loads'));
    b.push(table(
      [{ label: 'Room', w: 2.2 }, { label: 'Area (m²)', r: true }, { label: 'Cooling (W)', r: true },
       { label: 'Heating (W)', r: true }, { label: 'W/m²', r: true }, { label: '% of total', r: true },
       { label: 'Override', w: 2 }],
      load.rooms,
      r => [r.label, nn(r.areaSqM, 2), r.coolingW, r.heatingW, r.wattsPerM2, r.shareOfTotal + '%',
            r.overridden ? 'YES — ' + (r.overrideNote || '') : '']));
  }

  if (d.airflow) {
    b.push(softBreak());
    b.push(h2('Airflow'));
    b.push(table(
      [{ label: 'Room', w: 2.2 }, { label: 'Load (W)', r: true }, { label: 'Recommended (L/s)', r: true },
       { label: 'Design (L/s)', r: true }, { label: '% of system', r: true }, { label: 'Override' }],
      d.airflow.rows,
      r => [r.label, r.loadW, r.recommendedLs, r.adjustedLs, r.systemSharePct + '%', r.overridden ? 'YES' : '']));
  }

  if (d.outlets) {
    b.push(h2('Outlets'));
    b.push(table(
      [{ label: 'Room', w: 2 }, { label: 'Type', w: 1.8 }, { label: 'Qty', r: true },
       { label: 'Airflow (L/s)', r: true }, { label: 'Per outlet (L/s)', r: true }],
      d.outlets.rows,
      r => [r.label, r.typeLabel, r.quantity, r.airflowLs, r.perOutletLs]));
  }

  if (d.network) {
    b.push(h2('Ductwork'));
    b.push(table(
      [{ label: 'Run' }, { label: 'Serves', w: 2 }, { label: 'Role' }, { label: 'Feeds from' },
       { label: 'Airflow (L/s)', r: true }, { label: 'Diameter (mm)', r: true },
       { label: 'Velocity (m/s)', r: true }, { label: 'Length (m)', r: true },
       // SPELLED OUT, NOT A GREEK DELTA. WinAnsi has no Δ, so every PDF reader
       // got an ASCII stand-in and the column read "dp (Pa)" — which is not a
       // thing. The words cost four characters and mean what they say.
       { label: 'Pressure drop (Pa)', r: true }, { label: 'Reducer' }],
      d.network.sections,
      r => [r.id, r.destination, r.role, r.parentId || '—', r.airflowLs, r.diameterMm,
            r.velocityMs, r.lengthM || '—', r.pressureDropPa,
            r.reducerFrom ? r.reducerFrom + '→' + r.reducerTo : '—']));
    if (d.network.routed) {
      b.push(note('Lengths are measured from the routed layout on the calibrated plan, not ' +
        'estimated — that is the duct that has to be bought, hung and pushed air through. ' +
        (d.network.junctionCount || 0) + ' junction(s) and ' + (d.network.reducerCount || 0) +
        ' reducer(s) are in this system.'));
    }
    // THE FABRICATED PLENUM, SCHEDULED. It is the one piece of metal on this
    // job that is made to a drawing rather than bought off a shelf, so it gets
    // its own row — and the row, the BOM line, the fabrication warning and the
    // symbol on the plan all read the same record.
    // ── HOW THE SUPPLY SPIGOT ARRANGEMENT WAS DECIDED ───────────────────
    //
    // Nick: "Do not use outlet count as the deciding rule." So the working is
    // printed: every arrangement that was available, what it would have done,
    // and the reason each rejected one is not possible on this job.
    if (d.spigotSelection) {
      const sel = d.spigotSelection;
      b.push(kv([
        ['Supply spigots', sel.chosen ? sel.chosen.text : 'NONE AVAILABLE',
          sel.chosen ? sel.chosen.perDuctAirflowLs + ' L/s per main at ' +
            sel.chosen.velocityMs + ' m/s' : ''],
        ['Decided on', sel.basis, 'outlet count is an input, not the rule'],
        ['Installer areas', sel.inputs.installerAreaCount ?? '—',
          sel.chosen ? sel.chosen.count + ' main(s)' : ''],
        ['Longest main', sel.inputs.longestMainRouteM == null ? '—'
          : sel.inputs.longestMainRouteM + ' m',
          sel.chosen ? sel.chosen.mainLossPa + ' Pa of loss along it' : ''],
        ['Available static', sel.inputs.availableStaticPa == null
          ? 'UNVERIFIED' : sel.inputs.availableStaticPa + ' Pa',
          sel.inputs.unit || ''],
        ['Discharge flange', sel.inputs.supplyFlangeText || 'UNVERIFIED',
          sel.chosen ? sel.chosen.collarRowMm + ' mm of collar face needed' : ''],
        ['Roof clearance', sel.inputs.roofClearanceMm == null
          ? 'NOT MEASURED' : sel.inputs.roofClearanceMm + ' mm',
          sel.chosen ? 'ø' + sel.chosen.diameterMm + ' insulated flex needs ' +
            sel.chosen.roofClearanceRequiredMm + ' mm' : '']
      ]));
      if (sel.ranked.length > 1 || sel.rejected.length) {
        b.push(table(
          [{ label: 'Arrangement', w: 1.2 }, { label: 'L/s per main', r: true },
           { label: 'm/s', r: true }, { label: 'Main loss Pa', r: true },
           { label: 'Plenum', w: 1.2 }, { label: 'Result', w: 2.4 }],
          [...sel.ranked, ...sel.rejected],
          r => [r.text, r.perDuctAirflowLs, r.velocityMs, r.mainLossPa,
                r.plenumWidened ? 'widened' : 'flush',
                !r.feasible ? 'NOT POSSIBLE — ' + r.blockers.map(x => x.message).join(' ')
                  : (sel.chosen && r.key === sel.chosen.key ? 'CHOSEN' : 'possible')]));
      }
      if (d.spigotOverride?.differsFromRecommendation) {
        b.push(flag('warn', 'INSTALLER OVERRIDE — this job is built as ' +
          d.spigotOverride.selected.text + '. The engine would have chosen ' +
          d.spigotOverride.recommended.text + '. Chosen by ' +
          (d.spigotOverride.by || 'the installer') + ' on ' + d.spigotOverride.at +
          (d.spigotOverride.reason ? ': ' + d.spigotOverride.reason : '') + '.'));
      }
      if (d.spigotSelectionDiffers) {
        b.push(note(d.spigotSelectionDiffers.message));
      }
      if (sel.unverified.length) {
        b.push(note('Not everything could be checked: ' + sel.unverified.join(', ') +
          '. Those checks were NOT performed rather than performed against an ' +
          'assumed figure.'));
      }
    }

    if (d.supplyPlenum) {
      b.push(kv([
        // A SUMMARY CARD IS A SUMMARY. The engine's full description is three
        // lines long and lost its last clause to the bottom of the box; the
        // whole sentence is on the BILL OF MATERIALS line and in the
        // fabrication warning, which is where somebody ordering it reads it.
        ['Supply plenum', d.supplyPlenum.kind === 'widened'
          ? 'FABRICATED TRANSITION' : 'Flush to the discharge',
          d.supplyPlenum.kind === 'widened'
            ? d.supplyPlenum.flangeWidthMm + ' mm throat widening to ' +
              d.supplyPlenum.bodyWidthMm + ' mm'
            : 'no transition needed'],
        ['Discharge flange', d.supplyPlenum.flangeWidthMm
          ? d.supplyPlenum.flangeWidthMm + ' × ' + d.supplyPlenum.flangeHeightMm + ' mm' : '—',
          'the fan-coil face the plenum bolts to'],
        ['Collar face', d.supplyPlenum.bodyWidthMm + ' mm',
          d.supplyPlenum.kind === 'widened'
            ? d.supplyPlenum.wideningMm + ' mm wider than the flange'
            : 'same width as the flange'],
        ['Collars', d.supplyPlenum.collarCount + ' × ø' + d.supplyPlenum.collarDiameterMm,
          d.supplyPlenum.collarRowMm + ' mm of collar plus gaps, in one row']
      ]));
    }
  }

  // ── THE BTO FABRICATION SCHEDULE ────────────────────────────────────────
  //
  // What the sheet-metal shop makes. Every collar, what goes through it and
  // where it goes — enough to cut the metal from without opening the drawing.
  // Nick: "BTO branch take-off Ø400 — 3 ports is insufficient."
  const btoRows = d.schedules?.bto || [];
  if (btoRows.length) {
    b.push(h2('BTO fabrication schedule'));
    b.push(table(
      [{ label: 'BTO', w: 0.8 }, { label: 'Configuration', w: 2.2 },
       { label: 'Inlet (L/s)', r: true }, { label: 'Collars', r: true },
       { label: 'Body L × W × H (mm)', w: 1.6 }, { label: 'Collar faces', w: 1.2 },
       { label: 'Layout', w: 1.5 },
       { label: 'Configuration key', w: 1.8 }, { label: 'Price', w: 1.2 }],
      btoRows,
      r => [r.id, r.shapeText, r.inletAirflowLs, r.outletCollarCount,
            r.bodyText || '—',
            (r.facesUsed || []).length ? (r.facesUsed || []).length + ' faces' : '—',
            r.fabricationReady ? 'VALIDATED'
              : (r.layoutPass === false ? 'FAILS — does not fit' : 'PROPOSED — review'),
            r.configKey,
            r.priceStatus === 'VERIFIED'
              ? '$' + Number(r.cost).toFixed(2) + (r.quoteRef ? ' · ' + r.quoteRef : '')
              : r.priceStatus]));
    // EVERY COLLAR, BY DESTINATION. The table above says what the fitting IS;
    // this says what each spigot is for, which is what gets it connected to the
    // right room in a roof at four in the afternoon.
    for (const r of btoRows) {
      b.push(bullets([r.id + ' — ' + r.shapeText + ', ' + r.inletAirflowLs + ' L/s in:',
                      ...r.collarLines]));
    }

    // ── WHERE EVERY COLLAR PHYSICALLY GOES ────────────────────────────────
    //
    // Nick: "A body dimension cannot be derived only from the largest collar or
    // inlet ... three Ø250 collars cannot be declared to fit across a 400 mm or
    // 450 mm face." So the box is laid out collar by collar on named faces and
    // the working is printed: face, centre, outside diameter, edge clearance,
    // clearance to the neighbour, seam allowance, required against available.
    b.push(softBreak());
    b.push(h2('BTO collar face layout'));
    b.push(note('Face layout is calculated per collar against fabrication allowances — ' +
      'collar wall, ' + (btoRows[0]?.faceLayout?.allowances?.edgeClearanceMm ?? '—') +
      ' mm edge clearance, ' +
      (btoRows[0]?.faceLayout?.allowances?.collarClearanceMm ?? '—') +
      ' mm between neighbouring collars and ' +
      (btoRows[0]?.faceLayout?.allowances?.seamAllowanceMm ?? '—') +
      ' mm of lock seam at each corner. These are geometric allowances, not a ' +
      'fabricator\u2019s catalogue. A body worked out from them is a PROPOSAL and is ' +
      'never reported as validated; validation happens against a body the fabricator ' +
      'confirms, and it can fail.'));
    for (const r of btoRows) {
      b.push(kv([
        ['Fitting', r.id, r.shapeText],
        ['Body', r.bodyText || '—', r.dimensionsSource === 'configured'
          ? 'confirmed by the fabricator' : 'proposed — ' + (r.proposedBodyText || '')],
        ['Collar faces used', (r.facesUsed || []).join(', ') || '—',
          r.multiFace ? 'collars are distributed across more than one face' : 'one face'],
        ['Layout result', r.layoutPass ? 'PASS' : 'FAIL',
          r.layoutStatus || ''],
        ['Fabrication-ready', r.fabricationReady ? 'Yes' : 'No',
          r.fabricationReady ? 'a real body, with the collars laid out on it'
            : 'a proposal — not to be cut from']
      ]));
      b.push(bullets(r.collarFaceLines || []));
      if ((r.unplacedCollars || []).length) {
        b.push(flag('crit', 'CRITICAL — ' + r.id + ': ' +
          r.unplacedCollars.map(u => 'ø' + u.nominalDiameterMm + ' → ' +
            (u.destination || 'not connected') + '. ' + u.reason).join(' ')));
      }
      for (const i of (r.fitIssues || [])) {
        if (i.code === 'COLLARS_EXCEED_AVAILABLE_SPACE') continue;   // said above
        b.push(flag('crit', 'CRITICAL — ' + r.id + ': ' + i.message));
      }
    }
    // The development drawing: inlet face, outlet faces, collar sizes, collar
    // locations, body dimensions — the sheet the shop marks out from.
    if ((btoDetails || []).length) {
      b.push(softBreak(200));
      b.push(h2('BTO fabrication details'));
      for (const det of btoDetails) {
        if (!det?.src) continue;
        b.push(inset(det.src, det.caption || det.label || ''));
      }
    }

    const failing = d.schedules?.btoFailingCollarLayout || [];
    if (failing.length) {
      b.push(flag('crit', 'CRITICAL — the collars on ' + failing.join(', ') + ' do not ' +
        'physically fit the body recorded against them. Do not cut metal to these ' +
        'dimensions: either the body grows, or the collars move to another face, or the ' +
        'fabricator supplies dimensions and collar positions that work.'));
    }
    const review = d.schedules?.btoNeedingFabricationReview || [];
    if (review.length) {
      b.push(flag('warn', 'FABRICATION REVIEW REQUIRED — ' + review.join(', ') + '. Their ' +
        'body dimensions are a PROPOSAL worked out from a collar-by-collar face layout, ' +
        'not a fabricator\u2019s standard body, and they are NOT fabrication-ready. The ' +
        'required collar layout is printed below. Enter the fabricator\u2019s confirmed ' +
        'dimensions and collar positions and they replace the proposal everywhere — ' +
        'schedule, order and price.'));
    }
    const noPrice = d.schedules?.btoNeedingPrice || [];
    if (noPrice.length) {
      b.push(flag('crit', 'CRITICAL — ' + noPrice.join(', ') + ' have no confirmed price for ' +
        'their exact configuration. A ø400 three-port and a ø350 three-port are different ' +
        'fittings; neither can be priced off the other. The customer quote is blocked until ' +
        'a fabricator\u2019s rate is entered against each configuration key.'));
    }
  }

  // ── THE MOTORISED ZONE-DAMPER SCHEDULE ──────────────────────────────────
  //
  // Every motor on the job, at the size of the duct it is fitted in. There is
  // no manual balancing damper on this schedule because there is none on the
  // job: the design balances with duct size and motorised zone control.
  const damperRows = d.schedules?.zoneDampers || [];
  if (damperRows.length) {
    b.push(h2('Motorised zone dampers'));
    b.push(table(
      [{ label: 'ID', w: 0.6 }, { label: 'Zone', w: 1.6 }, { label: 'Duct section', w: 1.8 },
       { label: 'ø (mm)', r: true }, { label: 'Airflow (L/s)', r: true },
       { label: 'Velocity (m/s)', r: true }, { label: 'Actuator' },
       { label: 'SKU' }, { label: 'Cost', r: true }],
      damperRows,
      r => [r.id, r.zone, r.ductSection, r.diameterMm, r.airflowLs, r.velocityMs,
            r.actuator, r.sku || '—',
            r.cost === null || r.cost === undefined ? r.priceStatus : '$' + Number(r.cost).toFixed(2)]));
    b.push(note('A motorised zone damper is the diameter of the duct it is fitted in. ' +
      'Change the duct size on site and the damper, its symbol, this schedule, its part ' +
      'number and its price all change with it. No manual balancing dampers are used on ' +
      'this design.'));
    const mismatch = d.schedules?.damperSizeMismatches || [];
    if (mismatch.length) {
      b.push(flag('crit', 'CRITICAL — ' + mismatch.join(', ') + ' are set to a diameter that ' +
        'does not match the duct they sit in. A damper that does not match its duct cannot ' +
        'be installed.'));
    }
  }

  if (d.returnDesign) {
    b.push(h2('Return air'));
    b.push(table(
      [{ label: '#', r: true }, { label: 'Airflow (L/s)', r: true }, { label: 'Grille' },
       { label: 'Free area (m²)', r: true }, { label: 'Face velocity (m/s)', r: true }],
      d.returnDesign.returns,
      r => [r.index, r.airflowLs, r.grilleSize, r.freeAreaM2, r.faceVelocityMs]));
    b.push(note('Filter ' + (d.returnDesign.filter?.size ?? '—') + ' at ' +
      (d.returnDesign.filter?.faceVelocityMs ?? '—') + ' m/s. Return duct ' +
      (d.returnDesign.duct?.diameterMm ?? '—') + ' mm at ' + (d.returnDesign.duct?.velocityMs ?? '—') + ' m/s.'));
  }

  if (d.zones) {
    b.push(h2('Zones'));
    b.push(table(
      [{ label: 'Zone', w: 1.6 }, { label: 'Rooms', w: 3 }, { label: 'Type' },
       { label: 'Airflow (L/s)', r: true }, { label: '% of system', r: true }, { label: 'Always open' }],
      d.zones.zones,
      r => [r.name, (r.rooms || []).join(', '), r.kind, r.airflowLs, r.systemSharePct + '%',
            r.alwaysOpen ? 'Yes' : '']));
    b.push(note('Minimum open airflow ' + d.zones.minimumOpenAirflowLs + ' L/s (' +
      d.zones.minimumOpenFractionPct + '% of system); required ' + d.zones.requiredMinimumLs +
      ' L/s. ' + (d.zones.bypassNote || '')));
  }

  if (d.pressure) {
    b.push(h2('Static pressure'));
    // The three states are spelled out. A document that simply omitted the
    // comparison would let a reader assume the design cleared it.
    if (d.pressure.status !== 'pass') {
      b.push(flag(d.pressure.status === 'fail' ? 'crit' : 'warn', d.pressure.statusLabel));
    }
    b.push(table(
      [{ label: 'Component', w: 2 }, { label: 'Detail', w: 3 }, { label: 'Pa', r: true }],
      d.pressure.components,
      r => [r.item, r.detail, r.pa]));
    b.push(note('Estimated requirement ' + d.pressure.estimatedRequirementPa + ' Pa. Unit available ' +
      (d.pressure.unitAvailableStaticPa ?? 'not on file') + '. Margin ' +
      (d.pressure.remainingMarginPa ?? '—') + ' Pa. Result: ' + d.pressure.statusLabel + '.'));
    if (d.pressure.disclaimer) b.push(note(d.pressure.disclaimer));
  }

  b.push(softBreak());
  b.push(h2('Design assumptions'));
  b.push(table(
    [{ label: 'Assumption', w: 2 }, { label: 'Value' }, { label: 'Source', w: 2 }],
    d.assumptions || [],
    r => [r.label, r.value, r.source]));

  const warnings = d.warnings || [];
  if (warnings.length) {
    b.push(h2('Warnings'));
    for (const w of warnings.filter(x => x.severity === 'CRITICAL')) {
      b.push(flag('crit', 'CRITICAL — ' + w.code + '. ' + w.message + ' ' +
        (w.acknowledged
          ? 'Acknowledged by ' + w.acknowledgedBy + ' on ' + new Date(w.acknowledgedAt).toLocaleString('en-AU') + '.'
          : 'NOT ACKNOWLEDGED.')));
    }
    b.push(table(
      [{ label: 'Severity' }, { label: 'Area' }, { label: 'Code', w: 2 }, { label: 'Detail', w: 5 }],
      warnings.filter(w => w.severity !== 'CRITICAL'),
      r => [r.severity, r.area, r.code, r.message]));
  }

  if (d.bom) {
    b.push(softBreak());
    b.push(h2('Bill of materials'));
    b.push(table(
      [{ label: 'Category' }, { label: 'Item', w: 3 }, { label: 'Qty', r: true }, { label: 'Unit' },
       { label: 'Unit cost', r: true }, { label: 'Total', r: true },
       // Wide enough for the longest thing that goes in it. At the default
       // weight `Placeholder` broke across two lines as `PLACEHOLD` / `ER`.
       { label: 'Price source', w: 1.4 }],
      d.bom.items,
      r => [r.category, r.label, r.quantity, r.unit,
            r.unitCost === null ? 'PRICE REQUIRED' : money(r.unitCost),
            r.totalCost === null ? 'PRICE REQUIRED' : money(r.totalCost),
            r.priceSource === 'nac' ? 'NAC'
              : r.priceSource === 'supplier_list' ? 'Supplier list'
              : r.priceSource === 'default_placeholder' ? 'Placeholder' : 'NONE']));
    if (d.bom.placeholderCount) {
      b.push(flag('warn', d.bom.placeholderCount + ' line(s) use shipped placeholder rates worth ' +
        money(d.bom.placeholderCost) + '. They are not confirmed NAC prices.'));
    }
    if (d.bom.unpricedCount) {
      b.push(flag('crit', d.bom.unpricedCount + ' line(s) have no cost at all, so the job cost is short ' +
        'by whatever they are worth: ' + (d.bom.unpricedLabels || []).join(', ') + '.'));
    }
  }

  if (d.labour) {
    if (d.labour.mode === 'flat') {
      b.push(h2('Installation charge'));
      b.push(table([{ label: 'Item', w: 4 }, { label: 'Amount', r: true }], d.labour.rows,
        r => [r.task, money(r.cost)]));
      b.push(note('Flat job fee: ' + money(d.labour.totalFee) + ' ' +
        (d.labour.jobFeeExGst ? 'ex GST' : 'inc GST') +
        '. This is margin, not cost, so it is not included in the job cost below.'));
    } else {
      b.push(h2('Labour'));
      b.push(table([{ label: 'Task', w: 4 }, { label: 'Hours', r: true }, { label: 'Cost', r: true }],
        d.labour.rows, r => [r.task, r.hours, money(r.cost)]));
      b.push(note(d.labour.totalHours + ' h at ' + money(d.labour.ratePerHour) + '/h = ' +
        money(d.labour.totalCost)));
    }
  }

  if (d.commercials) {
    const c = d.commercials;
    const onFee = c.pricingBasis?.key === 'materials_plus_fee';
    b.push(h2('Costing'));
    b.push(kv([
      ['Equipment', money(c.equipmentCost)], ['Materials', money(c.materialsCost)],
      ['Labour', money(c.labourCost)], ['Subcontractor', money(c.subcontractorCost)],
      ['Other', money(c.otherCost)], ['Total job cost', money(c.totalJobCost)],
      ['Job fee', onFee ? money(c.jobFee) : '—'],
      ['Sell (ex GST)', money(c.sellPriceExGst)], ['GST', money(c.gstAmount)],
      ['Sell (inc GST)', money(c.sellPriceIncGst)],
      ['Gross profit', money(c.grossProfit)],
      ['Gross margin', c.grossMarginPct === null || c.grossMarginPct === undefined ? '—' : c.grossMarginPct + '%'],
      ['Pricing basis', c.pricingBasis?.label || 'none'],
      ['Quote', d.quoteId || 'not yet quoted']
    ]));
    if (onFee) {
      b.push(table([{ label: 'Price build-up', w: 4 }, { label: 'Amount', r: true }], [
        { line: 'Total job cost', amount: c.totalJobCost },
        { line: 'Job fee (' + (c.pricingBasis.jobFeeExGst ? 'ex GST' : 'inc GST, applied ex GST') + ')',
          amount: c.pricingBasis.feeAppliedExGst },
        { line: 'Sell price ex GST', amount: c.sellPriceExGst },
        { line: 'GST', amount: c.gstAmount },
        { line: 'Sell price inc GST', amount: c.sellPriceIncGst }
      ], r => [r.line, money(r.amount)]));
    }
  }

  b.push(note('Engineering note. ' + ENGINEERING_DISCLAIMER +
    ' Manufacturer requirements always override the assumptions in this application.'));

  return { ...header(design, 'Internal HVAC Design Sheet', REPORT_KIND.INTERNAL), blocks: b };
}

/**
 * THE CUSTOMER HVAC DESIGN SUMMARY.
 *
 * Built from scratch, not by filtering the internal sheet. It reads only the
 * engineering description of the system — never d.bom, d.labour, d.commercials,
 * d.warnings, d.assumptions or anything carrying a supplier code or a cost.
 */
export function customerReportDoc(design, { planSnapshot = null } = {}) {
  const d = design;
  const u = d.selectedUnit;
  const b = [];

  b.push(h2('Your system'));
  b.push(kv([
    ['System', u ? u.brandName + ' ' + u.model : '—', u ? u.capacityKw + ' kW reverse cycle ducted' : ''],
    ['Conditioned area', nn(d.systemLoad?.totalConditionedAreaSqM, 0) + ' m²'],
    ['Rooms served', d.systemLoad?.roomCount ?? '—'],
    ['Outlets', d.outlets?.totals?.total ?? '—'],
    ['Zones', d.zones?.zoneCount ?? '—', d.controller?.name || ''],
    ['Return air', d.returnDesign ? d.returnDesign.returnCount + ' return point(s)' : '—']
  ]));

  if (planSnapshot) {
    b.push(h2('Your floor plan'));
    b.push(image(planSnapshot, ''));
  }

  b.push(h2('Rooms and airflow'));
  b.push(table(
    [{ label: 'Room', w: 3 }, { label: 'Area (m²)', r: true }, { label: 'Outlets', r: true }],
    d.systemLoad?.rooms || [],
    r => {
      const o = (d.outlets?.rows || []).find(x => x.roomId === r.roomId);
      return [r.label, nn(r.areaSqM, 1), o ? o.quantity : '—'];
    }));

  if (d.zones) {
    b.push(h2('Zoning'));
    b.push(table([{ label: 'Zone', w: 1.5 }, { label: 'Rooms', w: 4 }], d.zones.zones,
      r => [r.name, (r.rooms || []).join(', ')]));
    b.push(note('Zoning lets you condition only the parts of the home you are using.'));
  }

  b.push(h2('What is included'));
  b.push(bullets([
    'Supply and installation of all supply air outlets',
    'Return air grille and filter, supplied and installed',
    'Insulated flexible ductwork throughout',
    'All refrigerant pipework',
    'Dedicated electrical circuit with isolator and RCD protection',
    'Zoning and controller as listed above',
    'Full rubbish removal and site clean-up on completion',
    'System commissioning and performance testing'
  ]));

  b.push(note(ENGINEERING_DISCLAIMER));

  return { ...header(design, 'HVAC Design Summary', REPORT_KIND.CUSTOMER), blocks: b };
}

/** Every piece of text in a document, for tests and for a plain-text export. */
export function docText(doc) {
  const out = [doc.title, doc.designId, doc.jobDescription,
               doc.customer.name, doc.customer.address, doc.customer.phone, doc.customer.email];
  for (const blk of doc.blocks) {
    if (blk.t === 'h2' || blk.t === 'note' || blk.t === 'flag') out.push(blk.text);
    else if (blk.t === 'kv') blk.items.forEach(i => out.push(i[0], i[1], i[2]));
    else if (blk.t === 'table') { blk.cols.forEach(c => out.push(c.label)); blk.rows.forEach(r => out.push(...r)); }
    else if (blk.t === 'bullets') out.push(...blk.items);
    else if (blk.t === 'image' || blk.t === 'planpage' || blk.t === 'inset') {
      out.push(blk.caption);
    }
  }
  return out.filter(Boolean).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOOR PLAN AND ROOMS
//
// Nick, 4 November 2026: "Accept PDFs and common image formats. Identify
// rooms, readable dimensions and conditioned areas. Let me correct room names,
// dimensions, areas and inclusion/exclusion easily. Use printed dimensions or
// an installer-confirmed scale. Never derive scale from cars, furniture or
// guessed objects."
//
// THREE RULES THIS SCREEN IS BUILT AROUND
//
//   1. The reader reports, it does not measure. /api/plan-read returns the
//      text it can see and where it saw it, and is forbidden from doing
//      arithmetic. Every area on this screen is computed here, in the
//      browser, by the same deterministic engines the tests run against.
//
//   2. A room with no dimension stays a room with no dimension. It is listed,
//      it says what it is missing, and it contributes nothing to the sizing.
//      An invented number is worse than a blank.
//
//   3. Typing is always available. A plan that cannot be read, or a job with
//      no plan at all, is quoted by entering the rooms — Nick: "Allow quoting
//      from manually entered room dimensions... when no usable plan is
//      available." Nothing on this screen can be reached only through the
//      reader.
// ─────────────────────────────────────────────────────────────────────────────

import { h } from './dom.mjs';
import { buildRoom, manualMeasurement, applyRoomOverride } from '../engines/rooms.mjs';
import { SCALE_SOURCE, VERIFIED_SCALE_SOURCES } from '../engines/calibration.mjs';
import { preliminarySizing, sizingReadiness, ESTIMATING_RULES }
  from '../engines/plan-sizing.mjs';

const num = (v) => {
  const t = String(v === null || v === undefined ? '' : v).trim();
  if (t === '') return null;
  const x = Number(t);
  return Number.isFinite(x) ? x : null;
};
const m2 = (v) => v === null || v === undefined ? '—' : (Math.round(v * 100) / 100) + ' m²';
const kw = (v) => v === null || v === undefined ? '—' : (Math.round(v * 10) / 10) + ' kW';

/** The file the estimator uploaded, as a data URI the browser can show. */
export function readFileAsDataUri(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ src: String(r.result), name: file.name, mediaType: file.type });
    r.onerror = () => reject(new Error('That file could not be read.'));
    r.readAsDataURL(file);
  });
}

/** Everything this app will take as a floor plan. */
export const PLAN_TYPES = Object.freeze([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'
]);

export function planTypeOk(mediaType) {
  const t = String(mediaType || '').toLowerCase();
  return PLAN_TYPES.includes(t) || t.startsWith('image/');
}

/**
 * Turn what the reader saw into rooms the estimator can correct.
 *
 * NOTHING IS MEASURED HERE THAT THE READER DID NOT PRINT. A room label with no
 * dimension beside it becomes a room with no dimension — named, listed and
 * waiting for somebody to put a number on it.
 */
export function roomsFromObservations(observations, opts = {}) {
  const o = observations || {};
  const labels = Array.isArray(o.roomLabels) ? o.roomLabels : [];
  return labels.map((r, i) => {
    const w = num(r.widthMm), l = num(r.lengthMm);
    const measurement = (w && l)
      // A dimension printed against the room is the best source there is, and
      // it is the only one this function will ever claim.
      ? { source: 'verified_architectural', widthMm: w, lengthMm: l,
          areaSqM: Math.round((w / 1000) * (l / 1000) * 100) / 100,
          printedText: String(r.dimensionText || '').trim() || null }
      : null;
    return buildRoom({
      id: 'r' + (i + 1) + '-' + String(r.label || 'room').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/-+$/, ''),
      label: String(r.label || 'Room').trim(),
      measurement
    }, opts);
  });
}

/**
 * The scale panel.
 *
 * There are exactly two honest ways to know how big this house is, and a third
 * that looks like one and is not.
 */
function scalePanel(draft, onChange) {
  const cal = draft.plan?.calibration || null;
  const source = cal?.source || SCALE_SOURCE.NONE;
  const verified = VERIFIED_SCALE_SOURCES.includes(source);

  const choose = (value) => {
    draft.plan = draft.plan || {};
    draft.plan.calibration = value === SCALE_SOURCE.NONE
      ? null : { ...(cal || {}), source: value };
    onChange();
  };

  const opt = (value, title, detail) => {
    const on = source === value;
    const box = h('label', { class: 'up' + (on ? ' on' : '') }, [
      Object.assign(document.createElement('input'),
        { type: 'radio', name: 'scale-source', checked: on,
          onchange: () => choose(value) }),
      h('span', { class: 'ub' }, [
        h('span', { class: 'uh' }, [h('strong', { text: title })]),
        h('span', { class: 'ud', text: detail })
      ])
    ]);
    return box;
  };

  return h('div', {}, [
    h('div', { class: 'ups' }, [
      opt(SCALE_SOURCE.PRINTED_DIMENSION, 'Dimensions printed on the plan',
        'Room sizes are read straight off the drawing. Nothing is scaled.'),
      opt(SCALE_SOURCE.MEASURED, 'A distance you measured and entered',
        'You give one real distance between two points and everything else '
        + 'follows from it.'),
      opt(SCALE_SOURCE.SCALE_BAR, 'A scale bar or ratio printed on the sheet',
        'Only when the sheet has not been resized. A plan emailed as a '
        + 'screenshot has lost its scale bar’s meaning.')
    ]),
    // ── THE ONE THAT LOOKS LIKE A SCALE AND IS NOT ──────────────────────
    h('div', { class: 'chk warn' }, [
      h('b', { text: '!' }),
      h('span', { text: 'A car, a bed, a sofa or a kitchen bench is not a scale. '
        + 'They are drawn at whatever size the renderer liked, and a price built on '
        + 'one of them is a price built on a guess. If the sheet carries no '
        + 'dimension and no scale bar, measure something on site and enter it.' })
    ]),
    verified ? null : h('div', { class: 'chk warn' }, [
      h('b', { text: '!' }),
      h('span', { text: 'No confirmed scale yet. Rooms can still be typed in by hand, '
        + 'and a room measured by hand is always trusted.' })
    ])
  ].filter(Boolean));
}

/** One editable room row. */
function roomRow(room, i, draft, onChange, settings) {
  const set = (patch) => {
    // applyRoomOverride keeps the original beside the correction rather than
    // overwriting it, so what the plan said is always recoverable.
    draft.rooms[i] = applyRoomOverride(draft.rooms[i], patch, 'estimator');
    onChange();
  };
  const field = (label, el, hint) => h('div', { class: 'f' },
    [h('label', { text: label }), el, hint ? h('span', { class: 'hint', text: hint }) : null]
      .filter(Boolean));
  const input = (value, attrs, apply) => {
    const n = h('input', attrs);
    n.value = value === null || value === undefined ? '' : String(value);
    n.addEventListener('change', () => apply(n.value));
    return n;
  };

  const measured = room.measurement && room.measurement.source;
  const src = measured ? room.measurement.source : 'none';
  const srcLabel = {
    verified_architectural: 'printed on the plan',
    dimension_chain: 'from a dimension chain',
    chain_plus_wall_geometry: 'chain and wall positions',
    calibrated_geometry: 'scaled off the plan',
    manual: 'typed in',
    none: 'no dimension yet'
  }[src] || src;

  return h('div', { class: 'row' + (measured ? '' : ' chosen') }, [
    h('div', { class: 'rowh' }, [
      h('strong', { text: room.label || 'Room' }),
      h('span', { class: 'pill' + (measured ? '' : ' warn'), text: srcLabel }),
      h('button', { class: 'btn danger', type: 'button', text: 'Remove',
        onclick: () => { draft.rooms.splice(i, 1); onChange(); } })
    ]),
    h('div', { class: 'grid' }, [
      field('Room', input(room.label, { placeholder: 'Living' },
        v => set({ label: v }))),
      field('Width (mm)', input(room.widthMm, { type: 'number', min: '0', step: '10' },
        v => set({ measurement: manualMeasurement(num(v), room.lengthMm,
          'Entered by the estimator') }))),
      field('Length (mm)', input(room.lengthMm, { type: 'number', min: '0', step: '10' },
        v => set({ measurement: manualMeasurement(room.widthMm, num(v),
          'Entered by the estimator') }))),
      field('Area', h('div', { class: 'pill', text: m2(room.areaSqM) }),
        measured ? null : 'Enter a width and a length.')
    ]),
    h('label', { class: 'testbox', style: 'background:#fff;border-color:#E4E7EF' }, [
      Object.assign(document.createElement('input'), {
        type: 'checkbox', checked: room.conditioned !== false,
        onchange: (e) => set({ conditioned: e.target.checked,
                               conditioningOverride: e.target.checked ? 'include' : 'exclude' })
      }),
      h('span', { text: room.conditioned !== false
        ? 'Conditioned — counted in the sizing'
        : 'Not conditioned — left out of the sizing',
        style: 'color:#3D4458' })
    ])
  ]);
}

/** The sizing panel: both estimates, the assumptions, and the override. */
function sizingPanel(draft, settings, onChange) {
  const sizing = preliminarySizing(draft.rooms || [], {
    settings,
    method: draft.sizing?.method === ESTIMATING_RULES.AREA_RULE
      ? ESTIMATING_RULES.AREA_RULE : ESTIMATING_RULES.PER_ROOM,
    override: draft.sizing?.override || null,
    printedFloorAreaSqM: draft.plan?.printedFloorAreaSqM || null
  });
  const ready = sizingReadiness(sizing);

  const methodPick = h('select', {});
  for (const [v, label] of [[ESTIMATING_RULES.PER_ROOM, 'Room by room (area, ceiling height, glazing)'],
                            [ESTIMATING_RULES.AREA_RULE, 'NAC rule — '
                              + settings.load.baseWattsPerM2 + ' W/m² of conditioned area']]) {
    methodPick.appendChild(h('option', { value: v, text: label }));
  }
  methodPick.value = sizing.method;
  methodPick.addEventListener('change', () => {
    draft.sizing = { ...(draft.sizing || {}), method: methodPick.value };
    onChange();
  });

  const est = (e) => e ? h('div', { class: 'stat' }, [
    h('b', { text: kw(e.kw) }), h('span', { text: e.label })
  ]) : null;

  const ovr = draft.sizing?.override || {};
  const ovrKw = h('input', { type: 'number', min: '0', step: '0.1',
                             placeholder: String(sizing.calculatedKw) });
  ovrKw.value = ovr.designKw ?? '';
  const ovrWhy = h('input', { placeholder: 'Why this figure rather than the calculated one' });
  ovrWhy.value = ovr.reason ?? '';
  const applyOverride = () => {
    const v = num(ovrKw.value);
    draft.sizing = {
      ...(draft.sizing || {}),
      override: (v && v > 0) ? {
        designKw: v, reason: ovrWhy.value.trim(),
        by: (window.NAC_USER || 'estimator'), at: new Date().toISOString()
      } : null
    };
    onChange();
  };
  ovrKw.addEventListener('change', applyOverride);
  ovrWhy.addEventListener('change', applyOverride);

  return h('div', { class: 'card' }, [
    h('h2', {}, [document.createTextNode('Preliminary sizing '),
                 h('small', { text: 'an estimate, not a heat load calculation' })]),
    h('div', { class: 'f' }, [h('label', { text: 'Estimating method' }), methodPick]),
    h('div', { class: 'cards' }, [
      h('div', { class: 'stat' }, [h('b', { text: m2(sizing.totalConditionedAreaSqM) }),
                                   h('span', { text: sizing.roomCount + ' conditioned rooms' })]),
      est(sizing.estimates.areaRule),
      est(sizing.estimates.perRoom)
    ].filter(Boolean)),
    sizing.varianceVsRulePct !== null && Math.abs(sizing.varianceVsRulePct) > 20
      ? h('div', { class: 'chk warn' }, [h('b', { text: '!' }), h('span', {
          text: 'The two estimates are ' + sizing.varianceVsRulePct + '% apart. Worth '
            + 'checking the room areas and the ceiling height before choosing equipment.' })])
      : null,
    h('div', { class: 'total' }, [
      h('span', { text: 'Recommended capacity' }),
      h('strong', { text: kw(sizing.recommendedKw) }),
      h('small', { text: sizing.override
        ? 'Your figure. The ' + kw(sizing.override.replaced.designKw) + ' estimate is kept on '
          + 'the job.'
        : sizing.methodLabel }),
      sizing.airflow ? h('div', { class: 'lines' }, [
        h('div', { html: 'Indicative airflow<i>' + sizing.airflow.litresPerSecond + ' L/s</i>' })
      ]) : null
    ].filter(Boolean)),
    h('div', { class: 'grid' }, [
      h('div', { class: 'f' }, [h('label', { text: 'Override the capacity (kW)' }), ovrKw,
        h('span', { class: 'hint', text: 'Kept beside the calculated figure, never instead of it.' })]),
      h('div', { class: 'f' }, [h('label', { text: 'Reason' }), ovrWhy])
    ]),
    ...ready.notes.map(nte => h('div', { class: 'chk ' + (nte.severity === 'CRITICAL' ? 'bad' : 'warn') },
      [h('b', { text: nte.severity === 'CRITICAL' ? '✕' : '!' }), h('span', { text: nte.message })])),
    h('details', {}, [
      h('summary', { text: 'What this estimate assumes' }),
      h('dl', { class: 'facts' }, sizing.assumptions.flatMap(a =>
        [h('dt', { text: a.label }), h('dd', { text: a.value + '  —  ' + a.source })]))
    ])
  ].filter(Boolean));
}

/**
 * Build the whole step.
 *
 * @param {object} ctx { draft, settings, onChange, onRead }
 */
export function planStep(ctx) {
  const { draft, settings, onChange } = ctx;
  draft.rooms = Array.isArray(draft.rooms) ? draft.rooms : [];

  const plan = draft.plan || null;
  const viewer = plan && plan.src
    ? (String(plan.mediaType).includes('pdf')
        ? h('iframe', { src: plan.src, class: 'planview', title: 'Floor plan' })
        : h('img', { src: plan.src, class: 'planview', alt: 'Floor plan' }))
    : h('div', { class: 'empty', text: 'No plan uploaded. You can still quote this job by '
        + 'entering the rooms below.' });

  const file = h('input', { type: 'file', id: 'planFile',
                            accept: PLAN_TYPES.join(',') + ',image/*' });
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    if (!planTypeOk(f.type)) { ctx.flash('bad', 'That is not a plan NAC can read. '
      + 'Use a PDF or a photograph.'); return; }
    const got = await readFileAsDataUri(f);
    draft.plan = { ...(draft.plan || {}), ...got, page: 1 };
    onChange();
  });

  return h('div', { class: 'col' }, [
    h('section', { class: 'card' }, [
      h('h2', {}, [document.createTextNode('Floor plan '),
                   h('small', { text: 'PDF or a photograph — or none at all' })]),
      h('div', { class: 'f' }, [h('label', { text: 'Upload the plan' }), file]),
      viewer,
      plan && plan.src ? h('div', { class: 'bar' }, [
        h('button', { class: 'btn primary', type: 'button', text: 'Read the rooms off this plan',
          onclick: () => ctx.onRead() }),
        h('button', { class: 'btn danger', type: 'button', text: 'Remove the plan',
          onclick: () => { draft.plan = null; onChange(); } })
      ]) : null,
      plan && plan.notes && plan.notes.length ? h('div', {}, plan.notes.map(t =>
        h('div', { class: 'chk warn' }, [h('b', { text: '!' }), h('span', { text: t })]))) : null
    ].filter(Boolean)),

    h('section', { class: 'card' }, [
      h('h2', {}, [document.createTextNode('How the scale is known')]),
      scalePanel(draft, onChange)
    ]),

    h('section', { class: 'card' }, [
      h('h2', {}, [document.createTextNode('Rooms '),
                   h('small', { text: 'correct anything — what the plan said is kept' })]),
      h('div', { class: 'rows' },
        draft.rooms.map((r, i) => roomRow(r, i, draft, onChange, settings))),
      h('div', { class: 'bar' }, [
        h('button', { class: 'btn', type: 'button', text: 'Add a room',
          onclick: () => {
            draft.rooms.push(buildRoom({ id: 'r' + (draft.rooms.length + 1), label: '' },
                                       { settings }));
            onChange();
          } })
      ])
    ]),

    sizingPanel(draft, settings, onChange)
  ]);
}

export default { planStep, roomsFromObservations, readFileAsDataUri, planTypeOk, PLAN_TYPES };

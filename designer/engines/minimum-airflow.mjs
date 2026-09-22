// ─────────────────────────────────────────────────────────────────────────────
// THE MINIMUM AIRFLOW IS A MANUFACTURER FACT, OR IT IS NOT A FACT
//
// The zoning check compared the open airflow against 40% of system airflow.
// That is a reasonable rule of thumb and it is nothing Daikin, Fujitsu,
// Mitsubishi or Panasonic ever published. It decided whether a house needed a
// spill zone, and it was presented in the same typeface as the numbers that
// came off a data sheet.
//
// Nick: "Do not use the generic 40% rule as though it were manufacturer data.
// The 40% rule may remain an internal provisional screening check only, clearly
// labelled as such."
//
// So a minimum airflow now has to say where it came from: the figure, the fan
// setting it applies at, the document, its revision and the page — and who
// checked it, and when. A record missing any of those is not verified, and a
// zoning approval that leans on an unverified minimum is blocked rather than
// quietly resolved against a rule of thumb.
//
// Some manufacturers publish a PERCENTAGE of rated airflow rather than a
// figure. That is supported directly, because converting it here and storing
// the result would lose the fact that it scales with the unit.
// ─────────────────────────────────────────────────────────────────────────────

const trimmed = (v) => (v === null || v === undefined) ? '' : String(v).trim();
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

export const MINIMUM_SOURCE = Object.freeze({
  /** Off the manufacturer's own document, checked by a person. */
  MANUFACTURER: 'MANUFACTURER_DATA',
  /** NAC's configured fraction. A screening check, never a unit limit. */
  RULE_OF_THUMB: 'NAC_RULE_OF_THUMB'
});

/** Every field a verified minimum-airflow record carries. */
export const MINIMUM_AIRFLOW_FIELDS = Object.freeze([
  { key: 'minimumAirflowLs', label: 'Minimum airflow', unit: 'L/s', type: 'number',
    help: 'The lowest airflow the manufacturer permits through the indoor unit. Leave empty '
        + 'if they publish a percentage instead.' },
  { key: 'minimumAirflowPct', label: 'or minimum as % of rated', unit: '%', type: 'number',
    help: 'Some manufacturers publish a percentage of rated airflow rather than a figure. '
        + 'Enter it here and it scales with the unit.' },
  { key: 'fanSetting', label: 'Fan setting / mode', type: 'text', required: true,
    help: 'The setting the figure applies at — for example "low fan, cooling". A minimum '
        + 'at low fan is not the same number as one at medium.' },
  { key: 'source', label: 'Manufacturer document', type: 'text', required: true,
    help: 'The document it came from, e.g. "Daikin FDYA Engineering Data".' },
  { key: 'documentRevision', label: 'Document revision', type: 'text', required: true,
    help: 'Which revision or edition, so a later one can be compared against it.' },
  { key: 'pageReference', label: 'Page / table reference', type: 'text', required: true,
    help: 'Where in that document, so the next person can find it in one go.' },
  { key: 'verifiedBy', label: 'Verified by', type: 'text', required: true,
    help: 'Who read it off the document.' },
  { key: 'verifiedAt', label: 'Verification date', type: 'date', required: true,
    help: 'When they read it.' }
]);

/** Is a stored record complete enough to be called manufacturer data? */
export function minimumVerified(record) {
  if (!record) return false;
  const ls = num(record.minimumAirflowLs);
  const pct = num(record.minimumAirflowPct);
  // One or the other. Both is a contradiction; neither is no figure at all.
  if (ls === null && pct === null) return false;
  if (ls !== null && pct !== null) return false;
  if (ls !== null && ls <= 0) return false;
  if (pct !== null && (pct <= 0 || pct >= 100)) return false;
  return MINIMUM_AIRFLOW_FIELDS.filter(f => f.required)
    .every(f => !!trimmed(record[f.key]));
}

/** What a record is still missing, for a screen to show. */
export function minimumMissing(record) {
  const out = [];
  const ls = num(record?.minimumAirflowLs);
  const pct = num(record?.minimumAirflowPct);
  if (ls === null && pct === null) {
    out.push({ key: 'minimumAirflowLs', label: 'Minimum airflow (L/s or %)' });
  } else if (ls !== null && pct !== null) {
    out.push({ key: 'minimumAirflowLs',
               label: 'Minimum airflow set BOTH ways — use one or the other' });
  }
  for (const f of MINIMUM_AIRFLOW_FIELDS) {
    if (f.required && !trimmed(record?.[f.key])) out.push(f);
  }
  return out;
}

/**
 * The minimum airflow this system must keep open, and where the number is from.
 *
 * @param {object} unit      the selected unit; its spec record may carry the figure
 * @param {number} systemLs  design airflow
 * @param {object} settings  for the rule-of-thumb fraction
 */
export function minimumOpenAirflow(unit, systemLs, settings) {
  const fraction = settings?.zoning?.minOpenAirflowFraction ?? 0.40;
  const system = num(systemLs) ?? 0;
  const byFraction = Math.round(system * fraction);

  const specs = unit?.specs || unit || {};
  const record = specs.minimumAirflow || specs;
  const verified = minimumVerified(record);

  if (verified) {
    const ls = num(record.minimumAirflowLs);
    const pct = num(record.minimumAirflowPct);
    // A published percentage scales with the unit's RATED airflow, not with
    // the airflow this particular house happens to need.
    const ratedLs = num(specs.ratedAirflowLs) ?? system;
    const requiredLs = ls !== null ? Math.round(ls) : Math.round(ratedLs * pct / 100);
    return {
      requiredLs,
      source: MINIMUM_SOURCE.MANUFACTURER,
      verified: true,
      screeningOnly: false,
      basis: (unit?.model || 'The selected unit') + ' publishes a minimum of '
        + (ls !== null ? requiredLs + ' L/s' : pct + '% of rated airflow (' + requiredLs + ' L/s)')
        + ' at ' + trimmed(record.fanSetting) + ', from ' + trimmed(record.source)
        + ' rev ' + trimmed(record.documentRevision) + ', ' + trimmed(record.pageReference)
        + '. Verified by ' + trimmed(record.verifiedBy)
        + ' on ' + trimmed(record.verifiedAt) + '.',
      evidence: {
        fanSetting: trimmed(record.fanSetting),
        document: trimmed(record.source),
        documentRevision: trimmed(record.documentRevision),
        pageReference: trimmed(record.pageReference),
        verifiedBy: trimmed(record.verifiedBy),
        verifiedAt: trimmed(record.verifiedAt),
        publishedAsPercent: pct !== null
      },
      ruleOfThumbLs: byFraction,
      fraction
    };
  }

  return {
    requiredLs: byFraction,
    source: MINIMUM_SOURCE.RULE_OF_THUMB,
    verified: false,
    /** Said out loud everywhere this figure appears. */
    screeningOnly: true,
    label: 'PROVISIONAL SCREENING CHECK — NOT MANUFACTURER DATA',
    basis: 'No verified minimum airflow has been entered for '
      + (unit?.model || 'the selected unit') + '. This is NAC’s configured '
      + Math.round(fraction * 100) + '% of design airflow, which is an internal screening '
      + 'check and not a manufacturer limit. It cannot approve a zoning design.',
    missing: minimumMissing(record),
    ruleOfThumbLs: byFraction,
    fraction
  };
}

export default { MINIMUM_SOURCE, MINIMUM_AIRFLOW_FIELDS, minimumVerified, minimumMissing,
                 minimumOpenAirflow };

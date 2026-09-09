// NAC AI HVAC DESIGNER — PART 28: NAC DESIGN ASSISTANT.
//
// The assistant EXPLAINS the design. It is handed the finished output of the
// deterministic engines and may only reason about those numbers. It cannot
// change the design, and it must not produce an engineering value of its own —
// if a figure is not in the design payload, the answer is that NAC has not
// entered it.
//
// POST { question, design }  ->  { answer, usedFacts[] }

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

const MODEL = 'claude-sonnet-4-6';

const SYSTEM = `You are the NAC DESIGN ASSISTANT inside NAC Electrical Air & Refrigeration's
HVAC designer. You are talking to a NAC estimator, on site or at a desk.

WHAT YOU ARE
You explain a design that has already been calculated. Deterministic engines
produced every number you will see. You are the commentary, not the calculator.

HARD RULES
1. Use ONLY the numbers in the DESIGN DATA below. Never calculate a new
   engineering value, capacity, airflow, duct size, velocity or pressure.
2. Never state a manufacturer specification that is not in the data. If a spec
   is missing, say "NAC has not entered that specification yet" and point at
   HVAC Design Settings → Equipment specifications.
3. You cannot change anything. Recommend, and say exactly which screen and
   field the estimator would change. Never imply you have applied a change.
4. If the data does not answer the question, say so plainly.
5. Quote the design's own figures with their units. Do not round them further.
6. Keep it short and practical — a couple of sentences or a tight list. This is
   read on an iPad in someone's roof space, not in a report.
7. Australian residential ducted context. Plain trade language.

GOOD ANSWER SHAPE
"Bed 3 currently uses a 150 mm branch at 105 L/s, which is 5.94 m/s. That is
above the 4.5 m/s preferred branch velocity in HVAC Design Settings. Going up to
175 mm brings it to 4.37 m/s. Change it on the Ductwork tab."`;

/**
 * Reduce a design to the facts the assistant is allowed to talk about.
 * This is an allowlist, not a filter: anything not named here never reaches the
 * model. The browser already withholds the plan image, the revision history and
 * the customer's contact details, and this is the second line of defence.
 */
function factsFor(design) {
  const d = design || {};
  return {
    designId: d.id,
    stage: d.stage,
    settings: d.settingsUsed || null,
    calibration: d.calibration ? {
      pixelsPerMm: d.calibration.pixelsPerMm,
      calibrationDistanceMm: d.calibration.calibrationDistanceMm,
      pixelDistance: d.calibration.pixelDistance,
      scaleLabel: d.calibration.scaleLabel?.label || null
    } : null,
    chains: (d.chains || []).map(c => ({
      id: c.id, orientation: c.orientation, segments: c.segments, stations: c.stations,
      totalMm: c.totalMm, closure: c.closure, confidence: c.confidence
    })),
    rooms: (d.rooms || []).map(r => ({
      label: r.label, conditioned: r.conditioned, widthMm: r.widthMm, lengthMm: r.lengthMm,
      areaSqM: r.areaSqM, ceilingHeightMm: r.ceilingHeightMm, status: r.status,
      confidence: r.confidence, confidenceBand: r.confidenceBand,
      measurementSource: r.measurement?.sourceLabel,
      measurementEvidence: r.measurement?.evidence,
      confidenceFactors: r.confidenceFactors,
      orientation: r.orientation, glazingAreaSqM: r.glazingAreaSqM, openPlanGroup: r.openPlanGroup
    })),
    systemLoad: d.systemLoad ? {
      totalConditionedAreaSqM: d.systemLoad.totalConditionedAreaSqM,
      designCoolingW: d.systemLoad.designCoolingW, designHeatingW: d.systemLoad.designHeatingW,
      designKw: d.systemLoad.designKw, averageWattsPerM2: d.systemLoad.averageWattsPerM2,
      legacy: d.systemLoad.legacy, varianceVsLegacyPct: d.systemLoad.varianceVsLegacyPct,
      rooms: (d.systemLoad.rooms || []).map(r => ({
        label: r.label, areaSqM: r.areaSqM, coolingW: r.coolingW, heatingW: r.heatingW,
        wattsPerM2: r.wattsPerM2, shareOfTotal: r.shareOfTotal, overridden: r.overridden,
        breakdown: r.breakdown
      }))
    } : null,
    assumptions: d.assumptions || [],
    equipment: d.equipmentSelection ? {
      window: d.equipmentSelection.window,
      recommended: d.equipmentSelection.recommended,
      systemWarnings: d.equipmentSelection.systemWarnings
    } : null,
    selectedUnit: d.selectedUnit || null,
    controller: d.controller || null,
    airflow: d.airflow || null,
    outlets: d.outlets || null,
    ductwork: d.network ? {
      totalDuctLengthM: d.network.totalDuctLengthM,
      velocityTargets: d.network.settingsVelocity,
      sections: (d.network.sections || []).map(s => ({
        id: s.id, role: s.role, destination: s.destination, airflowLs: s.airflowLs,
        diameterMm: s.diameterMm, velocityMs: s.velocityMs, lengthM: s.lengthM,
        effectiveLengthM: s.effectiveLengthM, pressureDropPa: s.pressureDropPa,
        selectionReason: s.selection?.reason, warnings: s.warnings
      }))
    } : null,
    returnAir: d.returnDesign || null,
    zones: d.zones || null,
    pressure: d.pressure || null,
    materials: d.bom ? { byCategory: d.bom.byCategory, totalCost: d.bom.totalCost,
                         lineCount: d.bom.lineCount, placeholderCount: d.bom.placeholderCount } : null,
    labour: d.labour || null,
    commercials: d.commercials || null,
    warnings: d.warnings || [],
    warningSummary: d.warningSummary || null
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'Anthropic API key not configured' });

  const { question, design } = req.body || {};
  if (!question || typeof question !== 'string') return res.status(400).json({ error: 'question required' });
  if (!design || typeof design !== 'object') return res.status(400).json({ error: 'design required' });

  const facts = factsFor(design);

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        system: SYSTEM,
        messages: [{
          role: 'user',
          content: 'DESIGN DATA (the only figures you may use):\n```json\n' +
            JSON.stringify(facts) + '\n```\n\nESTIMATOR ASKS: ' + question.slice(0, 2000)
        }]
      })
    });

    const data = await apiRes.json();
    if (data.error) return res.status(502).json({ error: data.error.message || 'Assistant failed' });

    const answer = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    return res.status(200).json({
      answer,
      grounding: 'Answered from the current design only. The assistant cannot change the design.'
    });
  } catch (e) {
    return res.status(500).json({ error: 'Assistant failed: ' + e.message });
  }
}

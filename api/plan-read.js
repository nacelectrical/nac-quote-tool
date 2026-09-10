// NAC AI HVAC DESIGNER — PART 2/3: floor plan reader.
//
// This endpoint returns OBSERVATIONS ONLY. It reports the text it can see on
// the plan, where it saw it, and where it believes walls, openings and room
// labels are. It is explicitly forbidden from doing arithmetic, reconstructing
// chains, calculating areas or sizing anything — all of that happens in the
// deterministic engines in /designer/engines, on data the estimator can see
// and edit.
//
// POST { imageBase64, mediaType, page?, imageWidthPx, imageHeightPx }
//  ->  { observations: { detections[], openings[], walls[], roomLabels[],
//                        scaleLabelText, overallDimensions }, notes[], quality }

export const config = { api: { bodyParser: { sizeLimit: '25mb' } } };

const MODEL = 'claude-sonnet-4-6';

const SYSTEM = `You are a plan-reading assistant for NAC Electrical Air & Refrigeration.

Your ONLY job is to report what is literally printed and drawn on an Australian
residential builder's floor plan. You are a pair of eyes, not an engineer.

ABSOLUTE RULES
1. Report only what you can actually see. Never infer, complete or tidy up a number.
2. Do NOT add numbers together. Do NOT compute areas, totals, room sizes or capacities.
3. Do NOT decide what a number means beyond the obvious visual context. The
   application classifies numbers itself.
4. If text is unreadable, say so in "notes" and leave it out. A missing
   observation is always better than an invented one.
5. Report coordinates in PIXELS of the image you were given, with the origin at
   the top-left. If you cannot judge a position, omit that item entirely rather
   than guessing a box.
6. Copy dimension text EXACTLY as printed, including any unit suffix. "3400"
   stays "3400". "3.4m" stays "3.4m". Never convert.
7. Read every digit off the drawing. Do NOT round a number, drop a trailing
   digit, or make one "look right" against its neighbours. Australian plans use
   4-digit millimetres for rooms (3400, 4210) and 2-3 digit millimetres for wall
   thicknesses and setbacks (90, 110, 220). A 4-digit number is never 3 digits.
8. If a digit is genuinely ambiguous — 3 against 8, 6 against 5, 0 against 8 —
   leave that number OUT and say so in notes. A dimension chain that is missing
   a segment is obvious and fixable. One with a wrong digit is neither: it adds
   up to something plausible and quietly sizes the wrong system.
9. Never read the same number twice into two entries, and never invent a number
   to fill a gap in a row. Rows of dimensions on a plan are often incomplete.

WHAT TO REPORT
- detections: every number-like piece of text on or around the plan, with its
  bounding box, whether it is written along the horizontal or vertical axis, and
  which dimension row it belongs to (0 = the outermost row, increasing inward).
  Include wall thicknesses, window and door widths, setbacks and annotations —
  the application decides which is which.
- openings: window, door and sliding-door symbols you can identify, with boxes.
- walls: wall lines you can identify, with orientation and position.
- roomLabels: room name text with its box (e.g. "BED 2", "ALFRESCO").
- scaleLabelText: any printed scale note, verbatim (e.g. "SCALE 1:100 @ A3").
- overallDimensions: the outermost overall width/depth numbers IF they are
  clearly printed as overalls. Otherwise null.
- quality: "good" | "fair" | "poor" — how legible the image is.
- notes: short plain sentences about anything unclear.

Respond with JSON only, no prose, matching this shape exactly:
{"detections":[{"id":"d1","text":"3400","orientation":"horizontal","row":1,"box":{"x":0,"y":0,"w":0,"h":0}}],
 "openings":[{"id":"o1","type":"window|door|sliding door","box":{"x":0,"y":0,"w":0,"h":0}}],
 "walls":[{"id":"w1","orientation":"horizontal|vertical","box":{"x":0,"y":0,"w":0,"h":0}}],
 "roomLabels":[{"id":"r1","text":"BED 2","box":{"x":0,"y":0,"w":0,"h":0}}],
 "scaleLabelText":"SCALE 1:100 @ A3","overallDimensions":{"widthText":"18020","depthText":"14250"},
 "quality":"good","notes":["..."]}`;

function box(v) {
  if (!v || typeof v !== 'object') return null;
  const n = (x) => (typeof x === 'number' && isFinite(x) ? x : null);
  const b = { x: n(v.x), y: n(v.y), w: n(v.w), h: n(v.h) };
  return (b.x === null || b.y === null || b.w === null || b.h === null) ? null : b;
}

/**
 * Discard anything that does not match the contract. A malformed or
 * hallucinated field is dropped rather than repaired — the estimator can always
 * add it by hand, and a wrong observation is worse than a missing one.
 */
function sanitise(raw, { imageWidthPx, imageHeightPx }) {
  const inImage = (b) => !imageWidthPx || !imageHeightPx ||
    (b.x >= -50 && b.y >= -50 && b.x <= imageWidthPx + 50 && b.y <= imageHeightPx + 50);

  const detections = (Array.isArray(raw.detections) ? raw.detections : [])
    .map((d, i) => ({
      id: typeof d.id === 'string' ? d.id : 'd' + (i + 1),
      text: typeof d.text === 'string' ? d.text.trim().slice(0, 32) : '',
      orientation: d.orientation === 'vertical' ? 'vertical' : 'horizontal',
      row: Number.isInteger(d.row) ? d.row : null,
      box: box(d.box),
      source: 'plan_detection'
    }))
    .filter(d => d.text && d.box && inImage(d.box))
    .slice(0, 400);

  const openings = (Array.isArray(raw.openings) ? raw.openings : [])
    .map((o, i) => ({
      id: typeof o.id === 'string' ? o.id : 'o' + (i + 1),
      type: typeof o.type === 'string' ? o.type.toLowerCase().slice(0, 24) : 'unknown',
      box: box(o.box)
    }))
    .filter(o => o.box && inImage(o.box))
    .slice(0, 200);

  const walls = (Array.isArray(raw.walls) ? raw.walls : [])
    .map((w, i) => ({
      id: typeof w.id === 'string' ? w.id : 'w' + (i + 1),
      orientation: w.orientation === 'vertical' ? 'vertical' : 'horizontal',
      box: box(w.box)
    }))
    .filter(w => w.box && inImage(w.box))
    .slice(0, 300);

  const roomLabels = (Array.isArray(raw.roomLabels) ? raw.roomLabels : [])
    .map((r, i) => ({
      id: typeof r.id === 'string' ? r.id : 'r' + (i + 1),
      text: typeof r.text === 'string' ? r.text.trim().slice(0, 48) : '',
      box: box(r.box)
    }))
    .filter(r => r.text && r.box && inImage(r.box))
    .slice(0, 80);

  const quality = ['good', 'fair', 'poor'].includes(raw.quality) ? raw.quality : 'fair';
  const notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .filter(n => typeof n === 'string').map(n => n.slice(0, 300)).slice(0, 20);

  const od = raw.overallDimensions && typeof raw.overallDimensions === 'object' ? raw.overallDimensions : {};

  return {
    observations: {
      detections, openings, walls, roomLabels,
      scaleLabelText: typeof raw.scaleLabelText === 'string' ? raw.scaleLabelText.slice(0, 120) : null,
      overallDimensions: {
        widthText: typeof od.widthText === 'string' ? od.widthText.slice(0, 32) : null,
        depthText: typeof od.depthText === 'string' ? od.depthText.slice(0, 32) : null
      }
    },
    quality,
    notes,
    disclaimer: 'These are observations read off the uploaded image. Every measurement ' +
      'is reconstructed and verified by NAC AI HVAC Designer, not by the plan reader.'
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'Anthropic API key not configured' });

  const { imageBase64, mediaType, imageWidthPx, imageHeightPx } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });

  const isPdf = String(mediaType || '').includes('pdf');
  const planBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: imageBase64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } };

  const sizeNote = imageWidthPx && imageHeightPx
    ? `The image you are looking at is ${imageWidthPx} × ${imageHeightPx} pixels. Report all boxes in those pixel coordinates.`
    : 'Report all boxes in the pixel coordinates of the image as supplied.';

  // A tiled read: say so, so a part-drawing is not treated as a whole plan and
  // an edge-clipped number is left out rather than completed from imagination.
  const { region } = req.body || {};
  const regionNote = region && region.total > 1
    ? `\n\nThis is section ${region.index} of ${region.total} of a larger sheet — ` +
      'a crop, not the whole plan. Read only what is inside this crop. Numbers ' +
      'clipped by the edge of the image are covered by another section, so leave ' +
      'them out rather than guessing the missing digits. Do not report overall ' +
      'building dimensions unless you can see the full dimension line and both ' +
      'its ends within this crop.'
    : '';

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: 'user', content: [planBlock,
          { type: 'text', text: sizeNote + regionNote + '\n\nRead this plan now. JSON only.' }] }]
      })
    });

    const data = await apiRes.json();
    if (data.error) return res.status(502).json({ error: data.error.message || 'Plan read failed' });

    const text = (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n').trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return res.status(200).json({
        observations: { detections: [], openings: [], walls: [], roomLabels: [], scaleLabelText: null,
                        overallDimensions: { widthText: null, depthText: null } },
        quality: 'poor',
        notes: ['The plan reader could not return a usable result. Calibrate the plan and enter the rooms manually.'],
        raw: text.slice(0, 800)
      });
    }

    let parsed;
    try { parsed = JSON.parse(match[0]); }
    catch (e) {
      // A response cut off at the token limit ends mid-JSON. Say which it was,
      // because "there was too much on the sheet" and "the reader misbehaved"
      // call for different things from the estimator.
      const truncated = data.stop_reason === 'max_tokens';
      return res.status(200).json({
        observations: { detections: [], openings: [], walls: [], roomLabels: [], scaleLabelText: null,
                        overallDimensions: { widthText: null, depthText: null } },
        quality: 'poor',
        notes: [truncated
          ? 'There was more text on this part of the plan than the reader could return in one pass, ' +
            'so its answer was cut off and discarded. Crop the plan to the floor plan itself and read again.'
          : 'The plan reader returned malformed data and it has been discarded. Use manual entry.']
      });
    }
    if (data.stop_reason === 'max_tokens') {
      parsed.notes = [...(Array.isArray(parsed.notes) ? parsed.notes : []),
        'The reader ran out of room before it finished this section, so some numbers are missing. ' +
        'Check the drawing for anything it did not list.'];
    }

    return res.status(200).json(sanitise(parsed, { imageWidthPx, imageHeightPx }));
  } catch (e) {
    return res.status(500).json({ error: 'Plan read failed: ' + e.message });
  }
}

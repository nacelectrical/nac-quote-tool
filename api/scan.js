// NAC — Floor plan scan + sizing proposal
// Runs server-side on Vercel so the Anthropic API key is never exposed to the browser.
// POST { imageBase64, mediaType, statedArea } -> { area, kW, band, confidence, flags, reasoning }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'Anthropic API key not configured' });

  const { imageBase64, mediaType, statedArea } = req.body || {};
  if (!imageBase64) return res.status(400).json({ error: 'imageBase64 required' });

  // NAC installed price bands — EDIT THESE to your real numbers.
  // Used only to attach an indicative band to the draft; Nick confirms the real price.
  const BANDS = [
    { maxKw: 10, label: '$X,XXX \u2013 $X,XXX' },
    { maxKw: 14, label: '$X,XXX \u2013 $X,XXX' },
    { maxKw: 18, label: '$X,XXX \u2013 $X,XXX' },
    { maxKw: 99, label: 'POA \u2013 large system' }
  ];

  const prompt = `You are helping NAC Electrical Air & Refrigeration size a residential ducted air conditioning system from a floor plan.

Analyse the attached floor plan image and estimate:
1. Total internal floor area in square metres (living areas needing cooling — exclude garage, outdoor, unroofed areas where identifiable).
2. Apply NAC's sizing rule of 145 W/m2 to get required capacity, then round UP to a sensible ducted system size in kW.
3. State a confidence level: high / medium / low.
4. Flag any problems: no scale bar present, dimensions unreadable, hand-drawn/unclear, image cut off, or area is a rough guess.

${statedArea ? `The customer stated their home is approximately ${statedArea} m2 — use this to sanity-check your reading, and flag if your estimate differs significantly.` : ''}

Be conservative and honest. If you genuinely cannot read the plan, say so and set confidence to low — do NOT invent a precise number. It is far better to flag uncertainty than to guess wrong.

Respond ONLY with a JSON object, no other text, in exactly this form:
{"area": <number or null>, "kW": <number or null>, "confidence": "high|medium|low", "flags": ["..."], "reasoning": "<one or two plain sentences>"}`;

  try {
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 700,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    });

    const data = await apiRes.json();
    if (data.error) return res.status(502).json({ error: data.error.message || 'Scan failed' });

    const text = (data.content || [])
      .filter(function (b) { return b.type === 'text'; })
      .map(function (b) { return b.text; })
      .join('')
      .replace(/```json|```/g, '')
      .trim();

    let parsed;
    try { parsed = JSON.parse(text); }
    catch (e) { return res.status(200).json({ area: null, kW: null, confidence: 'low', flags: ['Could not read plan automatically — needs manual sizing'], reasoning: 'Automatic scan was inconclusive.' }); }

    // Attach an indicative band based on proposed kW
    let band = 'POA';
    if (parsed.kW != null) {
      const hit = BANDS.find(function (b) { return parsed.kW <= b.maxKw; });
      band = hit ? hit.label : 'POA';
    }

    return res.status(200).json({
      area: parsed.area,
      kW: parsed.kW,
      band: band,
      confidence: parsed.confidence || 'low',
      flags: parsed.flags || [],
      reasoning: parsed.reasoning || ''
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}


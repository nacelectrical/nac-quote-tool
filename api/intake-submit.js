// NAC — Intake form submission handler.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
  const SUPA_URL = 'https://icnznjhwybryizbdqrgx.supabase.co';
  const SUPA = process.env.SUPABASE_KEY;
  const NOTIFY = process.env.NAC_NOTIFY_WEBHOOK || 'https://webhooked.email/api/v1/webhooks/xkihnP49/trigger';

  if (!ANTHROPIC) return res.status(500).json({ error: 'Anthropic key missing' });

  const b = req.body || {};
  if (!b.client || !b.planBase64) return res.status(400).json({ error: 'name and floor plan required' });

  const MODELS = {
    Daikin: [
      { kw: 5.0, m: 'FDYA50AV1 / RZAS50' }, { kw: 6.0, m: 'FDYA60AV1 / RZAS60' },
      { kw: 7.1, m: 'FDYA71AV1 / RZAS71' }, { kw: 8.5, m: 'FDYA85AV1 / RZAS85' },
      { kw: 10.0, m: 'FDYA100AV1 / RZAS100' }, { kw: 12.5, m: 'FDYA125AV1 / RZAS125' },
      { kw: 14.0, m: 'FDYA140AV1 / RZAS140' }, { kw: 16.0, m: 'FDYA160AV1 / RZAS160' },
      { kw: 18.0, m: 'FDYAN180AV1 / RZA180' }
    ],
    Fujitsu: [
      { kw: 5.2, m: 'ARTG18LHTA / AOTG18LACC' }, { kw: 7.1, m: 'ARTG24LHTA / AOTG24LAT3' },
      { kw: 8.5, m: 'ARTG30LHTA / AOTG30LAT3' }, { kw: 10.0, m: 'ARTG36LHTA / AOTG36LAT3' },
      { kw: 12.5, m: 'ARTG45LHTA / AOTG45LATL' }, { kw: 14.0, m: 'ARTG54LHTA / AOTG54LATT' },
      { kw: 16.0, m: 'ARTH60KHTA' }, { kw: 18.0, m: 'ARTH65KHTA' }
    ],
    Midea: [
      { kw: 7.1, m: 'DUCMI71IH / UCMI71O' }, { kw: 10.5, m: 'DUCMI105IH / UCMI105O' },
      { kw: 14.0, m: 'DUCMI140IH / UCMI140O' }, { kw: 17.0, m: 'DUCMI170IH / UCMI170O' }
    ]
  };

  function nearestModel(list, target) {
    return list.reduce(function (best, cur) {
      return Math.abs(cur.kw - target) < Math.abs(best.kw - target) ? cur : best;
    });
  }

  const isPdf = (b.mediaType || '').includes('pdf');
  const planBlock = {
    type: isPdf ? 'document' : 'image',
    source: { type: 'base64', media_type: b.mediaType || 'image/jpeg', data: b.planBase64 }
  };

  const prompt = `You are NAC Electrical Air & Refrigeration's INTERNAL design assistant. You never speak to customers. Produce SHORT DRAFT NOTES for the NAC team to review and quote from. It is a proposal, not a decision.

HARD SIZING RULE: 145 W/m2 on CONDITIONED floor area only.
CONDITIONED (count these): bedrooms, living, dining, family, kitchen, study, media/theatre, and hallways/entry.
EXCLUDED (never count): garage, laundry, bathrooms, ensuite, WC, walk-in-robes, pantry, alfresco, patio, verandah, porch, outdoor areas.
NO modifiers. Over 18kW = flag CUSTOM/DUAL.

CALCULATION: List the CONDITIONED rooms with their m2. Add them to ONE total conditioned area. DO NOT calculate kW yourself — just report the total area. DO NOT reconcile against any "total internal area" or "INT" label on the plan; use ONLY the sum of the rooms you listed. If a conditioned room isn't dimensioned, make one quick assumption. If the plan is unreadable, say so and set confidence LOW.

Customer / job info:
- Name: ${b.client}
- Address: ${b.address || '-'}
- Property type: ${b.houseType || '-'}
- Existing AC: ${b.existingAC || '-'}
- Preferred brand: ${b.brand || 'no preference'}
- Notes: ${b.comments || '-'}

KEEP IT SHORT. These are quick notes anyone on the team can read and quote from — NOT a long report. No price. Plain text, no markdown, no asterisks, no tables.

Output EXACTLY this and nothing else:

CONDITIONED_M2: [total conditioned area, number only, e.g. 108]
CONFIDENCE:      [HIGH / MEDIUM / LOW]
ACTION:          [READY TO QUOTE / NEEDS REVIEW / SITE VISIT FIRST]
FLAGS:           [one short line, or "None"]

ROOMS COUNTED:   [list conditioned rooms with m2, comma-separated on one line]
NOT COUNTED:     [excluded rooms, comma-separated on one line]

NOTES:           [2-4 short bullet lines max — anything the quoter needs to know]`;

  let pack = '';
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: [planBlock, { type: 'text', text: prompt }] }]
      })
    });
    const data = await aiRes.json();
    if (data.error) return res.status(502).json({ error: data.error.message });
    pack = (data.content || []).filter(function (x) { return x.type === 'text'; }).map(function (x) { return x.text; }).join('\n').trim();
  } catch (e) {
    return res.status(500).json({ error: 'Design generation failed: ' + e.message });
  }

  const qid = 'NAC-' + String(b.client).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 10) + '-' + Date.now();

  var m2Match = pack.match(/CONDITIONED_M2:\s*([0-9]+(?:\.[0-9]+)?)/i);
  var area = m2Match ? parseFloat(m2Match[1]) : null;
  var kw = area ? Math.round(area * 145 / 100) / 10 : null;
  var prefillOptions = [];
  var optionsText = '';

  if (area) {
    pack = 'SIZE:            ' + kw + ' kW  (conditioned area ' + area + ' m2 x 145)\n' + pack;
  }

  if (kw) {
    var d = nearestModel(MODELS.Daikin, kw);
    var f = nearestModel(MODELS.Fujitsu, kw);
    var mi = nearestModel(MODELS.Midea, kw);
    prefillOptions = [
      { brand: 'Daikin', model: d.m, kw: d.kw },
      { brand: 'Fujitsu', model: f.m, kw: f.kw },
      { brand: 'Midea', model: mi.m, kw: mi.kw }
    ];
    optionsText =
      '\nSUGGESTED UNITS (nearest to ' + kw + 'kW):\n' +
      '1. Daikin  ' + d.kw + 'kW — ' + d.m + '\n' +
      '2. Fujitsu ' + f.kw + 'kW — ' + f.m + '\n' +
      '3. Midea   ' + mi.kw + 'kW — ' + mi.m + '\n' +
      'Optional add-on: AirTouch 5 zoning — $1,800 + GST\n';
  }

  // Minimal email — just the essentials. Full detail lives in admin.html.
  var unitsShort = '';
  if (prefillOptions.length) {
    unitsShort =
      'Units (set prices in admin):\n' +
      '  Daikin   ' + prefillOptions[0].model + '\n' +
      '  Fujitsu  ' + prefillOptions[1].model + '\n' +
      '  Midea    ' + prefillOptions[2].model + '\n' +
      '  + AirTouch 5 optional ($1,800+GST)\n';
  }

  var confMatch = pack.match(/CONFIDENCE:\s*([A-Za-z]+)/);
  var actMatch = pack.match(/ACTION:\s*([A-Za-z \/]+)/);
  var flagMatch = pack.match(/FLAGS:\s*(.+)/);
  var conf = confMatch ? confMatch[1].trim() : '-';
  var act = actMatch ? actMatch[1].trim() : '-';
  var flag = flagMatch ? flagMatch[1].trim() : 'None';

  var emailBody =
    (b.client || 'New lead') + (b.address ? (' — ' + b.address) : '') + '\n\n' +
    'Phone:  ' + (b.phone || '-') + '\n' +
    'Size:   ' + (kw ? (kw + 'kW (' + area + ' m2)') : 'see admin') + '\n' +
    'Confidence: ' + conf + '\n' +
    'Action: ' + act + '\n' +
    (flag && flag.toLowerCase() !== 'none' ? ('Flag:   ' + flag + '\n') : '') +
    '\n' + unitsShort +
    '\nDraft ref: ' + qid + '\n' +
    '(paste into admin.html to load full detail & price)';

  try {
    await fetch(NOTIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: 'NEW DRAFT: ' + b.client + (b.address ? (' — ' + b.address) : ''),
        body: emailBody,
        text: emailBody,
        message: emailBody
      })
    });
  } catch (e) { /* non-fatal */ }

  try {
    if (SUPA) {
      await fetch(SUPA_URL + '/rest/v1/nac_quotes', {
        method: 'POST',
        headers: { 'apikey': SUPA, 'Authorization': 'Bearer ' + SUPA, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          id: qid,
          client: b.client,
          job_desc: 'Ducted AC Supply & Install',
          line_items: JSON.stringify(prefillOptions.length ? prefillOptions.map(function(o){ return { name: o.brand + ' ' + o.model + ' ' + o.kw + 'kW', desc: o.kw + 'kW ducted reverse cycle system', price: 0, link: '', _brand: o.brand, _model: o.model, _kw: o.kw }; }) : [{ name: 'Draft — see notes', desc: 'Auto-generated from intake. Confirm size & set price.', price: 0, link: '' }]),
          notes: 'INTAKE DRAFT | ' + (b.phone || '') + ' | ' + (b.address || '') + '\n\n' + pack + optionsText,
          accepted: false
        })
      });
    }
  } catch (e) { /* non-fatal */ }

  return res.status(200).json({ ok: true, quoteId: qid });
}

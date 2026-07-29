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

  const isPdf = (b.mediaType || '').includes('pdf');
  const planBlock = {
    type: isPdf ? 'document' : 'image',
    source: { type: 'base64', media_type: b.mediaType || 'image/jpeg', data: b.planBase64 }
  };

  const prompt = `You are NAC Electrical Air & Refrigeration's INTERNAL design assistant. You never speak to customers. Produce SHORT DRAFT NOTES for the NAC team to review and quote from. It is a proposal, not a decision.

HARD SIZING RULE: 145 W/m2 on CONDITIONED floor area only.
CONDITIONED (count these): bedrooms, living, dining, family, kitchen, study, media/theatre, and hallways/entry.
EXCLUDED (never count): garage, laundry, bathrooms, ensuite, WC, walk-in-robes, pantry, alfresco, patio, verandah, porch, outdoor areas.
NO modifiers. Add conditioned rooms = ONE total. Total x 145 = ONE kW figure. Over 18kW = flag CUSTOM/DUAL.

CALCULATION: Do it ONCE. Add the conditioned rooms, multiply by 145, give ONE number. Do NOT produce low/mid/high estimates. Do NOT reconcile against any total-area label on the plan. Do NOT waffle or repeat yourself. If a conditioned room isn't dimensioned, make one quick assumption. If the plan is unreadable, say so and set confidence LOW.

Customer / job info:
- Name: ${b.client}
- Address: ${b.address || '-'}
- Property type: ${b.houseType || '-'}
- Existing AC: ${b.existingAC || '-'}
- Preferred brand: ${b.brand || 'no preference'}
- Notes: ${b.comments || '-'}

KEEP IT SHORT. These are quick notes anyone on the team can read and quote from — NOT a long report. No price. Plain text, no markdown, no asterisks, no tables.

Output EXACTLY this and nothing else:

SIZE:            [X] kW  (conditioned area [X] m2 x 145)
CONFIDENCE:      [HIGH / MEDIUM / LOW]
ACTION:          [READY TO QUOTE / NEEDS REVIEW / SITE VISIT FIRST]
FLAGS:           [one short line, or "None"]

ROOMS COUNTED:   [list conditioned rooms with m2, comma-separated on one line]
NOT COUNTED:     [excluded rooms, comma-separated on one line]

SUGGESTED SYSTEM: [one line — size + one or two suitable brands + AirTouch 5 if zoning suits]
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

  var planNote = b.planBase64
    ? ('Floor plan: attached by customer — view on the draft in admin.html:\n' + 'https://nac-quote-tool.vercel.app/admin.html')
    : 'Floor plan: none provided.';

  var emailBody =
    'NEW DRAFT — for review\n' +
    '========================================\n\n' +
    'CUSTOMER\n' +
    'Name:     ' + (b.client || '-') + '\n' +
    'Phone:    ' + (b.phone || '-') + '\n' +
    'Email:    ' + (b.email || '-') + '\n' +
    'Address:  ' + (b.address || '-') + '\n' +
    'Type:     ' + (b.houseType || '-') + '\n' +
    'Existing: ' + (b.existingAC || '-') + '\n' +
    'Brand:    ' + (b.brand || 'no preference') + '\n' +
    (b.comments ? ('Notes:    ' + b.comments + '\n') : '') +
    '\n----------------------------------------\n\n' +
    pack +
    '\n\n----------------------------------------\n' +
    planNote + '\n' +
    '(Draft ref: ' + qid + ')';

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
          line_items: JSON.stringify([{ name: 'Draft — see notes', desc: 'Auto-generated from intake. Confirm size & set price.', price: 0, link: '' }]),
          notes: 'INTAKE DRAFT | ' + (b.phone || '') + ' | ' + (b.address || '') + '\n\n' + pack,
          accepted: false
        })
      });
    }
  } catch (e) { /* non-fatal */ }

  return res.status(200).json({ ok: true, quoteId: qid });
}

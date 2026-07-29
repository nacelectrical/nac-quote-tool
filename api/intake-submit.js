// NAC — Intake form submission handler.
// Receives the form (with floor plan as base64), scans + sizes it, generates a draft
// design pack, emails Nick, and saves a draft nac_quotes record. One endpoint, whole flow.

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

  const prompt = `You are NAC Electrical Air & Refrigeration's INTERNAL design assistant. You never speak to customers. Produce a DRAFT design + approval pack for Nick to review. Everything is a proposal, not a decision.

HARD SIZING RULE: 145 W/m2 on CONDITIONED floor area only (exclude garage/alfresco/outdoor). NO modifiers for glazing, ceilings, insulation or orientation. capacity(W) = conditioned m2 x 145. Over 18kW = flag CUSTOM/DUAL, do not auto-spec.

NEVER invent measurements. If the plan has no scale or is unreadable, say so and set confidence low. Label all assumptions. Do NOT include any price.

Customer / job info:
- Name: ${b.client}
- Address: ${b.address || '-'}
- Property type: ${b.houseType || '-'}
- Existing AC: ${b.existingAC || '-'}
- Preferred brand: ${b.brand || 'no preference'}
- Notes: ${b.comments || '-'}

Analyse the attached floor plan, then produce in clean plain text (no markdown tables):

=== INTERNAL DESIGN REPORT ===
Room schedule (each room + m2, mark conditioned vs excluded, total conditioned area)
Calculated load & proposed system size (kW)
Recommended system + one alternative (Daikin, Fujitsu, Mitsubishi Electric, Mitsubishi Heavy, Midea)
Draft air distribution & zoning (AirTouch 5 default where zoning suits)
Assumptions made
Open questions needing site verification
Recommended accessories

=== APPROVAL PACK FOR NICK ===
Customer & property
Conditioned area & calculated load
Proposed system (first choice)
CONFIDENCE: high / medium / low
Key assumptions
Key risks / open questions
Size band for reference (NO dollar figure)
RECOMMENDATION: APPROVE / REVIEW / SITE VISIT REQUIRED`;

  let pack = '';
  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
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

  // Build a clean, readable email body (works even as plain text — real line breaks, no JSON noise)
  var planNote = imageBase64
    ? ('Floor plan: attached by customer — view it on the draft in admin.html:\n' + 'https://nac-quote-tool.vercel.app/admin.html')
    : 'Floor plan: none provided.';

  var emailBody =
    'NEW DRAFT — for your review\n' +
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
    '\n' + planNote + '\n\n' +
    'Open to price & send: https://nac-quote-tool.vercel.app/admin.html\n' +
    '(Draft ref: ' + qid + ')\n\n' +
    '========================================\n' +
    'DESIGN PACK\n' +
    '========================================\n\n' +
    pack;

  // Email Nick the pack
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

  // Save draft quote
  try {
    if (SUPA) {
      await fetch(SUPA_URL + '/rest/v1/nac_quotes', {
        method: 'POST',
        headers: { 'apikey': SUPA, 'Authorization': 'Bearer ' + SUPA, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          id: qid,
          client: b.client,
          job_desc: 'Ducted AC Supply & Install',
          line_items: JSON.stringify([{ name: 'Draft — see design pack', desc: 'Auto-generated from intake. Nick to confirm size & set price.', price: 0, link: '' }]),
          notes: 'INTAKE DRAFT | ' + (b.phone || '') + ' | ' + (b.address || '') + '\n\n' + pack,
          accepted: false
        })
      });
    }
  } catch (e) { /* non-fatal */ }

  return res.status(200).json({ ok: true, quoteId: qid });
}

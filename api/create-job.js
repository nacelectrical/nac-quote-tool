// NAC — Creates a ServiceM8 job when a customer accepts a quote.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const KEY = process.env.SERVICEM8_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'ServiceM8 API key not configured' });

  const b = req.body || {};
  const clientName = (b.clientName || '').trim();
  if (!clientName) return res.status(400).json({ error: 'clientName required' });

  const address = (b.address || '').trim();
  const phone = (b.phone || '').trim();
  const email = (b.email || '').trim();
  const description = (b.description || 'Ducted AC Supply & Install').trim();

  const H = { 'X-Api-Key': KEY, 'Accept': 'application/json', 'Content-Type': 'application/json' };
  const API = 'https://api.servicem8.com/api_1.0/';

  async function createRecord(path, body) {
    const r = await fetch(API + path, { method: 'POST', headers: H, body: JSON.stringify(body) });
    if (!r.ok) {
      const txt = await r.text();
      throw new Error(path + ' failed (' + r.status + '): ' + txt.slice(0, 200));
    }
    return r.headers.get('x-record-uuid') || r.headers.get('X-Record-UUID');
  }

  try {
    let companyUuid = null;
    const findUrl = API + "company.json?$filter=name eq '" + clientName.replace(/'/g, "''") + "'";
    const findRes = await fetch(findUrl, { headers: H });
    if (findRes.ok) {
      const found = await findRes.json();
      if (Array.isArray(found) && found.length > 0) companyUuid = found[0].uuid;
    }

    if (!companyUuid) {
      companyUuid = await createRecord('company.json', {
        name: clientName,
        address: address,
        active: 1
      });
    }

    if (companyUuid && (phone || email)) {
      try {
        const parts = clientName.split(' ');
        await createRecord('companycontact.json', {
          company_uuid: companyUuid,
          first: parts[0] || clientName,
          last: parts.slice(1).join(' '),
          email: email,
          mobile: phone,
          type: 'Billing',
          active: 1
        });
      } catch (e) { /* non-fatal */ }
    }

    const jobUuid = await createRecord('job.json', {
      company_uuid: companyUuid,
      job_address: address,
      job_description: description,
      status: 'Work Order',
      active: 1
    });

    return res.status(200).json({ ok: true, companyUuid: companyUuid, jobUuid: jobUuid });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

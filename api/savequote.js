export default async function handler(req, res) {
  if(req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  const SUPA_URL = 'https://icnznjhwybryizbdqrgx.supabase.co';
  const SUPA = process.env.SUPABASE_KEY;
  if(!SUPA) return res.status(500).json({error:'Supabase key not configured'});
  try {
    const r = await fetch(SUPA_URL+'/rest/v1/nac_quotes', {
      method: 'POST',
      headers: {'apikey':SUPA,'Authorization':'Bearer '+SUPA,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates'},
      body: JSON.stringify(req.body)
    });
    const text = await r.text();
    res.status(r.status).send(text);
  } catch(e) {
    res.status(500).json({error:e.message});
  }
}
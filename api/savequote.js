const https = require('https');

module.exports = async function handler(req, res) {
  if(req.method !== 'POST') return res.status(405).json({error:'Method not allowed'});
  const SUPA = process.env.SUPABASE_KEY;
  if(!SUPA) return res.status(500).json({error:'Supabase key not configured'});
  const body = JSON.stringify(req.body);
  const options = {
    hostname: 'icnznjhwybryizbdqrgx.supabase.co',
    path: '/rest/v1/nac_quotes',
    method: 'POST',
    headers: {
      'apikey': SUPA,
      'Authorization': 'Bearer ' + SUPA,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates',
      'Content-Length': Buffer.byteLength(body)
    }
  };
  return new Promise((resolve) => {
    const r = https.request(options, (response) => {
      let data = '';
      response.on('data', (chunk) => { data += chunk; });
      response.on('end', () => { res.status(response.statusCode).send(data||'ok'); resolve(); });
    });
    r.on('error', (e) => { res.status(500).json({error:e.message}); resolve(); });
    r.write(body);
    r.end();
  });
}
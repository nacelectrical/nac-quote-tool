export default async function handler(req, res) {
  const KEY = process.env.SERVICEM8_API_KEY;
  if (!KEY) return res.status(500).json({ error: 'API key not configured' });
  const jobId = req.query.jobId;
  if (!jobId) return res.status(400).json({ error: 'jobId required' });
  try {
    const jobUrl = 'https://api.servicem8.com/api_1.0/job.json?$filter=generated_job_id eq \'' + jobId + '\'';
    const jobRes = await fetch(jobUrl, { headers: { 'X-Api-Key': KEY, 'Accept': 'application/json' } });
    const jobs = await jobRes.json();
    if (!jobs || jobs.length === 0) return res.status(404).json({ error: 'Job not found' });
    const job = jobs[0];
    const compUrl = 'https://api.servicem8.com/api_1.0/company/' + job.company_uuid + '.json';
    const compRes = await fetch(compUrl, { headers: { 'X-Api-Key': KEY, 'Accept': 'application/json' } });
    const company = await compRes.json();
    const contactUrl = 'https://api.servicem8.com/api_1.0/companycontact.json?$filter=company_uuid eq \'' + job.company_uuid + '\'';
    const contactRes = await fetch(contactUrl, { headers: { 'X-Api-Key': KEY, 'Accept': 'application/json' } });
    const contacts = await contactRes.json();
    const emailContact = contacts.find(function(c){ return c.email; }) || {};
    res.status(200).json({
      jobId: job.generated_job_id,
      jobAddress: job.job_address,
      jobDescription: job.job_description || '',
      companyName: company.name || '',
      contactName: (emailContact.first || '') + ' ' + (emailContact.last || ''),
      contactEmail: emailContact.email || ''
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
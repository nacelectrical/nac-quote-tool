// Loads every page NAC ships and reports what actually renders, what errors,
// and what fails to load. Run against a static server on 127.0.0.1:8777.
//
//   node tools/serve.mjs &        (or any static server on that port)
//   node tools/page-health.mjs
//
// A page that renders but logs a page error is NOT healthy — check the
// "not network-blocked" count, which excludes hosts a sandbox may block.

import { chromium } from 'playwright';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PAGES=['index.html','admin.html','designer.html','intake.html','next.html','sign.html','splits.html','NAC — Your Ducted AC Details.html'];
const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});
for (const page of PAGES) {
  const p=await b.newPage({viewport:{width:1400,height:900}});
  const errs=[], warns=[], net=[];
  p.on('console',m=>{ if(m.type()==='error') errs.push(m.text().slice(0,160)); if(m.type()==='warning') warns.push(m.text().slice(0,90)); });
  p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message.slice(0,160)));
  p.on('requestfailed',r=>net.push(r.url().slice(0,90)+' :: '+(r.failure()?.errorText||'')));
  p.on('response',r=>{ if(r.status()>=400) net.push('HTTP '+r.status()+' '+r.url().slice(0,90)); });
  let bodyLen=0, title='', gated=false, gateLen=0;
  try {
    await p.goto('http://127.0.0.1:8777/'+encodeURIComponent(page).replace(/%2F/g,'/'), {waitUntil:'load', timeout:20000});
    await p.waitForTimeout(2500);
    // An internal page shows the staff sign-in gate to a visitor who is not
    // signed in, and the gate hides the page behind it — so innerText is
    // legitimately empty. Reporting that as "0 chars" reads like a dead page,
    // so the gate is detected and named instead.
    const seen = await p.evaluate(() => ({
      len: document.body.innerText.trim().length,
      gated: !!document.getElementById('nac-signin'),
      gateText: (document.getElementById('nac-signin')?.innerText || '').trim().length
    }));
    bodyLen = seen.len; gated = seen.gated; gateLen = seen.gateText;
    title=await p.title();
  } catch(e) { errs.push('NAV: '+e.message.slice(0,120)); }
  // Only errors that are NOT the blocked external hosts
  const real=errs.filter(e=>!/supabase|ERR_TUNNEL|Failed to load resource/i.test(e));
  const blocked=net.filter(n=>/supabase|googleapis|gstatic|cdn/i.test(n)).length;
  console.log(`\n== ${page}`);
  console.log(`   title: "${title}"  rendered text: ${bodyLen} chars` +
    (gated ? `  [STAFF SIGN-IN GATE shown — ${gateLen} chars; the page behind it is hidden, which is the point]` : ''));
  console.log(`   console errors: ${errs.length} (${real.length} not network-blocked)`);
  real.slice(0,6).forEach(e=>console.log('     ! '+e));
  console.log(`   failed requests: ${net.length} (${blocked} to blocked external hosts)`);
  net.filter(n=>!/supabase|googleapis|gstatic|cdn/i.test(n)).slice(0,5).forEach(n=>console.log('     ~ '+n));
  await p.close();
}
await b.close();

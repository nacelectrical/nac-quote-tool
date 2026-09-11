import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});

// A stub that behaves like a healthy project, so we can prove the test reports PASS
// only when the database really does each thing.
function healthy(){
  const t={nac_settings:new Map(),nac_quotes:new Map(),nac_designs:new Map()};
  return async route=>{
    const q=route.request(), u=q.url(), m=q.method();
    if(!/apikey=|/.test(u)){}
    const hdr=q.headers();
    if(!hdr['apikey']) return route.fulfill({status:401,body:'{"message":"No API key found"}'});
    const tbl=(/rest\/v1\/(\w+)/.exec(u)||[])[1];
    const store=t[tbl];
    if(!store) return route.fulfill({status:404,contentType:'application/json',body:'{"message":"relation does not exist"}'});
    const keyName = tbl==='nac_settings' ? 'key' : 'id';
    const idm=new RegExp(keyName+'=eq\\.([^&]+)').exec(u);
    const id=idm?decodeURIComponent(idm[1]):null;
    if(m==='POST'){ const b=JSON.parse(q.postData()||'{}'); store.set(b[keyName],{...(store.get(b[keyName])||{}),...b});
      return route.fulfill({status:201,contentType:'application/json',body:'[]'}); }
    if(m==='PATCH'){ const b=JSON.parse(q.postData()||'{}'); if(id&&store.has(id)) store.set(id,{...store.get(id),...b});
      return route.fulfill({status:204,body:''}); }
    if(m==='DELETE'){ if(id) store.delete(id); return route.fulfill({status:204,body:''}); }
    const rows = id ? (store.has(id)?[store.get(id)]:[]) : [...store.values()];
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(rows)});
  };
}
// A broken project: nac_designs missing, quotes reject writes.
function broken(){
  const h=healthy();
  return async route=>{
    const u=route.request().url();
    if(/nac_designs/.test(u)) return route.fulfill({status:404,contentType:'application/json',body:'{"message":"Could not find the table \'public.nac_designs\'"}'});
    if(/nac_quotes/.test(u) && route.request().method()==='POST')
      return route.fulfill({status:403,contentType:'application/json',body:'{"message":"new row violates row-level security policy"}'});
    return h(route);
  };
}

for (const [name,handler] of [['HEALTHY project',healthy()],['BROKEN project',broken()]]) {
  const ctx=await b.newContext(); const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('  [pageerror]',e.message.slice(0,120)));
  await p.route('**/rest/v1/**', handler);
  await p.goto('http://127.0.0.1:8777/db-selftest.html',{waitUntil:'load'});
  await p.click('#run'); await p.waitForTimeout(2500);
  const v=await p.evaluate(()=>document.getElementById('verdict').textContent);
  const rows=await p.evaluate(()=>[...document.querySelectorAll('.row')].map(r=>
    r.querySelector('.tag').textContent+' '+r.querySelector('.what').textContent));
  console.log('\n===== '+name+' =====');
  rows.forEach(r=>console.log('  '+r));
  console.log('  VERDICT: '+v.slice(0,110));
  await ctx.close();
}
await b.close();

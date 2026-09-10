import { chromium } from 'playwright';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b=await chromium.launch({executablePath:EXE,args:['--no-sandbox']});

async function scenario(name, {dbStatus=200, dbThrows=false}) {
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const store = new Map();      // stands in for the nac_settings table
  await p.route('**/rest/v1/nac_settings**', async route => {
    const req=route.request();
    if (dbThrows) return route.abort('connectionfailed');
    if (dbStatus>=400) return route.fulfill({status:dbStatus, contentType:'application/json', body:'{"message":"denied"}'});
    if (req.method()==='POST') {
      const body=JSON.parse(req.postData()||'{}');
      store.set(body.key, body.value);
      return route.fulfill({status:201, contentType:'application/json', body:'[]'});
    }
    const m=/key=eq\.([^&]+)/.exec(req.url());
    const k=m?decodeURIComponent(m[1]):null;
    const v=store.get(k);
    return route.fulfill({status:200, contentType:'application/json',
      body: JSON.stringify(v!==undefined?[{value:v}]:[])});
  });
  await p.goto('http://127.0.0.1:8777/index.html',{waitUntil:'load'});
  await p.waitForTimeout(1200);
  const r = await p.evaluate(async ()=>await window.storage.set('phase2_probe','hello-'+Date.now()));
  await p.waitForTimeout(300);
  const banner = await p.evaluate(()=>document.getElementById('nac-sync-warning')?.textContent||null);
  console.log(`${name.padEnd(24)} synced=${String(r.synced).padEnd(5)} ok=${String(r.ok).padEnd(5)} banner=${banner? 'SHOWN' : 'none'}`);
  if (banner) console.log('    "'+banner.slice(0,110)+'..."');
  await ctx.close();
  return {r, banner, store};
}

const good = await scenario('db accepts', {});
const denied = await scenario('db returns 401', {dbStatus:401});
const down = await scenario('db unreachable', {dbThrows:true});

console.log('\n--- assertions ---');
let fail=0; const check=(n,c)=>{console.log((c?'PASS  ':'FAIL  ')+n); if(!c)fail++;};
check('accepted write reports synced', good.r.synced===true && good.r.ok===true);
check('accepted write shows no banner', good.banner===null);
check('401 reports synced=false',       denied.r.synced===false);
check('401 shows the warning banner',   !!denied.banner && /DEVICE ONLY/.test(denied.banner));
check('401 banner states the reason',   /401/.test(denied.banner||''));
check('unreachable reports synced=false',down.r.synced===false);
check('unreachable shows the banner',   !!down.banner);
console.log(fail? `\n${fail} FAILED` : '\nALL PASSED');
await b.close();
process.exit(fail?1:0);

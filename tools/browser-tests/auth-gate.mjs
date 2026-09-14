import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
let fail=0; const say=(n,c,extra)=>{console.log(`  ${c?'PASS':'FAIL'}  ${n}${extra?'  — '+extra:''}`); if(!c)fail++;};

// Stub Supabase Auth: one valid staff account.
const VALID={email:'nick@nacelectrical.com.au', password:'correct-horse'};
async function ctxWith({signedIn=false}={}){
  const ctx=await b.newContext({viewport:{width:1400,height:1000}});
  const seenAuth=[];
  await ctx.route('**/auth/v1/**', async r=>{
    const u=r.request().url();
    if(/logout/.test(u)) return r.fulfill({status:204,body:''});
    const body=JSON.parse(r.request().postData()||'{}');
    seenAuth.push(body.email);
    if(body.email===VALID.email && body.password===VALID.password)
      return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        access_token:'STAFF-TOKEN-123', refresh_token:'r', expires_in:3600,
        expires_at:Math.floor(Date.now()/1000)+3600, user:{id:'u1',email:VALID.email}})});
    return r.fulfill({status:400,contentType:'application/json',
      body:JSON.stringify({error_description:'Invalid login credentials'})});
  });
  const dbAuth=[];
  await ctx.route('**/rest/v1/**', async r=>{
    dbAuth.push(r.request().headers()['authorization']||'');
    return r.fulfill({status:200,contentType:'application/json',body:'[]'});
  });
  if(signedIn){
    const p=await ctx.newPage();
    await p.goto('http://127.0.0.1:8777/designer.html');
    await p.evaluate(()=>localStorage.setItem('nac_session_v1', JSON.stringify({
      access_token:'STAFF-TOKEN-123', expires_at:Math.floor(Date.now()/1000)+3600,
      user:{email:'nick@nacelectrical.com.au'}})));
    await p.close();
  }
  return {ctx, seenAuth, dbAuth};
}

console.log('\n[1] UNAUTHENTICATED visitor opens each internal page');
for (const page of ['designer.html','admin.html','index.html']) {
  const {ctx, dbAuth}=await ctxWith();
  const p=await ctx.newPage();
  p.on('pageerror',e=>console.log('   [pageerror]',e.message.slice(0,110)));
  await p.goto('http://127.0.0.1:8777/'+page,{waitUntil:'load'});
  await p.waitForTimeout(2200);
  const gate=await p.evaluate(()=>!!document.getElementById('nac-signin'));
  // Present in the DOM is not the same as ON SCREEN. Hiding the whole document
  // once hid the sign-in screen along with it, leaving a blank page and no way
  // in — so the form is checked for being visible and usable, not just there.
  const usable=await p.evaluate(()=>{
    const g=document.getElementById('nac-signin');
    if(!g) return null;
    const cs=getComputedStyle(g), r=g.getBoundingClientRect();
    const email=document.getElementById('nac-email');
    const btn=document.getElementById('nac-go');
    return { visibility:cs.visibility, display:cs.display, opacity:Number(cs.opacity),
             w:Math.round(r.width), h:Math.round(r.height),
             emailVisible: !!email && getComputedStyle(email).visibility==='visible',
             buttonVisible: !!btn && getComputedStyle(btn).visibility==='visible',
             text:(g.innerText||'').trim().length };
  });
  const visible=await p.evaluate(()=>{
    const g=document.getElementById('nac-signin');
    const all=document.body.innerText||'';
    const gateText=g? g.innerText : '';
    return all.replace(gateText,'').trim();
  });
  console.log(`  ${page}`);
  say('    sign-in screen is shown', gate);
  say('    it is actually ON SCREEN, not hidden with the page',
    !!usable && usable.visibility==='visible' && usable.display!=='none' && usable.opacity>0.9 &&
    usable.w>200 && usable.h>200,
    usable? JSON.stringify({v:usable.visibility,w:usable.w,h:usable.h}) : 'no gate');
  say('    the email box and Sign in button can be seen and used',
    !!usable && usable.emailVisible && usable.buttonVisible);
  say('    it says something, rather than being a blank screen',
    !!usable && usable.text>30, usable? usable.text+' chars of gate text' : '0');
  say('    NO page content is readable', visible.length<40, visible.length+' chars behind the gate');
  say('    no data was fetched before sign-in', dbAuth.length===0, dbAuth.length+' db calls');
  await ctx.close();
}

console.log('\n[2] Wrong password is refused');
{
  const {ctx}=await ctxWith();
  const p=await ctx.newPage();
  await p.goto('http://127.0.0.1:8777/designer.html',{waitUntil:'load'}); await p.waitForTimeout(1500);
  await p.fill('#nac-email','nick@nacelectrical.com.au');
  await p.fill('#nac-pass','WRONG');
  await p.click('#nac-go'); await p.waitForTimeout(1200);
  const err=await p.evaluate(()=>document.getElementById('nac-err')?.textContent||'');
  const still=await p.evaluate(()=>!!document.getElementById('nac-signin'));
  say('  refused with a clear message', /do not match/i.test(err), JSON.stringify(err));
  say('  still gated', still);
  await ctx.close();
}

console.log('\n[3] Correct password signs in, and the token reaches the database');
{
  const {ctx, dbAuth}=await ctxWith();
  const p=await ctx.newPage();
  await p.goto('http://127.0.0.1:8777/designer.html',{waitUntil:'load'}); await p.waitForTimeout(1500);
  await p.fill('#nac-email','nick@nacelectrical.com.au');
  await p.fill('#nac-pass','correct-horse');
  await p.click('#nac-go'); await p.waitForTimeout(3000);
  const gone=await p.evaluate(()=>!document.getElementById('nac-signin'));
  const content=await p.evaluate(()=>(document.body.innerText||'').length);
  say('  the gate is removed', gone);
  say('  the designer renders', content>300, content+' chars');
  const withToken=dbAuth.filter(a=>/STAFF-TOKEN-123/.test(a)).length;
  say('  db requests carry the STAFF token, not the anon key', withToken>0 && dbAuth.every(a=>/STAFF-TOKEN-123/.test(a)),
      withToken+'/'+dbAuth.length+' requests');
  await ctx.close();
}

console.log('\n[4] The session survives a reload (no re-login every page)');
{
  const {ctx}=await ctxWith({signedIn:true});
  const p=await ctx.newPage();
  await p.goto('http://127.0.0.1:8777/designer.html',{waitUntil:'load'}); await p.waitForTimeout(2000);
  say('  no sign-in screen for an already-signed-in user',
      await p.evaluate(()=>!document.getElementById('nac-signin')));
  await ctx.close();
}

console.log('\n[5] An EXPIRED session is not accepted');
{
  const {ctx}=await ctxWith();
  const p=await ctx.newPage();
  await p.goto('http://127.0.0.1:8777/designer.html');
  await p.evaluate(()=>localStorage.setItem('nac_session_v1', JSON.stringify({
    access_token:'OLD', expires_at:Math.floor(Date.now()/1000)-60, user:{email:'x@y.z'}})));
  await p.reload({waitUntil:'load'}); await p.waitForTimeout(2000);
  say('  expired session is treated as signed out',
      await p.evaluate(()=>!!document.getElementById('nac-signin')));
  await ctx.close();
}

console.log('\n[6] CUSTOMER pages still work with no account');
for (const page of ['sign.html?q=TEST','intake.html','next.html']) {
  const {ctx}=await ctxWith();
  const p=await ctx.newPage();
  await p.goto('http://127.0.0.1:8777/'+page,{waitUntil:'load'}); await p.waitForTimeout(1800);
  const gated=await p.evaluate(()=>!!document.getElementById('nac-signin'));
  const text=await p.evaluate(()=>(document.body.innerText||'').trim().length);
  say('  '+page+' is NOT gated', !gated);
  say('  '+page+' renders', text>60, text+' chars');
  await ctx.close();
}
console.log(fail?`\n${fail} FAILED`:'\nALL PASSED');
await b.close(); process.exit(fail?1:0);

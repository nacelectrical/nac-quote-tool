import { chromium } from 'playwright';
import { ensureAdvanced } from './advanced.mjs';
import { signInContext } from './signin.mjs';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
let fail=0; const say=(n,c)=>{console.log(`  ${c?'PASS':'FAIL'}  ${n}`); if(!c)fail++;};

async function session({priceTheGaps=false, acceptPrices=true}={}){
  const ctx=await b.newContext({viewport:{width:1400,height:1000}});
  await signInContext(ctx);
  // Toasts live for 3.2s. Reading the DOM at the end of the run misses any that
  // fired while a dialog was being answered, so record them as they appear.
  await ctx.addInitScript(()=>{
    window.__toasts=[];
    new MutationObserver(ms=>{ for(const m of ms) for(const n of m.addedNodes)
      if(n.nodeType===1 && /(^|\s)toast(\s|$)/.test(n.className||'')) window.__toasts.push(n.textContent); })
      .observe(document,{childList:true,subtree:true});
  });
  const p=await ctx.newPage(); const quotes=[]; const dialogs=[];
  p.on('pageerror',e=>console.log('   [pageerror]',e.message.slice(0,120)));
  // Catch-all FIRST: Playwright matches the most recently added route first,
  // so a catch-all registered last would swallow the specific one.
  await p.route('**/rest/v1/**', r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await p.route('**/rest/v1/nac_quotes**', r=>{
    if(r.request().method()==='POST') quotes.push(JSON.parse(r.request().postData()||'{}'));
    return r.fulfill({status:201,contentType:'application/json',body:'[]'}); });
  // The questions are real in-page dialogs now, not the browser's confirm().
  // A native one appearing would be a regression, so record it and fail loudly.
  const native=[];
  p.on('dialog', async d=>{ native.push(d.type()+': '+d.message().slice(0,80)); await d.dismiss(); });

  // Answer every dialog the quote flow raises, recording what it said.
  async function answerDialogs(){
    for(let i=0;i<5;i++){
      const host=p.locator('.dlg-host');
      try { await host.waitFor({state:'visible',timeout:2500}); } catch(e){ return; }
      const title=await p.locator('.dlg-head h3').innerText();
      const body =await p.locator('.dlg-body').innerText();
      dialogs.push({type:'dialog',msg:title+'\n'+body});
      const decline = /UNCONFIRMED MATERIAL PRICES/.test(title) && !acceptPrices;
      await p.locator(decline?'.dlg-btn.ghost':'.dlg-btn.primary').first().click();
      await p.waitForTimeout(600);
    }
  }

  await p.goto('http://127.0.0.1:8777/designer.html',{waitUntil:'load'}); await p.waitForTimeout(1200);
  await p.locator('button',{hasText:'Load the sample builder plan'}).first().click(); await p.waitForTimeout(2500);
  await ensureAdvanced(p); await p.locator('button.tab',{hasText:'Rooms'}).first().click(); await p.waitForTimeout(600);
  const va=p.locator('button',{hasText:'Verify all'}); if(await va.count()) await va.last().click();
  await p.waitForTimeout(1800);

  // Put a line with NO COST AT ALL into the job, the way one really turns up.
  //
  // This used to happen by itself: the auto design fitted 150 mm zone dampers
  // and no 150 damper is on the MMEM list, so every job had an unpriced line.
  // NAC's minimum is now 200 and every size the AUTO design picks is priced —
  // which is the right outcome, but it left this gate with nothing to catch.
  //
  // So the gap is created the way it still can be: the estimator drops one
  // branch to 150 by hand, which NAC allows as a special case. There is no 150
  // damper on the price list, so the job now has a line with no cost, and the
  // gate has to stop the quote.
  await p.evaluate(async ()=>{
    const app=window.nacDesigner;
    // A damper size that is not on the price list yet — which is exactly how an
    // unpriced line turns up in real life when a supplier drops or renames a
    // size. Removing the rate is the closest thing to that the app can be made
    // to do now that every size the auto design picks is priced.
    const m=await import('/designer/engines/materials.mjs');
    for (const d of Object.keys(m.MATERIAL_CATALOGUE.zone_motor.byDiameter)) {
      delete m.MATERIAL_CATALOGUE.zone_motor.byDiameter[d];
    }
    m.MATERIAL_CATALOGUE.zone_motor.cost=null;
    app.update();
  });
  await p.waitForTimeout(1200);

  if (priceTheGaps){
    // ── AND A LINE ON A SHIPPED PLACEHOLDER RATE ──────────────────────────
    //
    // This step needs a rate nobody at NAC has confirmed, and the sample used
    // to supply six of them for free: the feet, the drain kit, the two cables,
    // the isolator and the sundries all shipped with a guessed price. They do
    // not any more — NAC set what they charge for those, so the design now has
    // no placeholder rates at all, which is the right outcome and leaves this
    // gate with nothing to catch.
    //
    // So the condition is created the same way the unpriced one above is: a
    // few lines lose the supplier attribution that makes their rate real,
    // which is exactly what a rate carried over from an expired quotation is.
    await p.evaluate(async ()=>{
      const m=await import('/designer/engines/materials.mjs');
      for (const k of ['duct_tape','drain_pipe','drain_elbow','drain_insulation']) {
        if (m.MATERIAL_CATALOGUE[k]) delete m.MATERIAL_CATALOGUE[k].source;
      }
      window.nacDesigner.update();
    });
    await p.waitForTimeout(1200);

    // What the estimator would do: give the lines with no cost a real cost.
    await ensureAdvanced(p); await p.locator('button.tab',{hasText:'Materials'}).first().click(); await p.waitForTimeout(900);
    // One at a time, as a person would — the app re-renders after each edit.
    let n=0;
    for(let pass=0; pass<6; pass++){
      const idx = await p.evaluate(()=>{
        const rows=[...document.querySelectorAll('.main table tbody tr')];
        return rows.findIndex(r=>{
          const tds=[...r.querySelectorAll('td')];
          const total=tds[tds.length-2];
          return total && total.textContent.trim()==='—' && r.querySelector('input[type=number]');
        });
      });
      if(idx<0) break;
      const cost = p.locator('.main table tbody tr').nth(idx).locator('input[type=number]').last();
      await cost.fill('48');
      await cost.evaluate(e=>e.blur());
      await p.waitForTimeout(800);
      n++;
    }
    await p.waitForTimeout(1200);
    console.log('   priced', n, 'previously-unpriced line(s) at $48');
  }

  await ensureAdvanced(p); await p.locator('button.tab',{hasText:'Financials'}).first().click(); await p.waitForTimeout(900);
  await p.locator('button',{hasText:'ADD DESIGN TO QUOTE'}).first().click(); await p.waitForTimeout(600);
  await answerDialogs();
  await p.waitForTimeout(1800);
  const toasts=await p.evaluate(()=>(window.__toasts||[]).join(' || '));
  await ctx.close();
  return {dialogs,quotes,toasts,native};
}

console.log('\n[A] a line with NO cost at all');
const a=await session({priceTheGaps:false});
say('the quote is BLOCKED', a.quotes.length===0);
// The damper line was called "Zone motor" until the component was remodelled
// as a real inline motorised damper with its own diameter and actuator. The
// toast has named it correctly ever since — "Motorised zone damper ø250 —
// 24 V actuator" — and only this expectation was left behind. What the step
// is actually about is that the estimator is told WHICH lines are unpriced,
// by name, rather than just that something is missing.
say('the estimator is told which lines',
  /have no cost at all/.test(a.toasts)
  && /Motorised zone damper ø\d+/i.test(a.toasts)
  && /Fabricated BTO branch take-off/i.test(a.toasts),
  String(a.toasts).slice(0, 160));
say('no native confirm() was used', a.native.length===0);

console.log('\n[B] gaps priced, but placeholder rates remain — estimator DECLINES');
const bRes=await session({priceTheGaps:true, acceptPrices:false});
const dlg=bRes.dialogs.find(d=>/UNCONFIRMED MATERIAL PRICES/.test(d.msg));
say('the estimator is shown the unconfirmed prices', !!dlg);
if(dlg){
  say('it names how many lines', /\d+ line\(s\) use shipped placeholder/.test(dlg.msg));
  say('it states the dollars at risk', /worth \$[\d,]+\.\d\d of the \$/.test(dlg.msg));
  // The lines are list items in the dialog now, not bullets in a text blob.
  say('it itemises them with qty and rate',
    (dlg.msg.match(/@ \$[\d.]+ = \$[\d.]+/g)||[]).length>=3);
  console.log('   ---'); dlg.msg.split('\n').slice(0,9).forEach(l=>console.log('   '+l));
}
console.log('   dialogs:', bRes.dialogs.map(d=>d.type+':'+d.msg.split('\n')[0].slice(0,56)).join(' | '));
console.log('   toasts :', (bRes.toasts||'(none)').slice(0,200));
say('NO quote created when declined', bRes.quotes.length===0);

console.log('\n[C] estimator ACCEPTS, having seen it');
const c=await session({priceTheGaps:true, acceptPrices:true});
say('the quote is created', c.quotes.length===1);
say('no native confirm() was used anywhere', c.native.length===0 && bRes.native.length===0);
console.log(fail?`\n${fail} FAILED`:'\nALL PASSED');
await b.close(); process.exit(fail?1:0);

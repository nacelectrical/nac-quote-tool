import { chromium } from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
let fail=0; const say=(n,c)=>{console.log(`  ${c?'PASS':'FAIL'}  ${n}`); if(!c)fail++;};

async function session({priceTheGaps=false, acceptPrices=true}={}){
  const ctx=await b.newContext({viewport:{width:1400,height:1000}});
  const p=await ctx.newPage(); const quotes=[]; const dialogs=[];
  p.on('pageerror',e=>console.log('   [pageerror]',e.message.slice(0,120)));
  // Catch-all FIRST: Playwright matches the most recently added route first,
  // so a catch-all registered last would swallow the specific one.
  await p.route('**/rest/v1/**', r=>r.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await p.route('**/rest/v1/nac_quotes**', r=>{
    if(r.request().method()==='POST') quotes.push(JSON.parse(r.request().postData()||'{}'));
    return r.fulfill({status:201,contentType:'application/json',body:'[]'}); });
  p.on('dialog', async d=>{ dialogs.push({type:d.type(),msg:d.message()});
    if(d.type()!=='confirm') return d.accept('ok');
    if(/UNCONFIRMED MATERIAL PRICES/.test(d.message())) return acceptPrices? d.accept() : d.dismiss();
    return d.accept();            // acknowledge the critical-warning prompt
  });

  await p.goto('http://127.0.0.1:8777/designer.html',{waitUntil:'load'}); await p.waitForTimeout(1200);
  await p.locator('button',{hasText:'Load the sample builder plan'}).first().click(); await p.waitForTimeout(2500);
  await p.locator('button.tab',{hasText:'Rooms'}).first().click(); await p.waitForTimeout(600);
  const va=p.locator('button',{hasText:'Verify all'}); if(await va.count()) await va.last().click();
  await p.waitForTimeout(1800);

  if (priceTheGaps){
    // What the estimator would do: give the lines with no cost a real cost.
    await p.locator('button.tab',{hasText:'Materials'}).first().click(); await p.waitForTimeout(900);
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

  await p.locator('button.tab',{hasText:'Financials'}).first().click(); await p.waitForTimeout(900);
  await p.locator('button',{hasText:'ADD DESIGN TO QUOTE'}).first().click(); await p.waitForTimeout(2500);
  const toasts=await p.evaluate(()=>[...document.querySelectorAll('[class*=toast]')].map(e=>e.textContent).join(' || '));
  await ctx.close();
  return {dialogs,quotes,toasts};
}

console.log('\n[A] a line with NO cost at all');
const a=await session({priceTheGaps:false});
say('the quote is BLOCKED', a.quotes.length===0);
say('the estimator is told which lines', /have no cost at all/.test(a.toasts) && /Zone motor/.test(a.toasts));

console.log('\n[B] gaps priced, but placeholder rates remain — estimator DECLINES');
const bRes=await session({priceTheGaps:true, acceptPrices:false});
const dlg=bRes.dialogs.find(d=>/UNCONFIRMED MATERIAL PRICES/.test(d.msg));
say('the estimator is shown the unconfirmed prices', !!dlg);
if(dlg){
  say('it names how many lines', /\d+ line\(s\) use shipped placeholder/.test(dlg.msg));
  say('it states the dollars at risk', /worth \$[\d,]+\.\d\d of the \$/.test(dlg.msg));
  say('it itemises them with qty and rate', (dlg.msg.match(/ · /g)||[]).length>=3 && /@ \$/.test(dlg.msg));
  console.log('   ---'); dlg.msg.split('\n').slice(0,9).forEach(l=>console.log('   '+l));
}
console.log('   dialogs:', bRes.dialogs.map(d=>d.type+':'+d.msg.split('\n')[0].slice(0,56)).join(' | '));
console.log('   toasts :', (bRes.toasts||'(none)').slice(0,200));
say('NO quote created when declined', bRes.quotes.length===0);

console.log('\n[C] estimator ACCEPTS, having seen it');
const c=await session({priceTheGaps:true, acceptPrices:true});
say('the quote is created', c.quotes.length===1);
console.log(fail?`\n${fail} FAILED`:'\nALL PASSED');
await b.close(); process.exit(fail?1:0);

// e2e for WebPush / VAPID (task C).
// Verifies: VAPID public key is served, and the push-subscription endpoint
// stores a subscription for the authed user. The in-memory JWT is captured
// from the page's own authenticated requests (the app never persists it to
// localStorage), then reused for direct API calls with the X-Crypt-Token header.
import pkg from '/root/aetherlink/frontend/node_modules/playwright/index.js';
const { chromium } = pkg;
const BASE='http://localhost:3000', API='http://127.0.0.1:9090';
const rand=Math.random().toString(36).slice(2,8);
const n=`PU_${rand}`;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
let fails=0; const step=(s)=>console.log('• '+s); const ok=(s)=>console.log('  ✓ '+s); const bad=(s)=>{console.log('  ✗ '+s);fails++;};
async function reg(p,name){for(let i=1;i<=5;i++){const b=p.getByRole('button',{name:/Créer mon identité chiffrée/i});await p.getByPlaceholder('Votre identité').fill(name);await b.click();try{await b.waitFor({state:'detached',timeout:12000});return;}catch(_){const body=await p.locator('body').innerText().catch(()=>'');if(/rate-limited/i.test(body)){await sleep(22000);continue;}throw new Error('reg '+body.slice(0,120));}}throw new Error('reg');}
const browser=await chromium.launch({args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu']});
const context=await browser.newContext({ permissions:['notifications'] });
const page=await context.newPage();
let token=null;
page.on('request',req=>{const h=req.headers()['x-crypt-token'];if(h)token=h;});
page.on('pageerror',e=>console.log('[pageerror]',e.message.slice(0,160)));
await page.goto(BASE,{waitUntil:'networkidle'});
step('register a user');
await reg(page,n);
await page.getByText(n,{exact:true}).first().waitFor({timeout:30000});
ok('registered');

// Wait for the page to emit an authenticated request so we can capture the JWT.
step('capture auth token from page requests');
for(let i=0;i<40 && !token;i++) await sleep(500);
if(!token){ bad('no auth token observed'); } else { ok('token captured'); }

const headers={'Content-Type':'application/json','X-Crypt-Token':token||''};
step('GET /api/push/vapid returns a VAPID public key');
let vapid=null;
try{
  const r=await fetch(`${API}/api/push/vapid`,{headers});
  const j=await r.json();
  vapid=j.publicKey;
  if(r.status===200 && typeof vapid==='string' && vapid.length>=80){
    ok(`VAPID public key served (${vapid.length} chars)`);
  } else { bad(`unexpected vapid response: ${r.status} ${JSON.stringify(j).slice(0,120)}`); }
}catch(e){ bad('vapid fetch failed: '+e.message); }

step('POST /api/push/subscribe stores a subscription');
try{
  const fakeSub={endpoint:'https://push.example.invalid/fake-sub-'+rand,keys:{p256dh:'BJj2xP3fakefakefakefakefakefakefakefakefakefakefakefakefake=',auth:'ZmFrZUF1dGhLZXk='}};
  const r=await fetch(`${API}/api/push/subscribe`,{method:'POST',headers,body:JSON.stringify(fakeSub)});
  const j=await r.json().catch(()=>({}));
  if(r.status===201 && j.status==='ok'){ ok('subscription accepted (201)'); }
  else { bad(`subscribe failed: ${r.status} ${JSON.stringify(j).slice(0,160)}`); }
}catch(e){ bad('subscribe fetch failed: '+e.message); }

// Confirm the app still runs cleanly after the push flow (no crash, SW present).
step('app healthy after push flow');
const swOk=await page.evaluate(async()=>{try{const r=await navigator.serviceWorker.getRegistration();return !!r;}catch{return false;}});
if(swOk) ok('service worker registered'); else console.log('  (info) SW not yet registered in this short session — non-fatal');

await browser.close();
console.log('\nPUSH_RESULT: '+(fails===0?'PASS — VAPID + push endpoint verified':'FAIL ('+fails+' issue(s))'));
process.exit(fails===0?0:1);

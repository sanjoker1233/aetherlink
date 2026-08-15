// Focused real-browser E2E for group (multi-member) conversations:
// Alice creates a group with Bob + Carol, sends a message, and BOTH recipients
// receive it (backend fan-out). Exercises the full UI path end-to-end.
import pkg from '/root/aetherlink/frontend/node_modules/playwright/index.js';
const { chromium } = pkg;

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const E2E_VP = (() => { const [w, h] = (process.env.E2E_VIEWPORT || '1280x900').split('x').map(Number); return { width: w || 1280, height: h || 900 }; })();

const rand = Math.random().toString(36).slice(2, 8);
const aliceName = `Grp_Alice_${rand}`;
const bobName = `Grp_Bob_${rand}`;
const carolName = `Grp_Carol_${rand}`;
const groupName = `Groupe_${rand}`;
const groupMsg = `hello group ${rand}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function registerUser(page, name) {
  for (let a = 1; a <= 5; a++) {
    const b = page.getByRole('button', { name: /Créer mon identité chiffrée/i });
    await page.getByPlaceholder('Votre identité').fill(name);
    await b.click();
    try { await b.waitFor({ state: 'detached', timeout: 30000 }); return; }
    catch (_) { const body = await page.locator('body').innerText().catch(() => ''); if (/rate-limited/i.test(body)) { await sleep(22000); continue; } throw new Error('reg: ' + body.slice(0, 150)); }
  }
  throw new Error('registration failed after retries');
}

async function shareIdentity(page) {
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  await page.getByRole('button', { name: /Partager mon identité/i }).click();
  const uriEl = page.locator('p').filter({ hasText: 'cryptm://' }).first();
  await uriEl.waitFor({ timeout: 10000 });
  const uri = (await uriEl.textContent()).trim();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  return uri;
}

async function addContact(page, uri) {
  await page.getByRole('button', { name: 'Contacts', exact: true }).click();
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const inp = page.getByPlaceholder(/Collez le lien ou l'empreinte CRYPTMessenger/i);
  await inp.waitFor({ timeout: 10000 });
  await inp.fill(uri);
  await page.getByRole('button', { name: /Analyser et envoyer/i }).click();
  await page.getByText(/Demande de contact envoyée/i).waitFor({ timeout: 10000 });
}

// Accept every pending contact request until none remain.
async function acceptAll(page) {
  await page.getByRole('button', { name: 'Contacts', exact: true }).click().catch(() => {});
  const sel = page.getByRole('button', { name: 'Accepter', exact: true });
  await sel.first().waitFor({ timeout: 20000 }).catch(() => {});
  for (let i = 0; i < 20; i++) {
    const btns = page.getByRole('button', { name: 'Accepter', exact: true });
    if (await btns.count() === 0) { await sleep(600); continue; }
    await btns.first().click();
    await sleep(900);
  }
}

// Open the recipient's Messages tab, wait for the group conversation to appear
// in the chat list (ensureConversation pulls it from the server on message
// arrival), open it, and confirm the message is visible.
async function checkRecipient(page, convName, msg) {
  await page.getByRole('button', { name: 'Messages', exact: true }).click();
  await page.getByText(convName, { exact: false }).first().waitFor({ timeout: 15000 });
  await page.getByText(convName, { exact: false }).first().click();
  await page.getByText(msg, { exact: false }).first().waitFor({ timeout: 15000 });
}

let failures = 0;
const ok = (m) => console.log('  ✓', m);
const bad = (m) => { failures++; console.error('  ✗', m); };
const step = (m) => console.log('•', m);

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
try {
  const ctxA = await browser.newContext({ viewport: E2E_VP });
  const ctxB = await browser.newContext({ viewport: E2E_VP });
  const ctxC = await browser.newContext({ viewport: E2E_VP });
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();
  const carol = await ctxC.newPage();
  for (const p of [alice, bob, carol]) p.setDefaultTimeout(120000);

  step('register 3 users');
  await alice.goto(BASE, { waitUntil: 'networkidle' });
  await bob.goto(BASE, { waitUntil: 'networkidle' });
  await carol.goto(BASE, { waitUntil: 'networkidle' });
  await registerUser(alice, aliceName);
  await registerUser(bob, bobName);
  await registerUser(carol, carolName);
  await alice.getByText(aliceName, { exact: true }).first().waitFor({ timeout: 30000 });
  ok('all 3 registered');

  step('Bob + Carol add Alice (so Alice has them as contacts)');
  const aliceURI = await shareIdentity(alice);
  await addContact(bob, aliceURI);
  await addContact(carol, aliceURI);
  await acceptAll(alice);
  let bobOk = false, carolOk = false;
  for (let i = 0; i < 20; i++) {
    bobOk = (await alice.getByText(bobName, { exact: true }).first().count()) > 0;
    carolOk = (await alice.getByText(carolName, { exact: true }).first().count()) > 0;
    if (bobOk && carolOk) break;
    await sleep(500);
  }
  if (bobOk) ok('Alice has Bob'); else bad('Alice missing Bob contact');
  if (carolOk) ok('Alice has Carol'); else bad('Alice missing Carol contact');
  if (!bobOk || !carolOk) throw new Error('contacts not established');

  step('Alice creates group with Bob + Carol');
  await alice.getByRole('button', { name: 'Contacts', exact: true }).click();
  await alice.getByRole('button', { name: 'Nouveau groupe', exact: true }).click();
  const modal = alice.locator('[role="dialog"]').first();
  await modal.waitFor({ timeout: 10000 });
  for (const n of [bobName, carolName]) {
    const lbl = modal.locator('label', { hasText: n });
    await lbl.waitFor({ timeout: 10000 });
    await lbl.click();
  }
  const nameInput = alice.getByPlaceholder(/Nom du groupe/i);
  if (await nameInput.count() > 0) await nameInput.fill(groupName);
  await alice.getByRole('button', { name: 'Créer', exact: true }).click();
  await modal.waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  ok('group created');

  step('Alice sends a group message');
  const input = alice.getByLabel('Message', { exact: true });
  await input.waitFor({ timeout: 10000 });
  await input.fill(groupMsg);
  await input.press('Enter');
  await alice.getByText(groupMsg, { exact: false }).first().waitFor({ timeout: 10000 });
  ok('group message sent by Alice');

  step('Bob receives it');
  await checkRecipient(bob, groupName, groupMsg);
  ok('Bob received group message');

  step('Carol receives it');
  await checkRecipient(carol, groupName, groupMsg);
  ok('Carol received group message');

  await ctxA.close(); await ctxB.close(); await ctxC.close();
} catch (e) {
  bad('E2E threw: ' + e.message);
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\nGROUP_RESULT: FAIL (${failures} issue(s))`);
  process.exit(1);
} else {
  console.log('\nGROUP_RESULT: PASS — group fan-out works end-to-end');
  process.exit(0);
}

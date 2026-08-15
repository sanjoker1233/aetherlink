// Live "contact_decline" proof against the RUNNING backend (default :9090).
// Carol sends a contact request to Dave. Dave declines. Dave reloads the page
// (WS reconnect). If the server actually handles contact_decline, the pending
// request was removed server-side and is NOT redelivered after reconnect.
// If the server LACKS the handler, the pending stays and is redelivered → FAIL.
// UI strings are French (i18n FR default).
import pkg from '/root/aetherlink/frontend/node_modules/playwright/index.js';
const { chromium } = pkg;

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const rand = Math.random().toString(36).slice(2, 8);
const carolName = `E2E_Carol_${rand}`;
const daveName = `E2E_Dave_${rand}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (m) => console.log('  ✓', m);
const bad = (m) => { failures++; console.error('  ✗', m); };
const step = (m) => console.log('•', m);

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

try {
  const ctxC = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxD = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const carol = await ctxC.newPage();
  const dave = await ctxD.newPage();

  const carolErrors = [];
  carol.on('console', (m) => { if (m.type() === 'error') carolErrors.push(m.text()); });
  const daveErrors = [];
  dave.on('console', (m) => { if (m.type() === 'error') daveErrors.push(m.text()); });

  step('Carol registers');
  await carol.goto(BASE, { waitUntil: 'networkidle' });
  await carol.getByPlaceholder('Votre identité').fill(carolName);
  await carol.getByRole('button', { name: /Créer mon identité chiffrée/i }).click();
  await carol.getByRole('button', { name: 'Réglages', exact: true }).waitFor({ timeout: 25000 });
  ok('Carol authenticated');
  await sleep(6000);

  step('Dave registers');
  await dave.goto(BASE, { waitUntil: 'networkidle' });
  await dave.getByPlaceholder('Votre identité').fill(daveName);
  await dave.getByRole('button', { name: /Créer mon identité chiffrée/i }).click();
  await dave.getByRole('button', { name: 'Réglages', exact: true }).waitFor({ timeout: 25000 });
  ok('Dave authenticated');
  await sleep(6000);

  step('Carol shares identity');
  await carol.getByRole('button', { name: 'Réglages', exact: true }).click();
  await carol.getByRole('button', { name: /Partager mon identité/i }).click();
  const uriEl = carol.locator('p').filter({ hasText: 'cryptm://' }).first();
  await uriEl.waitFor({ timeout: 10000 });
  const carolURI = (await uriEl.textContent()).trim();
  if (!carolURI.startsWith('cryptm://add')) bad('Carol identity URI unexpected: ' + carolURI.slice(0, 50));
  else ok('Carol identity URI captured');
  await carol.getByRole('button', { name: 'Close dialog' }).click();
  await carol.getByRole('button', { name: 'Messages', exact: true }).click();

  step('Dave sends contact request to Carol');
  await dave.getByRole('button', { name: 'Contacts', exact: true }).click();
  await dave.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const linkInput = dave.getByPlaceholder(/Collez le lien/i);
  await linkInput.waitFor({ timeout: 10000 });
  await linkInput.fill(carolURI);
  await dave.getByRole('button', { name: /Analyser et envoyer/i }).click();
  try {
    await dave.getByText(/Demande de contact envoyée/i).waitFor({ timeout: 10000 });
    ok('Dave sent contact request');
  } catch (e) {
    bad('Dave add-contact did not confirm');
    throw e;
  }

  step('Carol sees the request');
  const reqHeader = carol.getByText(/^Demandes de contact \(\d+\)$/).first();
  try {
    await reqHeader.waitFor({ timeout: 8000 });
    const m = (await reqHeader.innerText()).match(/\((\d+)\)/);
    const n = m ? parseInt(m[1], 10) : -1;
    if (n !== 1) bad(`Carol store has ${n} requests (expected 1)`);
    else ok('Carol sees exactly 1 contact request');
  } catch (e) {
    bad('Carol did not see "Demandes de contact" header: ' + e.message);
    throw e;
  }

  step('Carol declines (Refuser)');
  const refuseBtns = carol.getByRole('button', { name: 'Refuser', exact: true });
  if (await refuseBtns.count() < 1) {
    bad('No Refuser button rendered for Carol');
    throw new Error('no Refuser button');
  }
  ok(`Refuser button rendered (${await refuseBtns.count()})`);
  await refuseBtns.first().click();
  await sleep(1500); // let the WS message reach the server

  step('Carol reloads (WS reconnect) — pending must NOT be redelivered');
  await carol.goto(BASE, { waitUntil: 'networkidle' });
  // Re-authenticate if needed after reload.
  const needAuth = await carol.getByPlaceholder('Votre identité').count();
  if (needAuth > 0) {
    await carol.getByPlaceholder('Votre identité').fill(carolName);
    await carol.getByRole('button', { name: /Créer mon identité chiffrée/i }).click();
    await carol.getByRole('button', { name: 'Réglages', exact: true }).waitFor({ timeout: 25000 });
  }
  let redelivered = false;
  try {
    await carol.getByText(/^Demandes de contact \(\d+\)$/).first().waitFor({ timeout: 8000 });
    redelivered = true;
  } catch (_) { /* good — no header means no pending */ }

  if (redelivered) {
    bad('Pending contact request was REDISPLAYED after reload — server did NOT process contact_decline (handler missing on running :9090)');
  } else {
    ok('No pending request after reload — server removed it (contact_decline is LIVE on running :9090)');
  }

  if (carolErrors.length === 0) ok('No console errors on Carol page');
  else bad('Carol console errors: ' + carolErrors.join(' | '));
  if (daveErrors.length === 0) ok('No console errors on Dave page');
  else bad('Dave console errors: ' + daveErrors.join(' | '));

  await ctxC.close();
  await ctxD.close();
} catch (e) {
  bad('Decline E2E threw: ' + e.message);
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\nDECLINE_RESULT: FAIL (${failures} issue(s))`);
  process.exit(1);
} else {
  console.log('\nDECLINE_RESULT: PASS — contact_decline verified live on running backend');
  process.exit(0);
}

// Offline read E2E (#server-guard / cached conversations).
//
// Proves: when the backend is unavailable, the app is NOT hard-blocked — the
// user can still READ their cached conversations (re-hydrated from
// localStorage). Flow:
//   1. backend UP: register Alice & Bob, make them contacts, Alice sends a
//      normal (persistent) message -> it is cached in localStorage.
//   2. kill the backend.
//   3. reload Alice's page (backend still down).
//   4. assert the offline banner is shown, the cached message is still
//      readable, and there is NO full-screen hard-block GateScreen.
import pkg from '/root/aetherlink/frontend/node_modules/playwright/index.js';
import { execSync } from 'node:child_process';
const { chromium } = pkg;

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const E2E_VP = (() => { const [w, h] = (process.env.E2E_VIEWPORT || '1280x900').split('x').map(Number); return { width: w || 1280, height: h || 900 }; })();

const rand = Math.random().toString(36).slice(2, 8);
const aliceName = `Off_Alice_${rand}`;
const bobName = `Off_Bob_${rand}`;
const offlineMsg = `cache-offline-${rand}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function registerUser(page, name) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const createBtn = page.getByRole('button', { name: /Créer mon identité chiffrée/i });
    await page.getByPlaceholder('Votre identité').fill(name);
    await createBtn.click();
    try {
      await createBtn.waitFor({ state: 'detached', timeout: 30000 });
      return;
    } catch (_) {
      const body = await page.locator('body').innerText().catch(() => '');
      if (/rate-limited/i.test(body)) { await sleep(22000); continue; }
      throw new Error('registration did not complete: ' + body.slice(0, 200));
    }
  }
  throw new Error('registration failed after retries');
}

let failures = 0;
const ok = (m) => console.log('  ✓', m);
const bad = (m) => { failures++; console.error('  ✗', m); };
const step = (m) => console.log('•', m);

// Network errors from the failed /health fetch are EXPECTED (server is down
// during the offline phase). Only flag unexpected console errors.
const unexpected = (t) => !/Failed to load resource|net::ERR|ERR_CONNECTION|\/health|favicon/i.test(t);
const errs = [];

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
try {
  const ctxA = await browser.newContext({ viewport: E2E_VP });
  const ctxB = await browser.newContext({ viewport: E2E_VP });
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();
  alice.setDefaultTimeout(120000);
  bob.setDefaultTimeout(120000);
  alice.on('console', (m) => { if (m.type() === 'error' && unexpected(m.text())) errs.push(m.text()); });
  alice.on('pageerror', (e) => { if (unexpected(e.message)) errs.push('pageerror: ' + e.message); });

  step('register Alice & Bob (backend UP)');
  await alice.goto(BASE, { waitUntil: 'networkidle' });
  await registerUser(alice, aliceName);
  ok('Alice authenticated');
  await bob.goto(BASE, { waitUntil: 'networkidle' });
  await registerUser(bob, bobName);
  ok('Bob authenticated');

  step('make contacts');
  await alice.getByRole('button', { name: 'Réglages', exact: true }).click();
  await alice.getByRole('button', { name: /Partager mon identité/i }).click();
  const uriEl = alice.locator('p').filter({ hasText: 'cryptm://' }).first();
  await uriEl.waitFor({ timeout: 10000 });
  const aliceURI = (await uriEl.textContent()).trim();
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  await alice.getByRole('button', { name: 'Messages', exact: true }).click();
  await bob.getByRole('button', { name: 'Contacts', exact: true }).click();
  await bob.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const linkInput = bob.getByPlaceholder(/Collez le lien ou l'empreinte CRYPTMessenger/i);
  await linkInput.waitFor({ timeout: 10000 });
  await linkInput.fill(aliceURI);
  await bob.getByRole('button', { name: /Analyser et envoyer/i }).click();
  await bob.getByText(/Demande de contact envoyée/i).waitFor({ timeout: 10000 });
  await alice.getByRole('button', { name: 'Accepter', exact: true }).first().click();
  await alice.getByText(bobName, { exact: true }).first().waitFor({ timeout: 10000 });
  ok('mutual contacts established');

  step('Bob sends a persistent message (cached in Alice\'s store, encrypted for Alice)');
  // DM messages are encrypted for the RECIPIENT's key, so Alice can re-read a
  // message she RECEIVED offline (re-derived with her private key), but not
  // her own outgoing messages (encrypted for Bob). We send from Bob so Alice's
  // cached copy is decryptable offline — this is the realistic offline-read case.
  await bob.getByText(aliceName, { exact: true }).first().click();
  const bobInput = bob.getByLabel('Message', { exact: true });
  await bobInput.waitFor({ timeout: 10000 });
  await bobInput.fill(offlineMsg);
  await bobInput.press('Enter');
  // Alice receives it online -> stored in her cache (encrypted for her key)
  await alice.getByText(bobName, { exact: true }).first().click();
  await alice.getByText(offlineMsg, { exact: false }).first().waitFor({ timeout: 10000 });
  ok('message received and cached in Alice\'s store');

  step('kill backend -> go offline');
  // NOTE: the `[s]`/`[-]` bracket trick prevents pkill from matching its own
  // command line (which would self-kill the shell that runs it).
  let backendDown = false;
  for (let attempt = 0; attempt < 6 && !backendDown; attempt++) {
    try { execSync("pkill -9 -f 'cryptmessenger[-]server' || true"); } catch {}
    await sleep(800);
    try {
      const r = await fetch('http://127.0.0.1:9090/health', { signal: AbortSignal.timeout(1500) });
      if (!r.ok) backendDown = true;
    } catch { backendDown = true; }
  }
  if (backendDown) ok('backend confirmed down (health unreachable)');
  else bad('backend did not go down after kill');

  step('reload Alice page (backend DOWN)');
  await alice.goto(BASE, { waitUntil: 'domcontentloaded' });

  step('offline banner shown');
  const banner = alice.getByTestId('server-offline-banner');
  try {
    await banner.waitFor({ state: 'visible', timeout: 15000 });
    ok('offline "lecture seule" banner is shown');
  } catch {
    bad('offline banner never appeared');
  }

  step('NOT hard-blocked (no full-screen GateScreen)');
  if (await alice.getByRole('heading', { name: 'Serveur indisponible', exact: true }).count() === 0)
    ok('no hard-block GateScreen');
  else bad('app is hard-blocked (GateScreen present) — cached reading blocked');

  step('cached conversation is still readable offline');
  // Open the conversation with Bob and confirm the cached message text shows.
  try {
    await alice.getByText(bobName, { exact: true }).first().click({ timeout: 10000 });
  } catch { /* conversation may already be open */ }
  try {
    await alice.getByText(offlineMsg, { exact: false }).first().waitFor({ timeout: 10000 });
    ok('cached message still readable offline');
  } catch {
    bad('cached message NOT visible offline — reading blocked');
  }

  step('retry keeps offline state but conversation still readable');
  const retry = alice.getByRole('button', { name: /Réessayer/i });
  if (await retry.count() > 0) {
    await retry.click();
    await sleep(2500);
    if (await alice.getByTestId('server-offline-banner').count() > 0) ok('still offline after retry (server down)');
    else bad('went online after retry despite server down');
    if (await alice.getByText(offlineMsg, { exact: false }).count() === 0) bad('cached message lost after retry');
  } else {
    bad('missing "Réessayer" button');
  }

  step('no unexpected console errors');
  if (errs.length === 0) ok('no unexpected console errors');
  else { for (const e of errs) bad('console error: ' + e); }

  await ctxA.close();
  await ctxB.close();
} catch (e) {
  bad('E2E threw: ' + e.message);
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\nOFFLINE_RESULT: FAIL (${failures} issue(s))`);
  process.exit(1);
} else {
  console.log('\nOFFLINE_RESULT: PASS — cached conversations readable offline');
  process.exit(0);
}

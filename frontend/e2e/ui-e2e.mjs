// Real-browser UI E2E for CRYPTMessenger.
// Two isolated browser contexts (Alice, Bob) exercise the full flow against a
// live frontend + backend: register -> share identity -> add contact ->
// accept -> send message -> receive on the other side. Console errors fail it.
import pkg from '/root/aetherlink/frontend/node_modules/playwright/index.js';
const { chromium } = pkg;

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const rand = Math.random().toString(36).slice(2, 8);
const aliceName = `E2E_Alice_${rand}`;
const bobName = `E2E_Bob_${rand}`;
const msgText = `E2E hello ${rand}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Register a user, retrying if the register rate-limiter (HTTP 429) is
// currently exhausted. The app surfaces a "rate-limited" message on 429 and
// stays on the auth page, so we wait for the bucket to refill and retry.
// This keeps the bouclier repeatable even when run back-to-back (the
// rate-limiter is shared per-IP across runs).
async function registerUser(page, name) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const createBtn = page.getByRole('button', { name: /Créer mon identité chiffrée/i });
    await page.getByPlaceholder('Votre identité').fill(name);
    await createBtn.click();
    try {
      // Authenticated once the registration form unmounts. (The top-nav
      // "Settings" button is always present, so it can't detect auth.) A
      // throttled (429) registration keeps the user on the auth page.
      await createBtn.waitFor({ state: 'detached', timeout: 12000 });
      return;
    } catch (_) {
      const body = await page.locator('body').innerText().catch(() => '');
      if (/rate-limited/i.test(body)) {
        // A registration is two requests (init+confirm), each a limiter token;
        // wait long enough for two to refill (rate 1/10s) before retrying.
        console.log(`    (register throttled — waiting for limiter, attempt ${attempt})`);
        await sleep(22000);
        continue;
      }
      throw new Error('registration did not complete and was not rate-limited: ' + body.slice(0, 200));
    }
  }
  throw new Error('registration failed after retries (rate-limit never cleared)');
}

let failures = 0;
const ok = (m) => console.log('  ✓', m);
const bad = (m) => { failures++; console.error('  ✗', m); };
const step = (m) => console.log('•', m);

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

try {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();
  // Tolerance for slower renders — also helps on the user's Android device,
  // where the proof-gate (bouclier) is run.
  alice.setDefaultTimeout(60000);
  bob.setDefaultTimeout(60000);

  const aliceErrors = [];
  alice.on('console', (m) => { if (m.type() === 'error') aliceErrors.push(m.text()); });
  alice.on('pageerror', (e) => aliceErrors.push('pageerror: ' + e.message));
  const bobErrors = [];
  bob.on('console', (m) => { if (m.type() === 'error') bobErrors.push(m.text()); });
  bob.on('pageerror', (e) => bobErrors.push('pageerror: ' + e.message));

  // ---------- Alice registers ----------
  step('Alice registers');
  await alice.goto(BASE, { waitUntil: 'networkidle' });
  await registerUser(alice, aliceName);
  ok('Alice authenticated (sidebar visible)');
  await sleep(500);

  // ---------- Bob registers ----------
  step('Bob registers');
  await bob.goto(BASE, { waitUntil: 'networkidle' });
  await registerUser(bob, bobName);
  ok('Bob authenticated (sidebar visible)');
  await sleep(500);

  // ---------- Alice shares identity, capture URI ----------
  step('Alice shares identity');
  await alice.getByRole('button', { name: 'Réglages', exact: true }).click();
  try {
    await alice.getByRole('button', { name: /Partager mon identité/i }).click();
  } catch (e) {
    const txt = await alice.locator('body').innerText().catch(() => '(no body)');
    await alice.screenshot({ path: '/tmp/e2e_share_fail.png' }).catch(() => {});
    bad('Alice share: Share button missing. Body: ' + txt.replace(/\n+/g, ' | ').slice(0, 700));
    throw e;
  }
  const uriEl = alice.locator('p').filter({ hasText: 'cryptm://' }).first();
  await uriEl.waitFor({ timeout: 10000 });
  const aliceURI = (await uriEl.textContent()).trim();
  if (aliceURI.startsWith('cryptm://add')) ok('Alice identity URI captured');
  else bad('Alice identity URI unexpected: ' + aliceURI.slice(0, 50));
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  await alice.getByRole('button', { name: 'Messages', exact: true }).click();

  // ---------- Bob adds Alice ----------
  step('Bob adds Alice via identity link');
  await bob.getByRole('button', { name: 'Contacts', exact: true }).click();
  await bob.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const linkInput = bob.getByPlaceholder(/Collez le lien ou l'empreinte CRYPTMessenger/i);
  await linkInput.waitFor({ timeout: 10000 });
  await linkInput.fill(aliceURI);
  await bob.getByRole('button', { name: /Analyser et envoyer/i }).click();
  try {
    await bob.getByText(/Demande de contact envoyée/i).waitFor({ timeout: 10000 });
    ok('Bob sent contact request');
  } catch (e) {
    const dialog = bob.locator('[role="dialog"]').first();
    const dialogText = (await dialog.innerText().catch(() => '(no dialog)')).replace(/\n+/g, ' | ');
    await bob.screenshot({ path: '/tmp/e2e_fail_bobadd.png' }).catch(() => {});
    bad('Bob add-contact did not confirm. Dialog: ' + dialogText);
    throw e;
  }

  // ---------- Alice accepts ----------
  step('Alice accepts contact request');
  // The same request is intentionally surfaced in two UI spots (a floating
  // badge + the sidebar list), so there are 2 "Accept" buttons for ONE
  // request. The real dedup guarantee lives in the store: the sidebar header
  // renders "Contact requests (N)" from contactRequests.length. Assert N===1
  // (no duplicate contact_request from WS replay) rather than button count.
  const reqHeader = alice.getByText(/^Demandes de contact \(\d+\)$/).first();
  try {
    await reqHeader.waitFor({ timeout: 8000 });
    const m = (await reqHeader.innerText()).match(/\((\d+)\)/);
    const n = m ? parseInt(m[1], 10) : -1;
    if (n !== 1) bad(`Store has ${n} contact requests (expected 1 — dup contact_request?)`);
    else ok('Exactly 1 contact request in store (WS replay dedup OK)');
  } catch (e) {
    // Header may be absent if the sidebar list isn't rendered; fall back to
    // requiring at least one Accept button so the flow still proceeds.
    bad('Could not find "Contact requests (N)" header: ' + e.message);
  }
  const acceptBtns = alice.getByRole('button', { name: 'Accepter', exact: true });
  if (await acceptBtns.count() < 1) {
    bad('No Accept button rendered');
    throw new Error('no Accept button');
  }
  ok(`Accept button(s) rendered (${await acceptBtns.count()} — badge + sidebar, expected for single request)`);
  await acceptBtns.first().click();
  await alice.getByRole('button', { name: 'Contacts', exact: true }).click();
  await alice.getByText(bobName, { exact: true }).first().waitFor({ timeout: 10000 });
  ok('Alice now sees Bob in contacts');

  // ---------- Bob should also have Alice (mutual) ----------
  await bob.getByRole('button', { name: 'Contacts', exact: true }).click();
  await bob.getByText(aliceName, { exact: true }).first().waitFor({ timeout: 10000 });
  ok('Bob now sees Alice in contacts (mutual)');

  // ---------- Alice sends a message ----------
  step('Alice sends message to Bob');
  await alice.getByText(bobName, { exact: true }).first().click();
  const input = alice.getByLabel('Message', { exact: true });
  await input.waitFor({ timeout: 10000 });
  await input.fill(msgText);
  await input.press('Enter');
  try {
    await alice.getByText(msgText, { exact: false }).first().waitFor({ timeout: 10000 });
    ok('Alice message visible in her conversation');
  } catch (e) {
    await alice.screenshot({ path: '/tmp/e2e_fail_send.png' }).catch(() => {});
    const body = await alice.locator('body').innerText().catch(() => '(no body)');
    bad('Alice message not visible. Body: ' + body.slice(0, 800).replace(/\n+/g, ' | '));
    throw e;
  }

  // ---------- Bob receives it ----------
  step('Bob receives the message');
  await bob.getByText(aliceName, { exact: true }).first().click();
  await bob.getByText(msgText, { exact: false }).first().waitFor({ timeout: 15000 });
  ok('Bob received the message in his conversation');

  // ---------- F. Rate-limiter enforcement (abuse protection) ----------
  // The register limiter (default burst=10, 1/10s) must throttle bursts. We
  // fire many rapid POSTs; even if the UI-driven Alice/Bob registrations
  // already consumed part of the bucket, 30 requests cannot all pass, so a
  // 429 is guaranteed when the limiter is live (proven separately with a
  // forced burst=1 config). A missing 429 here means the limiter is off.
  step('Rate-limiter blocks burst registration');
  const API = process.env.E2E_API || 'http://127.0.0.1:9090';
  let saw429 = false;
  let firstStatus = 0;
  for (let i = 0; i < 30 && !saw429; i++) {
    try {
      const res = await fetch(API + '/api/auth/register-init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: 'ratelimit_probe_' + i }),
      });
      if (i === 0) firstStatus = res.status;
      if (res.status === 429) saw429 = true;
    } catch (_) { /* network blip — ignore, keep hammering */ }
  }
  if (saw429) ok('Register rate-limiter returned 429 on burst (abuse protection live)');
  else bad(`Register rate-limiter did NOT throttle (first=${firstStatus}, no 429 in 30 rapid calls) — limiter may be disabled`);

  // ---------- console hygiene ----------
  if (aliceErrors.length === 0) ok('No console errors on Alice page');
  else bad('Alice console errors: ' + aliceErrors.join(' | '));
  if (bobErrors.length === 0) ok('No console errors on Bob page');
  else bad('Bob console errors: ' + bobErrors.join(' | '));

  await ctxA.close();
  await ctxB.close();
} catch (e) {
  bad('E2E threw: ' + e.message);
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\nE2E_RESULT: FAIL (${failures} issue(s))`);
  process.exit(1);
} else {
  console.log('\nE2E_RESULT: PASS — full UI flow works in a real browser');
  process.exit(0);
}

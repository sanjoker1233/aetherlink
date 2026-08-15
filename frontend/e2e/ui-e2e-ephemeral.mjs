// Focused real-browser E2E for the ephemeral ("burn after read") feature.
// Alice sends a 🔥 disappearing message; Bob reads it; the server deletes it
// and broadcasts message_expire, so it must vanish from BOTH conversations.
import pkg from '/root/aetherlink/frontend/node_modules/playwright/index.js';
const { chromium } = pkg;

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const rand = Math.random().toString(36).slice(2, 8);
const aliceName = `Eph_Alice_${rand}`;
const bobName = `Eph_Bob_${rand}`;
const ephemeralMsg = `burn-after-read ${rand}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function registerUser(page, name) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const createBtn = page.getByRole('button', { name: /Créer mon identité chiffrée/i });
    await page.getByPlaceholder('Votre identité').fill(name);
    await createBtn.click();
    try {
      await createBtn.waitFor({ state: 'detached', timeout: 12000 });
      return;
    } catch (_) {
      const body = await page.locator('body').innerText().catch(() => '');
      if (/rate-limited/i.test(body)) {
        console.log(`    (register throttled — waiting for limiter, attempt ${attempt})`);
        await sleep(22000);
        continue;
      }
      throw new Error('registration did not complete: ' + body.slice(0, 200));
    }
  }
  throw new Error('registration failed after retries');
}

async function waitForGone(page, text, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await page.getByText(text, { exact: false }).count()) === 0) return true;
    await sleep(500);
  }
  return false;
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
  alice.setDefaultTimeout(60000);
  bob.setDefaultTimeout(60000);

  step('Alice registers');
  await alice.goto(BASE, { waitUntil: 'networkidle' });
  await registerUser(alice, aliceName);
  ok('Alice authenticated');

  step('Bob registers');
  await bob.goto(BASE, { waitUntil: 'networkidle' });
  await registerUser(bob, bobName);
  ok('Bob authenticated');

  step('Alice shares identity');
  await alice.getByRole('button', { name: 'Réglages', exact: true }).click();
  await alice.getByRole('button', { name: /Partager mon identité/i }).click();
  const uriEl = alice.locator('p').filter({ hasText: 'cryptm://' }).first();
  await uriEl.waitFor({ timeout: 10000 });
  const aliceURI = (await uriEl.textContent()).trim();
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  await alice.getByRole('button', { name: 'Messages', exact: true }).click();

  step('Bob adds Alice');
  await bob.getByRole('button', { name: 'Contacts', exact: true }).click();
  await bob.getByRole('button', { name: 'Ajouter', exact: true }).click();
  const linkInput = bob.getByPlaceholder(/Collez le lien ou l'empreinte CRYPTMessenger/i);
  await linkInput.waitFor({ timeout: 10000 });
  await linkInput.fill(aliceURI);
  await bob.getByRole('button', { name: /Analyser et envoyer/i }).click();
  await bob.getByText(/Demande de contact envoyée/i).waitFor({ timeout: 10000 });
  ok('Bob sent contact request');

  step('Alice accepts');
  const acceptBtns = alice.getByRole('button', { name: 'Accepter', exact: true });
  await acceptBtns.first().click();
  await alice.getByText(bobName, { exact: true }).first().waitFor({ timeout: 10000 });
  ok('Alice now sees Bob in contacts');
  await bob.getByRole('button', { name: 'Contacts', exact: true }).click();
  await bob.getByText(aliceName, { exact: true }).first().waitFor({ timeout: 10000 });
  ok('Bob now sees Alice (mutual)');

  step('Alice sends a 🔥 disappearing message');
  await alice.getByText(bobName, { exact: true }).first().click();
  const flameBtn = alice.getByRole('button', { name: 'Disappearing message' });
  await flameBtn.waitFor({ timeout: 10000 });
  await flameBtn.click(); // activate ephemeral for this send
  const input = alice.getByLabel('Message', { exact: true });
  await input.waitFor({ timeout: 10000 });
  await input.fill(ephemeralMsg);
  await input.press('Enter');
  await alice.getByText(ephemeralMsg, { exact: false }).first().waitFor({ timeout: 10000 });
  ok('Ephemeral message visible in Alice conversation (pre-burn)');

  step('Bob receives it');
  await bob.getByText(aliceName, { exact: true }).first().click();
  await bob.getByText(ephemeralMsg, { exact: false }).first().waitFor({ timeout: 15000 });
  ok('Bob received the ephemeral message');

  step('Bob reads → server burns → both UIs clear');
  // Bob's client auto-sends a read receipt when it renders the unread
  // incoming message; the server then deletes it and sends message_expire
  // to both parties. Poll for the text to disappear from each conversation.
  const aliceGone = await waitForGone(alice, ephemeralMsg, 20000);
  const bobGone = await waitForGone(bob, ephemeralMsg, 20000);
  if (aliceGone) ok('Message disappeared from Alice\'s view (burn confirmed)');
  else bad('Message did NOT disappear from Alice\'s view after Bob read it');
  if (bobGone) ok('Message disappeared from Bob\'s view');
  else bad('Message did NOT disappear from Bob\'s view after read');

  await ctxA.close();
  await ctxB.close();
} catch (e) {
  bad('E2E threw: ' + e.message);
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\nEPHEMERAL_RESULT: FAIL (${failures} issue(s))`);
  process.exit(1);
} else {
  console.log('\nEPHEMERAL_RESULT: PASS — ephemeral burn-after-read works in a real browser');
  process.exit(0);
}

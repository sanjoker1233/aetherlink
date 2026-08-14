// Diagnostic: capture the REAL HTTP response of /api/users/lookup during the
// add-contact step so we can see why AddContactModal throws "Search error".
import pkg from '/root/aetherlink/frontend/node_modules/playwright/index.js';
const { chromium } = pkg;

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const rand = Math.random().toString(36).slice(2, 8);
const aliceName = `DIAG_Alice_${rand}`;
const bobName = `DIAG_Bob_${rand}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

try {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  // Capture lookup responses + failures on BOTH pages.
  for (const [name, page] of [['alice', alice], ['bob', bob]]) {
    page.on('response', async (r) => {
      const u = r.url();
      if (u.includes('/api/users/lookup')) {
        let body = '';
        try { body = await r.text(); } catch (_) {}
        console.log(`[${name}] LOOKUP RESPONSE status=${r.status()} url=${u}\n    body=${body.slice(0, 300)}`);
      }
    });
    page.on('requestfailed', (r) => {
      const u = r.url();
      if (u.includes('/api/users/lookup')) {
        console.log(`[${name}] LOOKUP REQUESTFAILED url=${u} error=${r.failure()?.errorText}`);
      }
    });
    page.on('console', (m) => { if (m.type() === 'error') console.log(`[${name}] console.error: ${m.text().slice(0, 200)}`); });
  }

  step('Alice registers');
  await alice.goto(BASE, { waitUntil: 'networkidle' });
  await alice.getByPlaceholder('Your identity').fill(aliceName);
  await alice.getByRole('button', { name: /Create my encrypted identity/i }).click();
  await alice.getByRole('button', { name: 'Settings', exact: true }).waitFor({ timeout: 25000 });
  await sleep(6000);

  step('Bob registers');
  await bob.goto(BASE, { waitUntil: 'networkidle' });
  await bob.getByPlaceholder('Your identity').fill(bobName);
  await bob.getByRole('button', { name: /Create my encrypted identity/i }).click();
  await bob.getByRole('button', { name: 'Settings', exact: true }).waitFor({ timeout: 25000 });
  await sleep(6000);

  step('Alice shares identity');
  await alice.getByRole('button', { name: 'Settings', exact: true }).click();
  await alice.getByRole('button', { name: /Share my identity/i }).click();
  const uriEl = alice.locator('p').filter({ hasText: 'cryptm://' }).first();
  await uriEl.waitFor({ timeout: 10000 });
  const aliceURI = (await uriEl.textContent()).trim();
  console.log('ALICE_URI=', aliceURI);
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  await alice.getByRole('button', { name: 'Messages', exact: true }).click();

  step('Bob adds Alice (lookup)');
  await bob.getByRole('button', { name: 'Contacts', exact: true }).click();
  await bob.getByRole('button', { name: 'Add', exact: true }).click();
  const linkInput = bob.getByPlaceholder(/Paste the CRYPTMessenger link or fingerprint/i);
  await linkInput.waitFor({ timeout: 10000 });
  await linkInput.fill(aliceURI);
  await bob.getByRole('button', { name: /Parse & send/i }).click();
  await sleep(4000); // let the lookup response/error arrive
  console.log('--- done, see captured lookup responses above ---');

  await ctxA.close();
  await ctxB.close();
} catch (e) {
  console.error('DIAG threw:', e.message);
} finally {
  await browser.close();
}

function step(m) { console.log('•', m); }

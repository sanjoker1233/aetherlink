// Debug: inspect message bubbles after Alice sends, and test tap-to-decrypt.
import pkg from '/root/aetherlink/frontend/node_modules/playwright/index.js';
const { chromium } = pkg;

const BASE = process.env.E2E_BASE || 'http://localhost:3100';
const rand = Math.random().toString(36).slice(2, 8);
const aliceName = `DBG_Alice_${rand}`;
const bobName = `DBG_Bob_${rand}`;
const msgText = `DBG hello ${rand}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
});

async function reg(page, name) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('Your identity').fill(name);
  await page.getByRole('button', { name: /Create my encrypted identity/i }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor({ timeout: 25000 });
}
async function bubblesInfo(page) {
  const n = await page.locator('.message-bubble').count();
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (await page.locator('.message-bubble').nth(i).innerText().catch(() => '')).replace(/\n+/g, ' | ');
    out.push(t);
  }
  return { n, out };
}

try {
  const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctxB = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const alice = await ctxA.newPage();
  const bob = await ctxB.newPage();

  await reg(alice, aliceName); await sleep(6000);
  await reg(bob, bobName); await sleep(6000);

  // Alice shares identity
  await alice.getByRole('button', { name: 'Settings', exact: true }).click();
  await alice.getByRole('button', { name: /Share my identity/i }).click();
  const uriEl = alice.locator('p').filter({ hasText: 'cryptm://' }).first();
  await uriEl.waitFor({ timeout: 10000 });
  const aliceURI = (await uriEl.textContent()).trim();
  await alice.getByRole('button', { name: 'Close dialog' }).click();
  await alice.getByRole('button', { name: 'Messages', exact: true }).click();

  // Bob adds Alice
  await bob.getByRole('button', { name: 'Contacts', exact: true }).click();
  await bob.getByRole('button', { name: 'Add', exact: true }).click();
  const linkInput = bob.getByPlaceholder(/Paste the CRYPTMessenger link or fingerprint/i);
  await linkInput.waitFor({ timeout: 10000 });
  await linkInput.fill(aliceURI);
  await bob.getByRole('button', { name: /Parse & send/i }).click();
  await bob.getByText(/Contact request sent/i).waitFor({ timeout: 10000 });

  // Alice accepts
  const acceptBtn = alice.getByRole('button', { name: 'Accept', exact: true }).first();
  await acceptBtn.waitFor({ timeout: 10000 });
  await acceptBtn.click();
  await alice.getByText(bobName, { exact: true }).first().waitFor({ timeout: 10000 });
  await bob.getByText(aliceName, { exact: true }).first().waitFor({ timeout: 10000 });

  // Alice sends
  await alice.getByText(bobName, { exact: true }).first().click();
  const input = alice.getByLabel('Message', { exact: true });
  await input.waitFor({ timeout: 10000 });
  await input.fill(msgText);
  await input.press('Enter');
  await sleep(3000);

  console.log('=== ALICE (sender) bubbles BEFORE tap ===');
  let ai = await bubblesInfo(alice);
  console.log('count=', ai.n); ai.out.forEach((t, i) => console.log(`  [${i}] ${t}`));

  // Tap the decrypt (lock) button inside each bubble to reveal plaintext
  for (let i = 0; i < ai.n; i++) {
    const b = alice.locator('.message-bubble').nth(i);
    const btn = b.locator('button').first();
    const hasBtn = await btn.count();
    console.log(`  alice bubble[${i}] has decrypt button? ${hasBtn}`);
    if (hasBtn) await btn.click().catch((e) => console.log('  click err', e.message));
  }
  await sleep(1000);
  console.log('=== ALICE bubbles AFTER tap ===');
  ai = await bubblesInfo(alice);
  ai.out.forEach((t, i) => console.log(`  [${i}] ${t}`));
  const aliceSeesPlain = ai.out.some((t) => t.includes(msgText));
  console.log('ALICE sees plaintext "', msgText, '"?', aliceSeesPlain);

  // Bob side
  await bob.getByText(aliceName, { exact: true }).first().click();
  await sleep(2000);
  console.log('=== BOB (recipient) bubbles BEFORE tap ===');
  let bi = await bubblesInfo(bob);
  console.log('count=', bi.n); bi.out.forEach((t, i) => console.log(`  [${i}] ${t}`));
  for (let i = 0; i < bi.n; i++) {
    const b = bob.locator('.message-bubble').nth(i);
    const btn = b.locator('button').first();
    const hasBtn = await btn.count();
    console.log(`  bob bubble[${i}] has decrypt button? ${hasBtn}`);
    if (hasBtn) await btn.click().catch((e) => console.log('  click err', e.message));
  }
  await sleep(1000);
  console.log('=== BOB bubbles AFTER tap ===');
  bi = await bubblesInfo(bob);
  bi.out.forEach((t, i) => console.log(`  [${i}] ${t}`));
  const bobSeesPlain = bi.out.some((t) => t.includes(msgText));
  console.log('BOB sees plaintext "', msgText, '"?', bobSeesPlain);

  await alice.screenshot({ path: '/tmp/dbg_alice.png' }).catch(() => {});
  await bob.screenshot({ path: '/tmp/dbg_bob.png' }).catch(() => {});
} catch (e) {
  console.error('DEBUG threw:', e.message);
} finally {
  await browser.close();
}

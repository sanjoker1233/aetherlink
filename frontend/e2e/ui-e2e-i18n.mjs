// Focused real-browser E2E for the i18n locale toggle (#1).
// Registers a user, asserts the French default, flips to English in Settings,
// and asserts the nav label switches Messages -> Chats.
import pkg from '/root/aetherlink/frontend/node_modules/playwright/index.js';
const { chromium } = pkg;

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const E2E_VP = (() => { const [w, h] = (process.env.E2E_VIEWPORT || '1280x900').split('x').map(Number); return { width: w || 1280, height: h || 900 }; })();

const rand = Math.random().toString(36).slice(2, 8);
const name = `I18n_${rand}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function registerUser(page, nm) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const createBtn = page.getByRole('button', { name: /Créer mon identité chiffrée/i });
    await page.getByPlaceholder('Votre identité').fill(nm);
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

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
try {
  const ctx = await browser.newContext({ viewport: E2E_VP });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);

  step('register');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await registerUser(page, name);
  // Registration detaches the form, but the WS auth/session needs a moment
  // before isAuthenticated flips true (SettingsPage only renders then).
  // Authenticated signal = the nav "Messages" button, scoped to
  // role=navigation so it's unambiguous. The desktop Sidebar and mobile
  // BottomNav both render it inside a <nav> (mutually exclusive by viewport),
  // while a separate ghost "Messages" GlassButton also exists in <main>
  // (no <nav>) once authed and must be excluded.
  await page.getByRole('navigation').getByRole('button', { name: 'Messages', exact: true }).waitFor({ timeout: 30000 });
  ok('authenticated');

  step('FR default');
  // Sidebar is hidden on narrow widths; open wide viewport already 1280 so sidebar shows.
  const frNav = page.getByRole('navigation').getByRole('button', { name: 'Messages', exact: true });
  if (await frNav.count() > 0) ok('FR default shows "Messages"');
  else bad('FR default missing "Messages" nav label');

  step('open Settings');
  await page.getByRole('button', { name: 'Réglages', exact: true }).click();
  // The Settings panel animates in (framer-motion); use an auto-waiting
  // locator rather than count() which returns instantly and races the open.
  const enBtn = page.getByRole('button', { name: 'English', exact: true });
  try {
    await enBtn.waitFor({ timeout: 10000 });
    ok('Language toggle present (English)');
  } catch {
    bad('Language toggle missing'); throw new Error('no English button');
  }

  step('switch to English');
  await enBtn.click();
  await sleep(500);
  const enNav = page.getByRole('navigation').getByRole('button', { name: 'Chats', exact: true });
  if (await enNav.count() > 0) ok('EN shows "Chats" after toggle');
  else bad('EN toggle did not switch nav label to "Chats"');
  // Ensure French label is gone.
  if (await page.getByRole('navigation').getByRole('button', { name: 'Messages', exact: true }).count() > 0)
    bad('FR label "Messages" still present after switching to EN');

  step('switch back to French');
  await page.getByRole('button', { name: 'Français', exact: true }).click();
  await sleep(500);
  if (await page.getByRole('navigation').getByRole('button', { name: 'Messages', exact: true }).count() > 0) ok('Back to FR shows "Messages"');
  else bad('Toggling back to FR failed');

  await ctx.close();
} catch (e) {
  bad('E2E threw: ' + e.message);
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\nI18N_RESULT: FAIL (${failures} issue(s))`);
  process.exit(1);
} else {
  console.log('\nI18N_RESULT: PASS — locale toggle works in a real browser');
  process.exit(0);
}

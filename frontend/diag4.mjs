import { chromium } from 'playwright';

// DOM / a11y diagnostic for CRYPTMessenger.
// Verifies the "Messages" nav button is unambiguous (exactly one button
// resolves to name 'Messages' exact, scoped to role=navigation) and that
// no console errors are emitted on the chats view. Run against a live
// frontend + backend:
//   E2E_BASE=http://localhost:3000 node frontend/diag4.mjs
const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERR: ' + e.message));

const name = 'diag_' + Math.random().toString(36).slice(2, 8);
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.getByPlaceholder('Votre identité').fill(name);
await page.getByRole('button', { name: /Créer mon identité chiffrée/i }).click();
try { await page.getByText('Bienvenue').waitFor({ timeout: 15000 }); } catch {}
await sleep(600);

// Open the chats tab (nav-scoped, matches the bouclier's working locator).
await page.getByRole('navigation').getByRole('button', { name: 'Messages', exact: true }).click();
await sleep(700);

const navMsgs = await page.getByRole('navigation').getByRole('button', { name: 'Messages', exact: true }).evaluateAll((els) => els.map((el) => ({
  name: (el.getAttribute('aria-label') || el.textContent || '').trim(),
  cls: (el.className || '').toString().slice(0, 70),
})));

const exactMsgs = await page.getByRole('button', { name: 'Messages', exact: true }).evaluateAll((els) => els.map((el) => ({
  name: (el.getAttribute('aria-label') || el.textContent || '').trim(),
  inNav: !!el.closest('nav'), inMain: !!el.closest('main'),
})));

console.log('NAV-SCOPED "Messages" buttons :', navMsgs.length);
for (const b of navMsgs) console.log('  ', JSON.stringify(b));
console.log('EXACT "Messages" buttons (all):', exactMsgs.length);
for (const b of exactMsgs) console.log('  ', JSON.stringify(b));
console.log('CONSOLE ERRORS:', errs.length);
for (const e of errs) console.log('  ', e);

const ok = navMsgs.length === 1 && exactMsgs.length === 1 && errs.length === 0;
console.log(ok ? 'DIAG: OK' : 'DIAG: FAIL');
await browser.close();
process.exit(ok ? 0 : 1);

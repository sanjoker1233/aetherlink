// Server-down gate E2E (#server-guard).
//
// Proves the requirement: "l'app ne doit pas être accessible si le serveur
// n'est pas accessible". The backend must be DOWN when this suite runs
// (the bouclier runner kills it before this suite). We load the frontend,
// confirm the ServerGuard blocks the whole app with a full-screen
// "Serveur indisponible" screen, and that no app content (nav "Messages"
// button) is reachable. Clicking Retry must keep the app blocked while the
// server is still down.
import pkg from '/root/aetherlink/frontend/node_modules/playwright/index.js';
const { chromium } = pkg;

const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const E2E_VP = (() => { const [w, h] = (process.env.E2E_VIEWPORT || '1280x900').split('x').map(Number); return { width: w || 1280, height: h || 900 }; })();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (m) => console.log('  ✓', m);
const bad = (m) => { failures++; console.error('  ✗', m); };
const step = (m) => console.log('•', m);

// Network errors from the failed /health fetch are EXPECTED here (server is
// deliberately down). Only flag unexpected console errors.
const unexpected = (t) => !/Failed to load resource|net::ERR|ERR_CONNECTION|\/health|favicon/i.test(t);
const errs = [];

const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
try {
  const ctx = await browser.newContext({ viewport: E2E_VP });
  const page = await ctx.newPage();
  page.setDefaultTimeout(30000);
  page.on('console', (m) => { if (m.type() === 'error' && unexpected(m.text())) errs.push(m.text()); });
  page.on('pageerror', (e) => { if (unexpected(e.message)) errs.push('pageerror: ' + e.message); });

  step('load frontend with backend DOWN');
  // Fresh load so the store starts at serverAvailable=null and runs a fresh
  // health check (which fails because :9090 is closed).
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });

  step('blocking screen appears');
  // Wait for the confirmed-down gate. (While serverAvailable is still null we
  // show a transient "Connexion au serveur…" splash with the same role, so we
  // must wait for the specific "Serveur indisponible" heading rather than any
  // alertdialog — the /health check fails fast against a closed :9090.)
  const heading = page.getByRole('heading', { name: 'Serveur indisponible', exact: true });
  try {
    await heading.waitFor({ state: 'visible', timeout: 15000 });
    ok('full-screen server-gate "Serveur indisponible" shown');
  } catch {
    bad('server-gate "Serveur indisponible" never appeared'); throw new Error('no down-gate');
  }
  if (await page.getByRole('alertdialog').count() > 0) ok('rendered as a blocking alertdialog');

  step('app content is blocked (no nav "Messages")');
  // BottomNav is now inside ServerGuard, so when the server is down the nav
  // button must NOT be in the DOM at all.
  const navMessages = page.getByRole('navigation').getByRole('button', { name: 'Messages', exact: true });
  await sleep(500);
  if (await navMessages.count() === 0) ok('nav "Messages" button is absent — app is blocked');
  else bad('nav "Messages" button is present despite server down');

  step('retry control present');
  const retry = page.getByRole('button', { name: /Réessayer/i });
  if (await retry.count() > 0) ok('"Réessayer" button present');
  else bad('missing "Réessayer" button');

  step('retry keeps app blocked while server still down');
  if (await retry.count() > 0) {
    await retry.click();
    await sleep(2500); // allow the re-check to fail again
    if (await page.getByRole('heading', { name: 'Serveur indisponible', exact: true }).count() > 0)
      ok('still blocked after retry (server down)');
    else bad('app became reachable after retry despite server down');
    if (await page.getByRole('navigation').getByRole('button', { name: 'Messages', exact: true }).count() > 0)
      bad('app content reachable after retry despite server down');
  }

  step('no unexpected console errors');
  if (errs.length === 0) ok('no unexpected console errors');
  else { for (const e of errs) bad('console error: ' + e); }

  await ctx.close();
} catch (e) {
  bad('E2E threw: ' + e.message);
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\nSERVERDOWN_RESULT: FAIL (${failures} issue(s))`);
  process.exit(1);
} else {
  console.log('\nSERVERDOWN_RESULT: PASS — app blocked when server unavailable');
  process.exit(0);
}

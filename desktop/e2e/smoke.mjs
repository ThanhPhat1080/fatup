// End-to-end test runner: drives the built app against the mock API, one area at a time (./areas/*.mjs).
// Each area gets a fresh mock server, profile and download folder (./harness.mjs), so any area can run alone.
//
// Usage:  npm run e2e                  every area (needs a display; on Linux CI wrap with xvfb-run)
//         npm run e2e -- links share   only those areas (also: E2E_ONLY=links,share)
//         node e2e/smoke.mjs links     same, without rebuilding (run `npx electron-vite build` first)
// Env:    SCREENSHOT_DIR=<dir> saves screenshots (and failure-<area>.png); E2E_VERBOSE=1 logs every step.
import { createHarness } from './harness.mjs';
import * as setup from './areas/setup.mjs';
import * as files from './areas/files.mjs';
import * as share from './areas/share.mjs';
import * as links from './areas/links.mjs';
import * as settings from './areas/settings.mjs';
import * as vault from './areas/vault.mjs';

/** Every area, in the order a full run takes them. Adding an area: write areas/<name>.mjs exporting run(h), list it here. */
const AREAS = { setup, files, share, links, settings, vault };

const requested = [...process.argv.slice(2), ...(process.env.E2E_ONLY ?? '').split(',')].map((s) => s.trim()).filter(Boolean);
const unknown = requested.filter((a) => !(a in AREAS));
if (unknown.length) {
  console.error(`✘ unknown e2e area: ${unknown.join(', ')}. Areas: ${Object.keys(AREAS).join(', ')}`);
  process.exit(2);
}
const selected = requested.length ? Object.keys(AREAS).filter((a) => requested.includes(a)) : Object.keys(AREAS);

const failed = [];
for (const name of selected) {
  const started = Date.now();
  const h = await createHarness(name);
  try {
    await AREAS[name].run(h);
    console.log(`✔ ${name} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  } catch (err) {
    console.error(`✘ ${name} failed at step "${h.step}"`);
    console.error(err);
    await h.failureShot();
    failed.push(name);
  } finally {
    h.log('cleanup');
    await h.close();
  }
}

if (failed.length) {
  console.error(`✘ desktop e2e failed: ${failed.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log(`✔ desktop e2e passed (${selected.join(', ')})`);
}
// Exit explicitly so a lingering Electron child or socket can never keep the process alive.
process.exit(process.exitCode ?? 0);

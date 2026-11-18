// Shared harness for the end-to-end areas in ./areas: one fresh mock API, profile and download folder per area,
// so every area starts from a clean, known state and can run on its own (see smoke.mjs).
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { TOKEN, startMockServer } from './mock-server.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright-core');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WATCHDOG_MS = 60_000; // per step

export const PIN = '1234';
export { TOKEN };

/** The kind toggles (Ảnh / File / Liên kết) carry a count, e.g. "Ảnh 5". */
export const kind = (page, name) => page.getByRole('button', { name: new RegExp(`^${name} \\d+$`) });

/** With no kind pressed, everything shows. */
export async function showAll(page) {
  const on = page.locator('.kind-tabs [aria-pressed="true"]');
  if (await on.count()) await on.click();
}

export async function typePin(page, pin) {
  await page.locator('.pin__input').first().pressSequentially(pin);
}

/** The app's environment. ELECTRON_RUN_AS_NODE (set in VS Code's terminal) would start Electron as plain Node, so it is dropped. */
export function appEnv(extra) {
  const env = { ...process.env, ...extra };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/**
 * Starts a mock server and temp folders for one area. Call `close()` when the area is done (pass or fail).
 * `log(step)` names the current step and arms a watchdog: a hung step kills the app and fails the run with that name.
 */
export async function createHarness(area, mockOptions = {}) {
  const shots = process.env.SCREENSHOT_DIR;
  if (shots) mkdirSync(shots, { recursive: true });
  const userData = mkdtempSync(join(tmpdir(), `fatup-e2e-${area}-data-`));
  const downloads = mkdtempSync(join(tmpdir(), `fatup-e2e-${area}-dl-`));
  const { server, url } = await startMockServer(undefined, mockOptions);

  let current;
  let currentProc; // kept separately: app.process() throws once the app is closed
  let watchdog;
  const h = {
    area,
    url,
    userData,
    downloads,
    shots,
    step: 'start',

    log(s) {
      h.step = s;
      if (process.env.E2E_VERBOSE) console.log(`→ [${area}] ${s}`);
      // Playwright's waits all time out, but closing the app or the process itself can hang (seen on CI under xvfb).
      // Fail loudly with the step name instead of stalling the runner.
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        console.error(`✘ e2e hung for ${WATCHDOG_MS / 1000}s in area "${area}" at step "${s}"`);
        currentProc?.kill('SIGKILL');
        process.exit(1);
      }, WATCHDOG_MS);
    },

    async launch(lang = 'vi') {
      const app = await electron.launch({
        // FATUP_EXECUTABLE runs a packaged build (e.g. release/x/linux-unpacked/fatup) instead of out/.
        executablePath: process.env.FATUP_EXECUTABLE || require('electron'),
        args: [...(process.env.FATUP_EXECUTABLE ? [] : [join(root, 'out/main/index.js')]), `--lang=${lang}`, '--no-sandbox',
          // Under xvfb there is no window manager, so Chromium may treat the window as hidden/occluded and pause
          // requestAnimationFrame, which Playwright's "stable" actionability check relies on.
          '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
        env: appEnv({ FATUP_USER_DATA: userData, FATUP_DOWNLOAD_DIR: downloads, FATUP_E2E_LOCAL_PREVIEWS: '1' }),
      });
      const page = await app.firstWindow();
      page.setDefaultTimeout(10_000);
      page.on('pageerror', (e) => console.error(`[${area}] [renderer error]`, e.message));
      page.on('console', (m) => m.type() === 'error' && process.env.E2E_VERBOSE && console.error(`[${area}] [renderer console]`, m.text()));
      await page.setViewportSize({ width: 1180, height: 760 });
      current = app;
      currentProc = app.process();
      return { app, page };
    },

    async shot(page, name) {
      if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
    },

    /** app.close() has no timeout of its own. If it does not return, say so and kill the process. */
    async closeApp(app) {
      const timedOut = Symbol();
      const r = await Promise.race([app.close().catch(() => {}), new Promise((res) => setTimeout(res, 10_000, timedOut))]);
      if (r === timedOut) {
        console.error(`⚠ app.close() did not return within 10s in area "${area}" at step "${h.step}"; killing the process`);
        currentProc?.kill('SIGKILL');
      }
    },

    /** First-run setup on the happy path (right token, PIN 1234), ending on the main list. */
    async setup(page) {
      h.log('setup (quick)');
      await page.getByText('Kết nối tới server FatUp').waitFor();
      await page.getByLabel('URL server').fill(url);
      await page.getByLabel('API token').fill(TOKEN);
      await page.getByRole('button', { name: 'Tiếp' }).click();
      await page.getByText('Tạo mã PIN 4 số').waitFor();
      await typePin(page, PIN);
      await page.getByText('Nhập lại PIN').waitFor();
      await typePin(page, PIN);
      await page.getByText('Báo cáo tháng 11.pdf', { exact: true }).waitFor();
    },

    /** Launches the app and runs the quick setup: what most areas start from. */
    async launchReady(lang = 'vi') {
      const r = await h.launch(lang);
      await h.setup(r.page);
      return r;
    },

    async failureShot() {
      if (!shots || !current) return;
      const win = await current.firstWindow().catch(() => null);
      await win?.screenshot({ path: join(shots, `failure-${area}.png`) }).catch(() => {});
    },

    async close() {
      clearTimeout(watchdog);
      await Promise.race([current?.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
      currentProc?.kill('SIGKILL');
      server.close();
    },
  };
  return h;
}

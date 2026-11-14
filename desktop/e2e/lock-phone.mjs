// End-to-end test of the lock screen on a phone-sized window: the door of Moria with the PIN on its body, the PIN shaking and the door's
// lights stuttering on a wrong PIN, and the doors opening on the right one. Faster than the full smoke test (it only sets up a PIN first).
// Usage: npm run e2e:lock   (needs a display; on Linux CI wrap with xvfb-run)
// Set SCREENSHOT_DIR to save screenshots.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { TOKEN, startMockServer } from './mock-server.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright-core');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.SCREENSHOT_DIR;
if (shots) mkdirSync(shots, { recursive: true });

const userData = mkdtempSync(join(tmpdir(), 'fatup-e2e-lock-data-'));
const { server, url } = await startMockServer();
const PHONE = { width: 390, height: 800 };

let current;
let currentProc; // app.process() throws once the app is closed
let step = 'start';
async function launch(lang, viewport) {
  const app = await electron.launch({
    executablePath: process.env.FATUP_EXECUTABLE || require('electron'),
    args: [...(process.env.FATUP_EXECUTABLE ? [] : [join(root, 'out/main/index.js')]), `--lang=${lang}`, '--no-sandbox', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
    env: { ...process.env, FATUP_USER_DATA: userData, FATUP_E2E_LOCAL_PREVIEWS: '1' },
  });
  current = app;
  currentProc = app.process();
  const page = await app.firstWindow();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (e) => console.error('[renderer error]', e.message));
  await page.setViewportSize(viewport);
  return { app, page };
}
const shot = async (page, name) => shots && page.screenshot({ path: join(shots, `${name}.png`) });
const typePin = (page, pin) => page.locator('.pin__input').first().pressSequentially(pin);
const log = (s) => {
  step = s;
  if (process.env.E2E_VERBOSE) console.log('→', s);
};
/**
 * Records the name of every CSS animation that starts, from now on. The short ones (the shake lasts 350 ms) can be over before a poll
 * looks, so we listen for their start instead.
 */
const recordAnimations = (page) =>
  page.evaluate(() => {
    window.__started = new Set();
    document.addEventListener('animationstart', (e) => window.__started.add(e.animationName), true);
  });
/** Resolves once an animation with this name has started since recordAnimations. */
const started = (page, name) => page.waitForFunction((n) => window.__started?.has(n), name, { timeout: 5_000 });

// The door's geometry in the scene's own units (see LockGate.tsx): view box x 525-1075, y 190-750; star centred at y 470, 30 tall; threshold at y 640.
const VIEW = { x: 525, y: 190, w: 550, h: 560 };
const yFrac = (sceneY) => (sceneY - VIEW.y) / VIEW.h;
const xFrac = (sceneX) => (sceneX - VIEW.x) / VIEW.w;

const watchdog = setTimeout(() => {
  console.error(`✘ lock e2e hung for 90s at step "${step}"`);
  currentProc?.kill('SIGKILL');
  process.exit(1);
}, 90_000);

try {
  // Set up a connection and a PIN (in a normal-sized window), then restart so the app opens locked.
  log('setup');
  let { app, page } = await launch('vi', { width: 1180, height: 760 });
  await page.getByText('Kết nối tới server FatUp').waitFor();
  await page.getByLabel('URL server').fill(url);
  await page.getByLabel('API token').fill(TOKEN);
  await page.getByRole('button', { name: 'Tiếp' }).click();
  await page.getByText('Tạo mã PIN 4 số').waitFor();
  await typePin(page, '1234');
  await page.getByText('Nhập lại PIN').waitFor();
  await typePin(page, '1234');
  await page.getByText('Báo cáo tháng 11.pdf', { exact: true }).waitFor();
  await app.close();

  log('locked, on a phone');
  ({ app, page } = await launch('en', PHONE));
  await page.locator('.gate').waitFor();
  assert.equal(await page.locator('.moria').count(), 0, 'the full scene is not drawn on a phone');
  assert.ok((await page.locator('#moria-frame .moria__rune').count()) > 40, 'the Doors of Durin are drawn with their runes');

  // The PIN is on the body of the door, a little below the star, and the door is drawn taller than in the scene.
  log('layout');
  const door = await page.locator('.gate__door').boundingBox();
  const pin = await page.locator('.gate__pin .pin__cells').boundingBox();
  assert.ok(door && pin);
  assert.ok(door.height / door.width > 1.05, `the door is long (${(door.height / door.width).toFixed(2)} tall for each unit of width)`);
  assert.ok(pin.y > door.y + yFrac(500) * door.height, 'the PIN is below the star');
  assert.ok(pin.y < door.y + yFrac(540) * door.height + 40, 'but only a little below it');
  assert.ok(pin.y + pin.height < door.y + yFrac(640) * door.height, 'and above the threshold: it is on the door');
  assert.ok(pin.x > door.x + xFrac(640) * door.width && pin.x + pin.width < door.x + xFrac(960) * door.width, 'inside the doorway');
  assert.ok(Math.abs(pin.x + pin.width / 2 - (door.x + door.width / 2)) < 3, 'and centred');
  // At its foot: rough stones lie on the ground and light spills from the doorway onto them (as part of the lit layer, so it flickers with it).
  assert.ok((await page.locator('.gate__stones > g').count()) >= 10, 'rough stones at the foot of the door');
  assert.equal(await page.locator('.gate__lit .gate__spill').count(), 1, 'light spills out onto them');
  await page.waitForTimeout(500);
  await shot(page, 'lock-phone-1-door');

  // A wrong PIN: the cells shake, the lights of the door stutter, and the message says so.
  log('wrong PIN');
  await recordAnimations(page);
  await typePin(page, '0000');
  await started(page, 'shake');
  await started(page, 'gate-stutter');
  await page.getByText('Wrong PIN. 4 tries left.').waitFor();
  await shot(page, 'lock-phone-2-wrong');
  await page.waitForTimeout(1_000); // the stutter is over and the light goes back to breathing
  assert.ok(await page.evaluate(() => document.getAnimations().some((a) => a.animationName === 'moria-stage')), 'the door keeps breathing');

  // The right PIN: the leaves swing open, light floods out, and then the app appears.
  log('right PIN');
  await typePin(page, '1234');
  await started(page, 'moria-leaf');
  await page.locator('.moria__flash').waitFor();
  assert.equal(await page.getByText('Wrong PIN').count(), 0, 'the error line is gone once the right PIN opens the door');
  await page.waitForTimeout(500);
  await shot(page, 'lock-phone-3-opening');
  await page.getByText('Today').first().waitFor();
  await app.close();

  // A wide window gets the full scene.
  log('wide window');
  ({ app, page } = await launch('en', { width: 1180, height: 760 }));
  await page.locator('.moria').waitFor();
  assert.equal(await page.locator('.gate').count(), 0);
  await page.setViewportSize(PHONE); // turning the window narrow swaps the scene
  await page.locator('.gate').waitFor();
  await app.close();

  console.log('✔ phone lock screen test passed');
} catch (err) {
  console.error(`✘ phone lock screen test failed at step "${step}"`);
  console.error(err);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await Promise.race([current?.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
  currentProc?.kill('SIGKILL');
  server.close();
}
process.exit(process.exitCode ?? 0);

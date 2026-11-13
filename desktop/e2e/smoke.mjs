// End-to-end smoke test: drives the built app against the mock API.
// Usage: npm run e2e   (needs a display; on Linux CI wrap with xvfb-run)
// Set SCREENSHOT_DIR to save screenshots of each screen.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { TOKEN, startMockServer } from './mock-server.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright-core');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const WATCHDOG_MS = 60_000; // per step
const shots = process.env.SCREENSHOT_DIR;
if (shots) mkdirSync(shots, { recursive: true });

const userData = mkdtempSync(join(tmpdir(), 'fatup-e2e-data-'));
const downloads = mkdtempSync(join(tmpdir(), 'fatup-e2e-dl-'));
const { server, url } = await startMockServer();

async function launch(lang = 'vi') {
  const app = await electron.launch({
    // FATUP_EXECUTABLE runs a packaged build (e.g. release/x/linux-unpacked/fatup) instead of out/.
    executablePath: process.env.FATUP_EXECUTABLE || require('electron'),
    args: [...(process.env.FATUP_EXECUTABLE ? [] : [join(root, 'out/main/index.js')]), `--lang=${lang}`, '--no-sandbox',
      // Under xvfb there is no window manager, so Chromium may treat the window as hidden/occluded and pause
      // requestAnimationFrame, which Playwright's "stable" actionability check relies on.
      '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
    env: { ...process.env, FATUP_USER_DATA: userData, FATUP_DOWNLOAD_DIR: downloads, FATUP_E2E_LOCAL_PREVIEWS: '1' },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (e) => console.error('[renderer error]', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error('[renderer console]', m.text()));
  await page.setViewportSize({ width: 1180, height: 760 });
  current = app;
  currentProc = app.process();
  return { app, page };
}

async function shot(page, name) {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
}

async function typePin(page, pin) {
  await page.locator('.pin__input').first().pressSequentially(pin);
}

let step = 'start';
let current;
let currentProc; // kept separately: app.process() throws once the app is closed
let watchdog;
const log = (s) => {
  step = s;
  if (process.env.E2E_VERBOSE) console.log('→', s);
  // Watchdog: Playwright's waits all time out, but closing the app or the process itself can hang
  // (seen on CI under xvfb). Fail loudly with the step name instead of stalling the runner.
  clearTimeout(watchdog);
  watchdog = setTimeout(() => {
    console.error(`✘ smoke test hung for ${WATCHDOG_MS / 1000}s at step "${s}"`);
    currentProc?.kill('SIGKILL');
    process.exit(1);
  }, WATCHDOG_MS);
};

// app.close() has no timeout of its own. If it does not return, say so and kill the process
// so the next launch (and CI) can carry on.
async function closeApp(app) {
  const timedOut = Symbol();
  const r = await Promise.race([app.close().catch(() => {}), new Promise((res) => setTimeout(res, 10_000, timedOut))]);
  if (r === timedOut) {
    console.error(`⚠ app.close() did not return within 10s at step "${step}"; killing the process`);
    currentProc?.kill('SIGKILL');
  }
}
try {
  // 1. First run: setup
  let { app, page } = await launch();
  log('setup');
  await page.getByText('Kết nối tới server FatUp').waitFor();
  await page.getByLabel('URL server').fill(url);
  await page.getByLabel('API token').fill('wrong');
  await page.getByRole('button', { name: 'Tiếp' }).click();
  await page.getByText('Token bị từ chối.').waitFor();
  await page.getByLabel('API token').fill(TOKEN);
  await shot(page, '01-setup');
  await page.getByRole('button', { name: 'Tiếp' }).click();

  log('create pin');
  await page.getByText('Tạo mã PIN 4 số').waitFor();
  await typePin(page, '1234');
  await page.getByText('Nhập lại PIN').waitFor();
  await typePin(page, '1234');

  // 2. Main screen
  log('main list');
  await page.getByText('Báo cáo tháng 11.pdf', { exact: true }).waitFor();
  await page.getByText('Hôm nay').first().waitFor();
  await page.getByText('Hôm qua').first().waitFor();
  await page.waitForTimeout(300);
  await shot(page, '02-all-list-light');

  log('tabs');
  await page.getByRole('tab', { name: 'File' }).click();
  assert.equal(await page.getByText('IMG_20261112_0832.jpg', { exact: true }).count(), 0, 'images hidden in File tab');
  await page.getByRole('tab', { name: 'Ảnh' }).click();
  await page.locator('.tile').first().waitFor();
  assert.equal(await page.getByText('boarding-pass.pdf', { exact: true }).count(), 0, 'files hidden in Ảnh tab');
  await page.waitForTimeout(300);
  await shot(page, '03-images-grid-light');

  log('search');
  await page.getByRole('tab', { name: 'Tất cả' }).click();
  await page.getByLabel('Tìm theo tên').fill('da lat');
  await page.getByText('Đà Lạt trip.jpg', { exact: true }).waitFor();
  assert.equal(await page.locator('.list__row:not(.list__row--head)').count(), 1);
  await page.getByLabel('Tìm theo tên').fill('');

  log('download');
  await page.getByText('boarding-pass.pdf', { exact: true }).click();
  await page.getByText(/Đã lưu vào/).waitFor();
  assert.ok(existsSync(join(downloads, 'boarding-pass.pdf')));
  await page.getByText('boarding-pass.pdf', { exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('(1)'));
  assert.deepEqual(readdirSync(downloads).sort(), ['boarding-pass (1).pdf', 'boarding-pass.pdf']);

  log('lightbox');
  await page.getByText('IMG_20261112_0832.jpg', { exact: true }).click();
  await page.locator('.lightbox img').first().waitFor(); // the thumbnail and the full image can both be mounted
  await page.waitForTimeout(400);
  await shot(page, '04-lightbox');
  await page.keyboard.press('ArrowRight');
  await page.locator('.lightbox__title', { hasText: 'PXL_20261112_071503.heic' }).waitFor();
  await page.keyboard.press('Escape');

  log('links');
  await page.getByRole('tab', { name: 'Liên kết' }).click();
  await page.getByText('Thread về AI', { exact: true }).waitFor();
  const linkRows = page.locator('.list__row:not(.list__row--head)');
  assert.equal(await linkRows.count(), 6);
  // Internet, YouTube, X and Threads sit next to "All"; the other platforms hide in the box.
  for (const name of ['Internet', 'YouTube', 'X', 'Threads']) await page.getByRole('button', { name: `Chỉ hiện link ${name}`, exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Chỉ hiện link Facebook', exact: true }).count(), 0, 'Facebook starts inside the box');
  await shot(page, '04a-links-box-closed');
  await page.getByRole('button', { name: 'Các nền tảng khác' }).click();
  await page.getByRole('button', { name: 'Chỉ hiện link Facebook', exact: true }).waitFor();
  await page.waitForTimeout(900); // let the icons finish hopping out
  await shot(page, '04a-links-box-open');
  await page.getByRole('button', { name: 'Chỉ hiện link X', exact: true }).click(); // a pinned platform filters without opening anything
  await page.waitForFunction(() => document.querySelectorAll('.list__row:not(.list__row--head)').length === 1);
  await page.getByText('Thread về AI', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Chỉ hiện link Facebook', exact: true }).click(); // a boxed platform switches the filter
  await page.getByText('Bài viết hay trên Facebook', { exact: true }).waitFor();
  assert.equal(await linkRows.count(), 1);
  await page.getByRole('button', { name: 'Chỉ hiện link Facebook', exact: true }).click(); // clicking the active platform clears the filter
  await page.waitForFunction(() => document.querySelectorAll('.list__row:not(.list__row--head)').length === 6);
  // The list has a platform column (sortable) instead of the cow and the host after the name.
  assert.equal(await page.locator('.list .cow-thumb').count(), 0, 'no cow in the list');
  assert.equal(await page.getByText('example.com').count(), 0, 'no host after the link name');
  await page.getByRole('button', { name: 'Nguồn', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.list__row:not(.list__row--head) .ellipsis')?.textContent === 'Bài viết hay trên Facebook');
  await shot(page, '04b-links-list');
  await page.getByRole('button', { name: 'Nguồn', exact: true }).click(); // second click reverses: YouTube first, then TikTok...
  await page.waitForFunction(() => document.querySelector('.list__row:not(.list__row--head) .ellipsis')?.textContent === 'Cách nấu phở ngon');
  await page.getByRole('button', { name: 'Dạng lưới', exact: true }).click();
  // Link pictures are fetched by the app, kept on disk and shown through fatup-preview://; the link without one gets the cow.
  await page.waitForFunction(() => document.querySelectorAll('.tile img[src^="fatup-preview://"]').length === 5);
  assert.equal(await page.locator('.tile .cow-thumb').count(), 1, 'the cow stays in the grid, for the link that has no picture');
  assert.equal(readdirSync(join(userData, 'previews')).filter((f) => f.endsWith('.png')).length, 5, 'the pictures are kept on disk');
  assert.ok(await page.locator('.tile img[src^="fatup-preview://"]').first().evaluate((img) => img.complete && img.naturalWidth > 0), 'the cached picture loads');
  await shot(page, '04c-links-grid');
  await page.getByRole('button', { name: 'Dạng danh sách', exact: true }).click();
  await page.getByRole('tab', { name: 'Tất cả' }).click();

  log('context menu + delete');
  await page.getByText('chi-tieu-2026.xlsx', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Chuyển vào thùng rác' }).waitFor();
  await shot(page, '05-context-menu');
  // Deleting moves the file to the trash without a confirmation; the toast offers Undo.
  await page.getByRole('menuitem', { name: 'Chuyển vào thùng rác' }).click();
  await page.getByText('Đã chuyển 1 file vào thùng rác').waitFor();
  assert.equal(await page.getByText('chi-tieu-2026.xlsx', { exact: true }).count(), 0);

  log('settings + QR');
  await page.getByRole('button', { name: 'Cài đặt' }).click();
  await page.getByRole('button', { name: 'Kết nối Android' }).click();
  await typePin(page, '9999');
  await page.getByText('Sai PIN. Còn 4 lần thử.').waitFor();
  await typePin(page, '1234');
  await page.locator('img.qr').waitFor();
  await shot(page, '06-settings-qr');
  await page.keyboard.press('Escape');

  log('dark mode');
  await page.emulateMedia({ colorScheme: 'dark' });
  log('dark mode: screens');
  await page.getByRole('tab', { name: 'Ảnh' }).click();
  await page.waitForTimeout(300);
  await shot(page, '07-images-grid-dark');
  await page.getByRole('tab', { name: 'Tất cả' }).click();
  await page.waitForTimeout(200);
  await shot(page, '08-all-list-dark');
  log('close app (1st run)');
  await closeApp(app);

  // 3. Restart: lock screen
  log('lock screen');
  ({ app, page } = await launch('en'));
  await page.getByLabel('Enter your PIN').waitFor(); // the PIN field is labelled for screen readers; the Moria scene has no visible caption
  await typePin(page, '0000');
  await page.getByText('Wrong PIN. 4 tries left.').waitFor();
  await shot(page, '09-lock-en');
  await typePin(page, '1234');
  await page.getByText('Today').first().waitFor();
  log('close app (2nd run)');
  await closeApp(app);

  console.log('✔ desktop smoke test passed');
} catch (err) {
  console.error(`✘ smoke test failed at step "${step}"`);
  if (shots && current) {
    const win = await current.firstWindow().catch(() => null);
    await win?.screenshot({ path: join(shots, 'failure.png') }).catch(() => {});
  }
  console.error(err);
  process.exitCode = 1;
} finally {
  clearTimeout(watchdog);
  log('cleanup');
  await Promise.race([current?.close().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
  currentProc?.kill('SIGKILL');
  server.close();
}
// Exit explicitly so a lingering Electron child or socket can never keep the process alive.
process.exit(process.exitCode ?? 0);

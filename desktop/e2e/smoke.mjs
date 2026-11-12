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
const shots = process.env.SCREENSHOT_DIR;
if (shots) mkdirSync(shots, { recursive: true });

const userData = mkdtempSync(join(tmpdir(), 'fatup-e2e-data-'));
const downloads = mkdtempSync(join(tmpdir(), 'fatup-e2e-dl-'));
const { server, url } = await startMockServer();

async function launch(lang = 'vi') {
  const app = await electron.launch({
    // FATUP_EXECUTABLE runs a packaged build (e.g. release/x/linux-unpacked/fatup) instead of out/.
    executablePath: process.env.FATUP_EXECUTABLE || require('electron'),
    args: [...(process.env.FATUP_EXECUTABLE ? [] : [join(root, 'out/main/index.js')]), `--lang=${lang}`, '--no-sandbox'],
    env: { ...process.env, FATUP_USER_DATA: userData, FATUP_DOWNLOAD_DIR: downloads },
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', (e) => console.error('[renderer error]', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error('[renderer console]', m.text()));
  await page.setViewportSize({ width: 1180, height: 760 });
  current = app;
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
const log = (s) => { step = s; if (process.env.E2E_VERBOSE) console.log('→', s); };
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
  await page.locator('.lightbox img').waitFor();
  await page.waitForTimeout(400);
  await shot(page, '04-lightbox');
  await page.keyboard.press('ArrowRight');
  await page.locator('.lightbox__title', { hasText: 'PXL_20261112_071503.heic' }).waitFor();
  await page.keyboard.press('Escape');

  log('context menu + delete');
  await page.getByText('chi-tieu-2026.xlsx', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Xóa' }).waitFor();
  await shot(page, '05-context-menu');
  await page.getByRole('menuitem', { name: 'Xóa' }).click();
  await page.getByRole('button', { name: 'Xóa' }).click();
  await page.getByText('Đã xóa').waitFor();
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
  await page.getByRole('tab', { name: 'Ảnh' }).click();
  await page.waitForTimeout(300);
  await shot(page, '07-images-grid-dark');
  await page.getByRole('tab', { name: 'Tất cả' }).click();
  await page.waitForTimeout(200);
  await shot(page, '08-all-list-dark');
  await app.close();

  // 3. Restart: lock screen
  log('lock screen');
  ({ app, page } = await launch('en'));
  await page.getByText('Enter your PIN').waitFor();
  await typePin(page, '0000');
  await page.getByText('Wrong PIN. 4 tries left.').waitFor();
  await shot(page, '09-lock-en');
  await typePin(page, '1234');
  await page.getByText('Today').first().waitFor();
  await page.locator('.list__row .downloaded').first().waitFor(); // downloaded mark persisted
  await app.close();

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
  await current?.close().catch(() => {});
  server.close();
}

// End-to-end smoke test: drives the built app against the mock API.
// Usage: npm run e2e   (needs a display; on Linux CI wrap with xvfb-run)
// Set SCREENSHOT_DIR to save screenshots of each screen.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { TOKEN, startMockServer } from './mock-server.mjs';

const require = createRequire(import.meta.url);
const { _electron: electron } = require('playwright-core');
/** The kind toggles (Ảnh / File / Liên kết) carry a count, e.g. "Ảnh 5". */
const kind = (page, name) => page.getByRole('button', { name: new RegExp(`^${name} \\d+$`) });
/** With no kind pressed, everything shows (there is no "All" tab). */
async function showAll(page) {
  const on = page.locator('.kind-tabs [aria-pressed="true"]');
  if (await on.count()) await on.click();
}
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
  await kind(page, 'File').click();
  assert.equal(await page.getByText('IMG_20261112_0832.jpg', { exact: true }).count(), 0, 'images hidden in File tab');
  await kind(page, 'Ảnh').click();
  await page.locator('.tile').first().waitFor();
  assert.equal(await page.getByText('boarding-pass.pdf', { exact: true }).count(), 0, 'files hidden in Ảnh tab');
  await page.waitForTimeout(300);
  await shot(page, '03-images-grid-light');

  log('search');
  await showAll(page);
  await page.getByLabel('Tìm theo tên').fill('da lat');
  await page.getByText('Đà Lạt trip.jpg', { exact: true }).waitFor();
  assert.equal(await page.locator('.list__row:not(.list__row--head)').count(), 1);
  // No match: the cow says so, like the other empty screens.
  await page.getByLabel('Tìm theo tên').fill('zzzz khong co');
  await page.getByRole('img', { name: 'Không có gì khớp' }).waitFor();
  await page.getByText('Thử từ khoá khác, hoặc bỏ bớt bộ lọc.').waitFor();
  await shot(page, '02b-search-no-match');
  await page.getByLabel('Tìm theo tên').fill('');

  log('download');
  // A PDF opens in the preview; Ctrl/⌘ + click downloads it straight away.
  await page.getByText('boarding-pass.pdf', { exact: true }).click({ modifiers: ['ControlOrMeta'] });
  await page.getByText(/Đã lưu vào/).waitFor();
  assert.ok(existsSync(join(downloads, 'boarding-pass.pdf')));
  await page.getByText('boarding-pass.pdf', { exact: true }).click({ modifiers: ['ControlOrMeta'] });
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('(1)'));
  assert.deepEqual(readdirSync(downloads).sort(), ['boarding-pass (1).pdf', 'boarding-pass.pdf']);

  log('important');
  // The yellow label sits right after the checkbox on every row; the quick filter before "All" keeps only marked items.
  const row = (name) => page.locator('.list__row', { hasText: name });
  await row('chi-tieu-2026.xlsx').getByRole('button', { name: 'Đánh dấu quan trọng' }).click();
  await row('chi-tieu-2026.xlsx').getByRole('button', { name: 'Bỏ đánh dấu quan trọng' }).waitFor();
  await page.getByRole('button', { name: 'Chỉ hiện mục quan trọng' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.list__row:not(.list__row--head)').length === 1);
  await shot(page, '03a-important-filter');
  await page.getByRole('button', { name: 'Chỉ hiện mục quan trọng' }).click();
  assert.ok((await page.locator('.list__row:not(.list__row--head)').count()) > 1);
  assert.equal(await page.getByRole('columnheader', { name: 'Từ' }).count(), 0, 'no From column');

  log('grid download');
  await page.getByRole('switch', { name: 'Dạng lưới' }).click();
  await page.keyboard.press('Escape');
  // The download button over a file's card is reachable with Tab, and works.
  const sheetTile = page.locator('.tile', { hasText: 'chi-tieu-2026.xlsx' });
  await sheetTile.focus();
  await page.keyboard.press('Tab'); // checkbox… walk until the download button has focus
  for (let i = 0; i < 8 && !(await sheetTile.locator('.tile__download').evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  assert.ok(await sheetTile.locator('.tile__download').evaluate((el) => el === document.activeElement), 'download reachable by Tab');
  await shot(page, '03c-grid-download-focus');
  await page.keyboard.press('Enter');
  await page.getByText(/Đã lưu vào.*chi-tieu-2026/).waitFor();
  await page.getByRole('switch', { name: 'Dạng danh sách' }).click();

  log('pdf preview');
  await page.getByText('Báo cáo tháng 11.pdf', { exact: true }).click();
  const pdf = page.getByRole('dialog', { name: 'Báo cáo tháng 11.pdf' });
  await pdf.locator('iframe.pdfprev__doc[src^="blob:"]').waitFor();
  await page.waitForTimeout(1500); // let the viewer draw the page
  await shot(page, '03b-pdf-preview');
  await page.keyboard.press('Escape');
  await pdf.waitFor({ state: 'detached' });

  log('lightbox');
  await page.getByText('IMG_20261112_0832.jpg', { exact: true }).click();
  await page.locator('.lightbox img').first().waitFor(); // the thumbnail and the full image can both be mounted
  await page.waitForTimeout(400);
  await shot(page, '04-lightbox');
  await page.keyboard.press('ArrowRight');
  await page.locator('.lightbox__title', { hasText: 'PXL_20261112_071503.heic' }).waitFor();
  await page.keyboard.press('Escape');

  log('links');
  await kind(page, 'Liên kết').click();
  await page.getByText('Thread về AI', { exact: true }).waitFor();
  const linkRows = page.locator('.list__row:not(.list__row--head)');
  assert.equal(await linkRows.count(), 6);
  // Internet and YouTube sit next to "All"; the social networks (X and Threads too) hide in the Social box.
  for (const name of ['Internet', 'YouTube']) await page.getByRole('button', { name: `Chỉ hiện link ${name}`, exact: true }).waitFor();
  for (const name of ['Facebook', 'X', 'Threads']) assert.equal(await page.getByRole('button', { name: `Chỉ hiện link ${name}`, exact: true }).count(), 0, `${name} starts inside the box`);
  await shot(page, '04a-links-box-closed');
  await page.getByRole('button', { name: 'Mạng xã hội' }).click();
  await page.getByRole('button', { name: 'Chỉ hiện link Facebook', exact: true }).waitFor();
  await page.waitForTimeout(900); // let the icons finish hopping out
  await shot(page, '04a-links-box-open');
  await page.getByRole('button', { name: 'Chỉ hiện link YouTube', exact: true }).click(); // a pinned platform filters without opening anything
  // Not grouped while one platform is shown: the expand/collapse switch stays in place, disabled.
  assert.ok(await page.locator('.icon-switch').first().isDisabled(), 'switch disabled, not removed');
  await page.waitForFunction(() => document.querySelectorAll('.list__row:not(.list__row--head)').length === 1);
  await page.getByText('Cách nấu phở ngon', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Chỉ hiện link Facebook', exact: true }).click(); // a boxed platform switches the filter
  await page.getByText('Bài viết hay trên Facebook', { exact: true }).waitFor();
  assert.equal(await linkRows.count(), 1);
  await page.getByRole('button', { name: 'Chỉ hiện link Facebook', exact: true }).click(); // clicking the active platform clears the filter
  await page.waitForFunction(() => document.querySelectorAll('.list__row:not(.list__row--head)').length === 6);
  // The list has a platform column (sortable) instead of the cow and the host after the name.
  assert.equal(await page.locator('.list .cow-thumb').count(), 0, 'no cow in the list');
  assert.equal(await linkRows.getByText('example.com').count(), 0, 'no host after the link name (the domain only titles its group)');
  await page.getByRole('button', { name: 'Nguồn', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.list__row:not(.list__row--head) .ellipsis')?.textContent === 'Bài viết hay trên Facebook');
  await shot(page, '04b-links-list');
  await page.getByRole('button', { name: 'Nguồn', exact: true }).click(); // second click reverses: YouTube first, then TikTok...
  await page.waitForFunction(() => document.querySelector('.list__row:not(.list__row--head) .ellipsis')?.textContent === 'Cách nấu phở ngon');
  // Selecting swaps the island for the selection bar in exactly the same box, and the platform filter stays.
  const islandBox = await page.locator('.chips-row.island').boundingBox();
  const filterY = (await page.locator('.site-chips').boundingBox()).y;
  await linkRows.first().getByRole('checkbox').click();
  const selBox = await page.locator('.selbar').boundingBox();
  assert.deepEqual([selBox.x, selBox.y, selBox.width, selBox.height].map(Math.round), [islandBox.x, islandBox.y, islandBox.width, islandBox.height].map(Math.round), 'same box as the island');
  assert.equal(Math.round((await page.locator('.site-chips').boundingBox()).y), Math.round(filterY), 'the platform filter stays put');
  await shot(page, '04a-links-selected');
  await page.getByRole('button', { name: 'Bỏ chọn' }).click();
  // With "All" platforms the links are grouped: one group per platform, titled with its name, and per other website by domain.
  // The switch folds and unfolds every group.
  await page.getByRole('button', { name: 'YouTube, 1 liên kết' }).waitFor();
  await page.getByRole('button', { name: 'example.com, 1 liên kết' }).waitFor();
  assert.equal(await page.locator('.group-toggle').count(), 6);
  await page.getByRole('switch', { name: 'Thu gọn tất cả nhóm' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.list__row:not(.list__row--head)').length === 0);
  await shot(page, '04b-links-collapsed');
  await page.getByRole('switch', { name: 'Mở rộng tất cả nhóm' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.list__row:not(.list__row--head)').length === 6);
  // Link rows: no Size or From column; pencil and copy sit in one right-aligned column, so they line up on every row.
  assert.equal(await page.getByRole('columnheader', { name: 'Dung lượng' }).count(), 0);
  assert.equal(await page.getByRole('columnheader', { name: 'Từ' }).count(), 0);
  const copyXs = await linkRows.locator('.col-actions .copy-btn').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
  assert.equal(new Set(copyXs).size, 1, `copy buttons line up (${copyXs})`);
  // Hover (or focus) adds "open in the browser" next to them.
  const firstRow = linkRows.first();
  await firstRow.hover();
  await firstRow.getByRole('button', { name: 'Mở trong trình duyệt' }).waitFor({ state: 'visible' });
  await shot(page, '04b-links-list-hover');
  // Each link has a copy button right on its row.
  await linkRows.filter({ hasText: 'Thread về AI' }).getByRole('button', { name: 'Sao chép link' }).click();
  await page.getByText('Đã sao chép link').waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://x.com/someone/status/1');
  await page.getByRole('switch', { name: 'Dạng lưới', exact: true }).click();
  // Link pictures are fetched by the app, kept on disk and shown through fatup-preview://; the link without one gets the cow.
  await page.waitForFunction(() => document.querySelectorAll('.tile img[src^="fatup-preview://"]').length === 5);
  assert.equal(await page.locator('.tile .cow-thumb').count(), 1, 'the cow stays in the grid, for the link that has no picture');
  assert.equal(readdirSync(join(userData, 'previews')).filter((f) => f.endsWith('.png')).length, 5, 'the pictures are kept on disk');
  await page.locator('.tile', { hasText: 'Video Tik' }).hover();
  await page.locator('.tile', { hasText: 'Video Tik' }).getByRole('button', { name: 'Sao chép link' }).waitFor({ state: 'visible', timeout: 3000 }); // on the grid it appears on hover
  const nameWidth = await page.locator('.tile', { hasText: 'Video Tik' }).locator('.tile__name').evaluate((el) => el.getBoundingClientRect().width);
  assert.ok(nameWidth > 60, `the buttons float over the name instead of squeezing it (name is ${nameWidth}px wide)`);
  await shot(page, '04d-links-grid-hover');
  assert.ok(await page.locator('.tile img[src^="fatup-preview://"]').first().evaluate((img) => img.complete && img.naturalWidth > 0), 'the cached picture loads');
  await shot(page, '04c-links-grid');

  log('link preview');
  // Clicking a link opens it inside the app: the platform's own player where there is one…
  await page.locator('.tile', { hasText: 'Video TikTok vui' }).locator('.tile__thumb').click();
  const preview = page.getByRole('dialog', { name: 'Video TikTok vui' });
  await preview.waitFor();
  assert.equal(await preview.locator('iframe').getAttribute('src'), 'https://www.tiktok.com/player/v1/1?autoplay=1');
  await preview.getByRole('button', { name: 'Mở trong trình duyệt' }).waitFor();
  await shot(page, '04e-link-preview-embed');
  await page.keyboard.press('Escape');
  await preview.waitFor({ state: 'detached' });
  // Facebook: the og: card (title, picture, open in the browser), never the page behind its login wall.
  await page.locator('.tile', { hasText: 'Bài viết hay trên Facebook' }).locator('.tile__thumb').click();
  const fb = page.getByRole('dialog', { name: 'Bài viết hay trên Facebook' });
  await fb.locator('.linkprev__card img').waitFor();
  assert.equal(await fb.locator('iframe, .webpage').count(), 0);
  await shot(page, '04e-link-preview-facebook');
  await page.keyboard.press('Escape');
  await fb.waitFor({ state: 'detached' });
  await page.locator('.tile', { hasText: 'Tổng hợp deal Shopee' }).locator('.tile__thumb').click();
  const card = page.getByRole('dialog', { name: 'Tổng hợp deal Shopee' });
  // …and on the desktop, a link with no embed (Shopee, any website) opens as the real page in a browser view over the preview.
  const pageView = page.locator('.webpage__view');
  await pageView.waitFor();
  await card.locator('.webpage__address', { hasText: 'https://shopee.vn/a-i.1.2' }).waitFor();
  const viewUrl = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map((v) => v.webContents?.getURL()));
  const box = await pageView.boundingBox();
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children[0]?.getBounds());
  assert.ok(bounds && Math.abs(bounds.x - box.x) <= 1 && Math.abs(bounds.width - box.width) <= 1, `the page sits over its box (${JSON.stringify(bounds)} vs ${JSON.stringify(box)})`);
  // The view reports its address once the first navigation commits.
  for (let i = 0; i < 50 && !(await viewUrl())[0]; i++) await page.waitForTimeout(200);
  assert.match((await viewUrl())[0] ?? '', /^https:\/\/shopee\.vn\//);
  await page.waitForTimeout(2500); // let the page draw for the screenshot
  await shot(page, '04f-link-preview-page');
  if (shots) {
    // The page is drawn by the browser view, outside what page.screenshot() sees: capture the view itself too.
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.capturePage()).toPNG().toString('base64'));
    writeFileSync(join(shots, '04g-link-preview-page-view.png'), Buffer.from(png, 'base64'));
  }
  await page.keyboard.press('Escape');
  await card.waitFor({ state: 'detached' });
  assert.deepEqual(await viewUrl(), [], 'closing the preview removes the page');

  await page.getByRole('switch', { name: 'Dạng danh sách', exact: true }).click();
  await showAll(page);

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
  await kind(page, 'Ảnh').click();
  await page.waitForTimeout(300);
  await shot(page, '07-images-grid-dark');
  await showAll(page);
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

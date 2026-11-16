// E2E area "files": The main list: columns, kind toggles, search, downloads, the important label, PDF preview, lightbox, move to trash.
// Run alone: npm run e2e -- files   (see ../smoke.mjs)
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { kind, showAll } from '../harness.mjs';

/** @param {Awaited<ReturnType<typeof import('../harness.mjs').createHarness>>} h */
export async function run(h) {
  const { page } = await h.launchReady();
  h.log('main list');
  await page.getByText('Hôm nay').first().waitFor();
  await page.getByText('Hôm qua').first().waitFor();
  await page.waitForTimeout(300);
  await h.shot(page, '02-all-list-light');
  // The pencil sits in the right-aligned actions column (like on link rows), not hugging the end of the name.
  const pencilXs = await page.locator('.list__row:not(.list__row--head) .col-actions .rename-btn').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
  assert.ok(pencilXs.length > 1, 'file rows have a pencil in the actions column');
  assert.equal(new Set(pencilXs).size, 1, `pencils line up on file rows (${pencilXs})`);
  assert.equal(await page.locator('.list__name .rename-btn').count(), 0, 'no pencil inside the name cell');

  h.log('tabs');
  await kind(page, 'File').click();
  assert.equal(await page.getByText('IMG_20261112_0832.jpg', { exact: true }).count(), 0, 'images hidden in File tab');
  await kind(page, 'Ảnh').click();
  await page.locator('.tile').first().waitFor();
  assert.equal(await page.getByText('boarding-pass.pdf', { exact: true }).count(), 0, 'files hidden in Ảnh tab');
  await page.waitForTimeout(300);
  await h.shot(page, '03-images-grid-light');

  h.log('search');
  await showAll(page);
  await page.getByLabel('Tìm theo tên').fill('da lat');
  await page.getByText('Đà Lạt trip.jpg', { exact: true }).waitFor();
  assert.equal(await page.locator('.list__row:not(.list__row--head)').count(), 1);
  // No match: the cow says so, like the other empty screens.
  await page.getByLabel('Tìm theo tên').fill('zzzz khong co');
  await page.getByRole('img', { name: 'Không có gì khớp' }).waitFor();
  await page.getByText('Thử từ khoá khác, hoặc bỏ bớt bộ lọc.').waitFor();
  await h.shot(page, '02b-search-no-match');
  await page.getByLabel('Tìm theo tên').fill('');

  h.log('download');
  // A PDF opens in the preview; Ctrl/⌘ + click h.downloads it straight away.
  await page.getByText('boarding-pass.pdf', { exact: true }).click({ modifiers: ['ControlOrMeta'] });
  await page.getByText(/Đã lưu vào/).waitFor();
  assert.ok(existsSync(join(h.downloads, 'boarding-pass.pdf')));
  await page.getByText('boarding-pass.pdf', { exact: true }).click({ modifiers: ['ControlOrMeta'] });
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent?.includes('(1)'));
  assert.deepEqual(readdirSync(h.downloads).sort(), ['boarding-pass (1).pdf', 'boarding-pass.pdf']);

  h.log('important');
  // The yellow label sits right after the checkbox on every row; the quick filter before "All" keeps only marked items.
  const row = (name) => page.locator('.list__row', { hasText: name });
  await row('chi-tieu-2026.xlsx').getByRole('button', { name: 'Đánh dấu quan trọng' }).click();
  await row('chi-tieu-2026.xlsx').getByRole('button', { name: 'Bỏ đánh dấu quan trọng' }).waitFor();
  await page.getByRole('button', { name: 'Chỉ hiện mục quan trọng' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.list__row:not(.list__row--head)').length === 1);
  await h.shot(page, '03a-important-filter');
  await page.getByRole('button', { name: 'Chỉ hiện mục quan trọng' }).click();
  assert.ok((await page.locator('.list__row:not(.list__row--head)').count()) > 1);
  assert.equal(await page.getByRole('columnheader', { name: 'Từ' }).count(), 0, 'no From column');

  h.log('grid download');
  await page.getByRole('switch', { name: 'Dạng lưới' }).click();
  await page.keyboard.press('Escape');
  // The download button over a file's card is reachable with Tab, and works.
  const sheetTile = page.locator('.tile', { hasText: 'chi-tieu-2026.xlsx' });
  await sheetTile.focus();
  await page.keyboard.press('Tab'); // checkbox… walk until the download button has focus
  for (let i = 0; i < 8 && !(await sheetTile.locator('.tile__download').evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab');
  assert.ok(await sheetTile.locator('.tile__download').evaluate((el) => el === document.activeElement), 'download reachable by Tab');
  await h.shot(page, '03c-grid-download-focus');
  await page.keyboard.press('Enter');
  await page.getByText(/Đã lưu vào.*chi-tieu-2026/).waitFor();
  await page.getByRole('switch', { name: 'Dạng danh sách' }).click();

  h.log('pdf preview');
  await page.getByText('Báo cáo tháng 11.pdf', { exact: true }).click();
  const pdf = page.getByRole('dialog', { name: 'Báo cáo tháng 11.pdf' });
  await pdf.locator('iframe.pdfprev__doc[src^="blob:"]').waitFor();
  await page.waitForTimeout(1500); // let the viewer draw the page
  await h.shot(page, '03b-pdf-preview');
  await page.keyboard.press('Escape');
  await pdf.waitFor({ state: 'detached' });

  h.log('lightbox');
  await page.getByText('IMG_20261112_0832.jpg', { exact: true }).click();
  await page.locator('.lightbox img').first().waitFor(); // the thumbnail and the full image can both be mounted
  await page.waitForTimeout(400);
  await h.shot(page, '04-lightbox');
  await page.keyboard.press('ArrowRight');
  await page.locator('.lightbox__title', { hasText: 'PXL_20261112_071503.heic' }).waitFor();
  await page.keyboard.press('Escape');

  h.log('context menu + delete');
  await page.getByText('chi-tieu-2026.xlsx', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Chuyển vào thùng rác' }).waitFor();
  await h.shot(page, '05-context-menu');
  // Deleting moves the file to the trash without a confirmation; the toast offers Undo.
  await page.getByRole('menuitem', { name: 'Chuyển vào thùng rác' }).click();
  await page.getByText('Đã chuyển 1 file vào thùng rác').waitFor();
  assert.equal(await page.getByText('chi-tieu-2026.xlsx', { exact: true }).count(), 0);
}

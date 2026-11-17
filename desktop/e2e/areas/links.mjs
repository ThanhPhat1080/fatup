// E2E area "links": Links: platform filters and the social box, grouping, list columns, copy, cached previews, in-app preview (embed, og card, web page).
// Run alone: npm run e2e -- links   (see ../smoke.mjs)
import assert from 'node:assert/strict';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { kind, showAll } from '../harness.mjs';

/** @param {Awaited<ReturnType<typeof import('../harness.mjs').createHarness>>} h */
export async function run(h) {
  const { app, page } = await h.launchReady();
  h.log('links');
  await kind(page, 'Liên kết').click();
  await page.getByText('Thread về AI', { exact: true }).waitFor();
  const linkRows = page.locator('.list__row:not(.list__row--head)');
  assert.equal(await linkRows.count(), 6);
  // Internet and YouTube sit next to "All"; the social networks (X and Threads too) hide in the Social box.
  for (const name of ['Internet', 'YouTube']) await page.getByRole('button', { name: `Chỉ hiện link ${name}`, exact: true }).waitFor();
  for (const name of ['Facebook', 'X', 'Threads']) assert.equal(await page.getByRole('button', { name: `Chỉ hiện link ${name}`, exact: true }).count(), 0, `${name} starts inside the box`);
  await h.shot(page, '04a-links-box-closed');
  await page.getByRole('button', { name: 'Mạng xã hội' }).click();
  await page.getByRole('button', { name: 'Chỉ hiện link Facebook', exact: true }).waitFor();
  await page.waitForTimeout(900); // let the icons finish hopping out
  await h.shot(page, '04a-links-box-open');
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
  await h.shot(page, '04b-links-list');
  await page.getByRole('button', { name: 'Nguồn', exact: true }).click(); // second click reverses: YouTube first, then TikTok...
  await page.waitForFunction(() => document.querySelector('.list__row:not(.list__row--head) .ellipsis')?.textContent === 'Cách nấu phở ngon');
  // Selecting swaps the island for the selection bar in exactly the same box, and the platform filter stays.
  const islandBox = await page.locator('.chips-row.island').boundingBox();
  const filterY = (await page.locator('.site-chips').boundingBox()).y;
  await linkRows.first().getByRole('checkbox').click();
  const selBox = await page.locator('.selbar').boundingBox();
  assert.deepEqual([selBox.x, selBox.y, selBox.width, selBox.height].map(Math.round), [islandBox.x, islandBox.y, islandBox.width, islandBox.height].map(Math.round), 'same box as the island');
  assert.equal(Math.round((await page.locator('.site-chips').boundingBox()).y), Math.round(filterY), 'the platform filter stays put');
  await h.shot(page, '04a-links-selected');
  await page.getByRole('button', { name: 'Bỏ chọn' }).click();
  // With "All" platforms the links are grouped: one group per platform, titled with its name, and per other website by domain.
  // The switch folds and unfolds every group.
  await page.getByRole('button', { name: 'YouTube, 1 liên kết' }).waitFor();
  await page.getByRole('button', { name: 'example.com, 1 liên kết' }).waitFor();
  assert.equal(await page.locator('.group-toggle').count(), 6);
  await page.getByRole('switch', { name: 'Thu gọn tất cả nhóm' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.list__row:not(.list__row--head)').length === 0);
  await h.shot(page, '04b-links-collapsed');
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
  await h.shot(page, '04b-links-list-hover');
  // Each link has a copy button right on its row.
  await linkRows.filter({ hasText: 'Thread về AI' }).getByRole('button', { name: 'Sao chép link' }).click();
  await page.getByText('Đã sao chép link').waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://x.com/someone/status/1');
  await page.getByRole('switch', { name: 'Dạng lưới', exact: true }).click();
  // Link pictures are fetched by the app, kept on disk and shown through fatup-preview://; the link without one gets the cow.
  await page.waitForFunction(() => document.querySelectorAll('.tile img[src^="fatup-preview://"]').length === 5);
  assert.equal(await page.locator('.tile .cow-thumb').count(), 1, 'the cow stays in the grid, for the link that has no picture');
  assert.equal(readdirSync(join(h.userData, 'previews')).filter((f) => f.endsWith('.png')).length, 5, 'the pictures are kept on disk');
  await page.locator('.tile', { hasText: 'Video Tik' }).hover();
  await page.locator('.tile', { hasText: 'Video Tik' }).getByRole('button', { name: 'Sao chép link' }).waitFor({ state: 'visible', timeout: 3000 }); // on the grid it appears on hover
  const nameWidth = await page.locator('.tile', { hasText: 'Video Tik' }).locator('.tile__name').evaluate((el) => el.getBoundingClientRect().width);
  assert.ok(nameWidth > 60, `the buttons float over the name instead of squeezing it (name is ${nameWidth}px wide)`);
  await h.shot(page, '04d-links-grid-hover');
  assert.ok(await page.locator('.tile img[src^="fatup-preview://"]').first().evaluate((img) => img.complete && img.naturalWidth > 0), 'the cached picture loads');
  await h.shot(page, '04c-links-grid');

  h.log('link preview');
  // Clicking a link opens it inside the app: the platform's own player where there is one…
  await page.locator('.tile', { hasText: 'Video TikTok vui' }).locator('.tile__thumb').click();
  const preview = page.getByRole('dialog', { name: 'Video TikTok vui' });
  await preview.waitFor();
  assert.equal(await preview.locator('iframe').getAttribute('src'), 'https://www.tiktok.com/player/v1/1?autoplay=1');
  await preview.getByRole('button', { name: 'Mở trong trình duyệt' }).waitFor();
  await h.shot(page, '04e-link-preview-embed');
  await page.keyboard.press('Escape');
  await preview.waitFor({ state: 'detached' });
  // Facebook: the og: card (title, picture, open in the browser), never the page behind its login wall.
  await page.locator('.tile', { hasText: 'Bài viết hay trên Facebook' }).locator('.tile__thumb').click();
  const fb = page.getByRole('dialog', { name: 'Bài viết hay trên Facebook' });
  await fb.locator('.linkprev__card img').waitFor();
  assert.equal(await fb.locator('iframe, .webpage').count(), 0);
  await h.shot(page, '04e-link-preview-facebook');
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
  await h.shot(page, '04f-link-preview-page');
  if (h.shots) {
    // The page is drawn by the browser view, outside what page.screenshot() sees: capture the view itself too.
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].contentView.children[0].webContents.capturePage()).toPNG().toString('base64'));
    writeFileSync(join(h.shots, '04g-link-preview-page-view.png'), Buffer.from(png, 'base64'));
  }
  await page.keyboard.press('Escape');
  await card.waitFor({ state: 'detached' });
  assert.deepEqual(await viewUrl(), [], 'closing the preview removes the page');

  await page.getByRole('switch', { name: 'Dạng danh sách', exact: true }).click();
  await showAll(page);
}

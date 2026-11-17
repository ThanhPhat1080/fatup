// E2E area "share": Public share links: dialog, shared icon and tooltip, popover, Shared filter, grid, revocation on trash; Trash and Vault titles.
// Run alone: npm run e2e -- share   (see ../smoke.mjs)
import assert from 'node:assert/strict';
import { kind, showAll, typePin } from '../harness.mjs';

/** @param {Awaited<ReturnType<typeof import('../harness.mjs').createHarness>>} h */
export async function run(h) {
  const { page } = await h.launchReady();
  h.log('share');
  {
    const docx = page.locator('.list__row', { hasText: 'Hợp đồng thuê nhà.docx' });
    const geometry = () =>
      docx.evaluate((r) => {
        const pen = r.querySelector('.col-actions .rename-btn').getBoundingClientRect();
        return { penLeft: Math.round(pen.left), penRight: Math.round(pen.right), rowHeight: Math.round(r.getBoundingClientRect().height) };
      });
    const before = await geometry();
    assert.equal(await page.locator('.share-btn').count(), 0, 'nothing is shared yet');

    // Menu → Share… opens the dialog; create a link.
    await docx.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Chia sẻ…' }).click();
    await page.getByRole('dialog').getByText('Tạo một link để gửi cho người khác', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Tạo link và sao chép' }).click();
    const linkBox = page.getByRole('dialog').locator('.share__link input');
    await linkBox.waitFor();
    assert.match(await linkBox.inputValue(), /\/s\/[A-Za-z0-9_-]{32}$/, 'the dialog shows the public link');
    await h.shot(page, '02c-share-dialog');
    await page.getByRole('dialog').getByRole('button', { name: 'Đóng' }).last().click();

    // The icon appears left of the pencil and moves nothing else.
    await page.locator('.share-btn').waitFor();
    const after = await geometry();
    assert.deepEqual(after, before, 'the pencil and the row do not move when the shared icon appears');
    const iconRight = await page.locator('.share-btn').evaluate((e) => Math.round(e.getBoundingClientRect().right));
    assert.ok(iconRight <= before.penLeft, 'the shared icon sits left of the pencil');
    assert.equal(await page.locator('.list__name', { hasText: 'Hợp đồng thuê nhà.docx' }).getByText('Đang chia sẻ').count(), 0, 'icon only, no text in the row');

    // Tooltip on the left, no layout change.
    await page.locator('.share-btn').hover();
    await page.waitForTimeout(600);
    assert.equal(await page.locator('.share-btn').evaluate((e) => getComputedStyle(e, '::after').opacity), '1', 'tooltip shows on hover');
    assert.equal(await page.locator('.share-btn').evaluate((e) => getComputedStyle(e, '::after').right.endsWith('px')), true);
    assert.deepEqual(await geometry(), before, 'the tooltip does not shift the layout');
    await h.shot(page, '02d-share-tooltip');

    // Clicking the icon opens the quick popover; change the expiry; stop sharing.
    await page.locator('.share-btn').click();
    const pop = page.locator('.popover--share');
    await pop.locator('.share__link input').waitFor();
    await pop.getByRole('button', { name: '7 ngày' }).click();
    await pop.getByRole('button', { name: '7 ngày' }).and(page.locator('[aria-pressed="true"]')).waitFor();
    await h.shot(page, '02e-share-popover');
    await pop.getByRole('button', { name: 'Dừng chia sẻ' }).click();
    await page.getByText('Đã dừng chia sẻ').waitFor();
    assert.equal(await page.locator('.share-btn').count(), 0, 'the icon goes away once sharing stops');

    // Share again; the "Đã chia sẻ" filter counts it and filters (AND with the kind toggles).
    await docx.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Quản lý chia sẻ…' }).count().then((n) => assert.equal(n, 0, 'an unshared file offers "Share…", not "Manage"'));
    await page.getByRole('menuitem', { name: 'Chia sẻ…' }).click();
    await page.getByRole('button', { name: 'Tạo link và sao chép' }).click();
    await page.getByRole('dialog').locator('.share__link input').waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'Đóng' }).last().click();
    const chip = page.locator('.chip--shared');
    assert.equal(await chip.locator('.chip__count').textContent(), '1');
    // The title above the table says where you are: All with nothing toggled, the kind when one is, and a tag while Shared is on.
    assert.equal((await page.locator('.view-title').textContent())?.trim(), 'Tất cả');
    await chip.click();
    assert.equal(await page.locator('.view-title__tag').textContent(), 'Đã chia sẻ', 'the Shared filter adds a tag beside the title');
    assert.equal(await page.locator('.list__row:not(.list__row--head)').count(), 1, 'only the shared file shows');
    await h.shot(page, '02f-shared-filter');

    // Grid: the shared icon floats (always visible) and slides left of the pencil when that appears on hover.
    await page.getByRole('switch', { name: 'Dạng lưới' }).click();
    const tile = page.locator('.tile', { hasText: 'Hợp đồng thuê nhà.docx' });
    await tile.locator('.share-btn').waitFor({ state: 'visible' });
    await tile.hover();
    await page.waitForTimeout(300);
    const tileRects = await tile.evaluate((t) => {
      const r = (sel) => Math.round(t.querySelector(sel).getBoundingClientRect().left);
      return { share: Math.round(t.querySelector('.share-btn').getBoundingClientRect().right), pencil: r('.rename-btn'), more: r('.tile__head > .icon-btn:last-child') };
    });
    assert.ok(tileRects.share <= tileRects.pencil + 1 && tileRects.pencil < tileRects.more, `grid order is shared icon, pencil, more (${JSON.stringify(tileRects)})`);
    await h.shot(page, '02g-share-grid');
    await page.getByRole('switch', { name: 'Dạng danh sách' }).click();
    await kind(page, 'Ảnh').click();
    assert.match((await page.locator('.view-title').textContent()) ?? '', /^Ảnh/, 'the title follows the toggled kind');
    assert.equal(await page.locator('.list__row:not(.list__row--head), .tile').count(), 0, 'shared AND photos: nothing');
    await kind(page, 'Ảnh').click();
    await chip.click();
    await showAll(page);

    // Moving a shared file to the trash ends its link, and says so.
    await docx.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Chuyển vào thùng rác' }).click();
    await page.getByText(/Link chia sẻ của file này đã hết hiệu lực/).waitFor();
    assert.equal(await page.locator('.share-btn').count(), 0);
    assert.equal(await chip.locator('.chip__count').textContent(), '0');

    // The trash opens on everything (the kind toggled before is dropped) and is named above the table.
    await kind(page, 'File').click();
    await page.getByRole('button', { name: 'Thùng rác' }).click();
    await page.locator('.view-title', { hasText: 'Thùng rác' }).waitFor();
    assert.equal(await page.locator('.kind-tabs [aria-pressed="true"]').count(), 0, 'no kind is toggled in the trash');
    await h.shot(page, '02h-trash-title');
    await page.getByRole('button', { name: 'Quay lại danh sách file' }).first().click();
    assert.equal((await page.locator('.view-title').textContent())?.trim(), 'Tất cả');

    // The Vault too: it opens on everything, and its name sits above the table.
    await kind(page, 'Ảnh').click();
    await page.getByRole('button', { name: 'Két sắt', exact: true }).first().click();
    await typePin(page, '1234');
    await page.locator('.view-title', { hasText: 'Két sắt' }).waitFor();
    assert.equal(await page.locator('.kind-tabs [aria-pressed="true"]').count(), 0, 'no kind is toggled in the Vault');
    await h.shot(page, '02i-vault-title');
    await page.getByRole('button', { name: 'Quay lại danh sách file' }).first().click();
    assert.equal((await page.locator('.view-title').textContent())?.trim(), 'Tất cả');
  }
}

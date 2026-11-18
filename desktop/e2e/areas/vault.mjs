// E2E area "vault": the encrypted Vault end to end: setup wizard with the recovery key, upload into the Vault, delete to its trash
// (Undo toast), the trash panel (sidebar at 1280 px, full screen at 400 px), restore, close, and unlock with a wrong PIN twice, then the right one.
// Then the held key (6 h after the PIN): entering the Vault always asks the PIN, but moving files in from the main list asks nothing while
// the key is held. After a restart (no key) the small popup comes over the list: wrong PIN, cancel, right PIN, and a failed move's toast.
// Run alone: npm run e2e -- vault   (see ../smoke.mjs)
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { typePin } from '../harness.mjs';

const PIN = '204781';
const WRONG = '111111';
const PICTURE = 'anh-thu.png';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A small RGB PNG with a colour gradient, written by hand so the test needs no image file in the repo. */
function makePng(width, height) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3); // filter byte 0, then RGB pixels
    for (let x = 0; x < width; x++) {
      const i = 1 + x * 3;
      row[i] = Math.round((255 * x) / width);
      row[i + 1] = Math.round((255 * y) / height);
      row[i + 2] = 180;
    }
    rows.push(row);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** @param {Awaited<ReturnType<typeof import('../harness.mjs').createHarness>>} h */
export async function run(h) {
  let { app, page } = await h.launchReady();
  const vaultRow = () => page.locator('.list__row', { hasText: PICTURE });

  h.log('vault: open the setup wizard');
  await page.getByRole('button', { name: 'Két sắt', exact: true }).first().click();
  await page.locator('.vault-card').getByRole('button', { name: 'Bắt đầu', exact: true }).click();
  await typePin(page, PIN);
  await page.getByText('Nhập lại mã PIN', { exact: true }).waitFor();
  await typePin(page, PIN);

  h.log('vault: recovery key');
  const keyBox = page.locator('.vault-key');
  await keyBox.waitFor();
  const recoveryKey = ((await keyBox.textContent()) ?? '').trim();
  const groups = recoveryKey.split('-');
  assert.ok(groups.length >= 3, `the recovery key has groups (${recoveryKey})`);
  await h.shot(page, '13a-vault-recovery');
  await page.locator('.vault-card').getByRole('button', { name: 'Tiếp', exact: true }).click();

  h.log('vault: confirm two groups');
  const fields = page.locator('.vault-confirm__field');
  await fields.first().waitFor();
  assert.equal(await fields.count(), 2, 'two groups are asked');
  for (let i = 0; i < 2; i++) {
    const n = Number(/(\d+)/.exec((await fields.nth(i).locator('span').textContent()) ?? '')?.[1]);
    await fields.nth(i).locator('input').fill(groups[n - 1]);
  }
  await page.locator('.vault-confirm').getByRole('button', { name: 'Tiếp', exact: true }).click();
  // The commit (step two of the setup) shows its own line for a moment; the screenshot of it is best effort, the commit may be quicker.
  if (await page.getByText('Đang tạo két sắt…', { exact: true }).waitFor({ timeout: 1500 }).then(() => true, () => false)) {
    await h.shot(page, '13a2-vault-committing');
  } else {
    h.log('vault: the committing line was gone before the screenshot (commit was quicker)');
  }
  await page.locator('.vault-card').getByRole('button', { name: 'Mở két', exact: true }).click();

  h.log('vault: opened');
  await page.locator('.app.vault-mode').waitFor();
  assert.equal(await page.locator('.vault-label').textContent(), '🔒 Két sắt · đã mã hóa', 'the Vault names itself with the encrypted label');

  h.log('vault: upload a picture');
  const source = mkdtempSync(join(tmpdir(), 'fatup-e2e-vault-src-'));
  const picture = join(source, PICTURE);
  writeFileSync(picture, makePng(480, 320));
  // The open dialog is the only host step: the upload button then runs the real upload path with this file.
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, picture);
  await page.locator('.upload-btn').click();
  await vaultRow().locator('img.list__mini[src^="fatup-vault://thumb/"]').waitFor({ timeout: 30_000 });
  assert.equal(await vaultRow().count(), 1, 'the picture is listed once, in the Vault');
  await h.shot(page, '13b-vault-list');

  h.log('vault: delete, Undo toast');
  await vaultRow().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Chuyển vào thùng rác' }).click();
  await page.locator('.toast__action', { hasText: 'Hoàn tác' }).waitFor();
  assert.equal(await vaultRow().count(), 0, 'the picture left the list');

  h.log('vault: toast goes, trash panel opens');
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 15_000 });
  await page.setViewportSize({ width: 1280, height: 760 });
  await page.getByRole('button', { name: 'Thùng rác của két' }).click();
  const panel = page.getByRole('dialog', { name: 'Thùng rác của Két sắt' });
  await panel.locator('.vault-trash__row', { hasText: PICTURE }).waitFor();
  assert.equal(await page.locator('.app.vault-mode').count(), 1, 'opening the trash keeps the Vault open');
  const sidebar = page.locator('aside.vault-trash--sidebar');
  await sidebar.waitFor();
  const wide = await sidebar.boundingBox();
  assert.ok(Math.abs(wide.width - 1280 * 0.7) <= 2, `sidebar is 70% of 1280 px (got ${Math.round(wide.width)})`);
  await h.shot(page, '13c-vault-trash-1280');

  h.log('vault: trash at 400 px');
  await page.setViewportSize({ width: 400, height: 760 });
  const overlay = page.locator('aside.vault-trash--overlay');
  await overlay.waitFor();
  const full = await overlay.boundingBox();
  assert.ok(Math.abs(full.width - 400) <= 2, `overlay covers the full 400 px width (got ${Math.round(full.width)})`);
  await h.shot(page, '13d-vault-trash-400');

  h.log('vault: restore');
  await overlay.locator('.vault-trash__row', { hasText: PICTURE }).getByRole('button', { name: 'Khôi phục' }).click();
  await overlay.locator('.vault-trash__row', { hasText: PICTURE }).waitFor({ state: 'detached' });
  await overlay.locator('.vault-trash__head .icon-btn').first().click(); // back to the Vault
  await page.setViewportSize({ width: 1180, height: 760 });
  await vaultRow().waitFor();
  assert.equal(await vaultRow().count(), 1, 'the restored picture is back in the Vault list');

  h.log('vault: close');
  await page.getByRole('button', { name: 'Đóng Két sắt' }).click();
  await page.locator('.app:not(.vault-mode)').waitFor();
  assert.equal(await page.locator('.list__row', { hasText: PICTURE }).count(), 0, 'the Vault picture is not in the normal list');
  // Leaving the Vault keeps the key for moving files in (6 hours), while viewing still asks for the PIN below.
  assert.equal((await page.evaluate(() => window.fatup.vaultStatus())).value.open, true, 'the key is still held after leaving the Vault');

  h.log('vault: entering again asks for the PIN although the key is held');
  await page.getByRole('button', { name: 'Két sắt', exact: true }).first().click();
  await page.locator('.vaultscreen .pin__input').waitFor();
  assert.equal(await page.locator('.vaultscreen .vault-card').count(), 0, 'the Vault card (setup) is not shown: this is the gate');
  assert.equal(await page.locator('.vault-label').count(), 0, 'the Vault label (unlocked view) is not shown behind the gate');
  assert.equal(await page.locator('.list__row', { hasText: PICTURE }).count(), 0, 'no Vault picture is shown behind the gate');

  h.log('vault: gate, wrong PIN twice');
  await typePin(page, WRONG);
  await page.getByText('Sai PIN. Còn 9 lần thử.', { exact: true }).waitFor();
  await typePin(page, WRONG);
  await page.getByText('Sai PIN. Còn 8 lần thử.', { exact: true }).waitFor();
  await h.shot(page, '13e-vault-gate-wrong-pin');

  h.log('vault: gate, right PIN');
  await typePin(page, PIN);
  await page.locator('.app.vault-mode').waitFor({ timeout: 20_000 });
  await vaultRow().waitFor();

  h.log('vault: title, kinds, back');
  // The Vault opens on everything, and its name sits above the table.
  await page.locator('.view-title', { hasText: 'Két sắt' }).waitFor();
  assert.equal(await page.locator('.kind-tabs [aria-pressed="true"]').count(), 0, 'no kind is toggled in the Vault');
  await page.getByRole('button', { name: 'Quay lại danh sách file' }).first().click();
  assert.equal((await page.locator('.view-title').textContent())?.trim(), 'Tất cả');

  h.log('vault: dark theme');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(300);
  await h.shot(page, '13f-vault-list-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  // Moving files in from the main list (plan 2026-11-18-vault-session-6h, decisions 3-6). The key is held for 6 hours after the PIN,
  // so the first moves ask nothing; a fresh launch holds no key, and then the small popup comes over the list.
  let gate = page.locator('.vaultscreen');
  let popup = page.getByRole('dialog', { name: 'Mở Két sắt' });
  const moveFromList = async (name) => {
    const row = page.locator('.list__row', { hasText: name });
    await row.waitFor();
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Chuyển vào Két sắt' }).click();
    return row;
  };

  h.log('vault: move two files in while the key is held: no popup, no Vault view');
  const DALAT = 'Đà Lạt trip.jpg';
  const SECOND = 'IMG_20261105_1012.jpg';
  const first = await moveFromList(DALAT);
  await first.waitFor({ state: 'detached', timeout: 30_000 });
  const second = await moveFromList(SECOND); // right after the first one
  await second.waitFor({ state: 'detached', timeout: 30_000 });
  assert.equal(await popup.count(), 0, 'with the key held, moving in shows no PIN popup');
  assert.equal(await gate.count(), 0, 'with the key held, moving in shows no gate');
  assert.equal(await page.locator('.app.vault-mode').count(), 0, 'the app stays on the main list');
  await h.shot(page, '15a-move-held-no-prompt');

  h.log('vault: the moved files are pending, then encrypted');
  // The mock holds vault/in/complete for `mock.slowVaultComplete` ms; the Vault is opened during that wait, so the files are pending.
  await page.getByRole('button', { name: 'Két sắt', exact: true }).first().click();
  await gate.locator('.pin__input').waitFor();
  await typePin(page, PIN);
  await page.locator('.app.vault-mode').waitFor({ timeout: 20_000 });
  const movedRow = page.locator('.list__row', { hasText: DALAT });
  const secondRow = page.locator('.list__row', { hasText: SECOND });
  await movedRow.locator('[data-vault-state="pending"]').waitFor({ timeout: 5_000 });
  await h.shot(page, '14c-vault-state-pending');
  await movedRow.locator('[data-vault-state="encrypted"]').waitFor({ timeout: 30_000 });
  await secondRow.locator('[data-vault-state="encrypted"]').waitFor({ timeout: 30_000 });
  assert.equal(await movedRow.locator('[data-vault-state="pending"]').count(), 0, 'no pending mark is left once the file is encrypted');

  h.log('vault: state icons, list and phone');
  await h.shot(page, '14a-vault-state-icons');
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator('.app.vault-mode').waitFor();
  await movedRow.locator('[data-vault-state="encrypted"]').waitFor();
  await h.shot(page, '14b-vault-state-icons-phone');
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.getByRole('button', { name: 'Quay lại danh sách file' }).first().click();
  await page.locator('.app:not(.vault-mode)').waitFor();

  // A fresh launch holds no key (the process held it, and it is gone). The app lock comes first, then the list.
  h.log('vault: restart: the key is not held any more');
  await h.closeApp(app);
  ({ app, page } = await h.launch());
  // Locators are bound to a page: rebind the ones made for the old window.
  gate = page.locator('.vaultscreen');
  popup = page.getByRole('dialog', { name: 'Mở Két sắt' });
  await page.locator('.pin__input').waitFor();
  await typePin(page, '1234'); // the app PIN from launchReady
  await page.getByText('Hôm nay').first().waitFor();

  h.log('vault: move in with no key: the small popup over the list');
  const BOARDING = 'boarding-pass.pdf';
  const boarding = await moveFromList(BOARDING);
  await popup.waitFor();
  assert.equal(await gate.count(), 0, 'the full-screen gate does not open for the popup');
  assert.equal(await page.locator('.app.vault-mode').count(), 0, 'the Vault view does not open for the popup');
  assert.equal(await boarding.count(), 1, 'the file list stays in view behind the popup');
  await page.waitForTimeout(800); // let the popup settle before the screenshot
  await h.shot(page, '15b-vault-popup-desktop');

  h.log('vault: the popup fits at phone width');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  assert.equal(await popup.locator('.pin__cell').count(), 6, 'six PIN cells');
  const geo = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Mở Két sắt"]');
    const r = d.getBoundingClientRect();
    return {
      dialog: { left: r.left, right: r.right, sw: d.scrollWidth, cw: d.clientWidth },
      cells: [...d.querySelectorAll('.pin__cell')].map((c) => c.getBoundingClientRect()).map((c) => ({ left: c.left, right: c.right, width: c.width })),
      pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
    };
  });
  for (const c of geo.cells) {
    assert.ok(c.left >= geo.dialog.left && c.right <= geo.dialog.right, `a PIN cell is inside the dialog (${JSON.stringify(c)} vs ${JSON.stringify(geo.dialog)})`);
  }
  assert.ok(geo.dialog.sw <= geo.dialog.cw + 1, `the dialog does not overflow sideways (scrollWidth ${geo.dialog.sw}, clientWidth ${geo.dialog.cw})`);
  assert.ok(geo.pageOverflow <= 0, `no horizontal page scroll at 390 px (overflow ${geo.pageOverflow})`);
  await h.shot(page, '15c-vault-popup-phone');

  h.log('vault: wrong PIN shows the error in the popup');
  await typePin(page, WRONG);
  await popup.getByText(/Sai PIN\. Còn \d+ lần thử\./).waitFor();
  await h.shot(page, '15d-vault-popup-wrong-pin');
  assert.equal(await boarding.count(), 1, 'a wrong PIN moves nothing');

  h.log('vault: cancel closes the popup and moves nothing');
  await popup.getByRole('button', { name: 'Hủy', exact: true }).click();
  await popup.waitFor({ state: 'detached' });
  assert.equal(await boarding.count(), 1, 'cancel leaves the file in the list');
  assert.equal((await page.evaluate(() => window.fatup.vaultStatus())).value.open, false, 'cancel holds no key');

  h.log('vault: the right PIN moves the file, the app stays on the list');
  await page.setViewportSize({ width: 1180, height: 760 });
  await page.waitForTimeout(300);
  await boarding.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Chuyển vào Két sắt' }).click();
  await popup.waitFor();
  await typePin(page, PIN);
  await boarding.waitFor({ state: 'detached', timeout: 30_000 });
  await popup.waitFor({ state: 'detached' });
  assert.equal(await page.locator('.app.vault-mode').count(), 0, 'the user stays on the main list');
  assert.equal(await gate.count(), 0, 'no gate after the popup');

  h.log('vault: a second move right after asks nothing');
  const CHI = 'chi-tieu-2026.xlsx';
  const chi = await moveFromList(CHI);
  await chi.waitFor({ state: 'detached', timeout: 30_000 });
  assert.equal(await popup.count(), 0, 'the second move shows no popup');

  h.log('vault: a failed move says the files are in the Vault as faded cloud');
  // The second move's complete is held for slowVaultComplete ms, so wait for its success toast before arming the one-shot failure
  // (otherwise the switch could hit that earlier request). Then the next vault/in/complete fails with a 500 and the mover puts the file in `failed`.
  await page.locator('.toast', { hasText: 'Đã chuyển 1 file vào Két sắt' }).waitFor({ timeout: 20_000 });
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 15_000 });
  mock.failVaultComplete = 1;
  const FAIL = 'Screenshot_2026-11-12.png';
  const failed = await moveFromList(FAIL);
  await failed.waitFor({ state: 'detached', timeout: 30_000 });
  const toast = page.locator('.toast', { hasText: 'Chưa cất được 1 file' });
  await toast.waitFor({ timeout: 15_000 });
  const toastText = (await toast.textContent()) ?? '';
  assert.match(toastText, /đám mây mờ/, 'the toast names the faded cloud icon');
  assert.match(toastText, /danh sách chính/, 'the toast says a file left in the main list can be moved again');
  assert.doesNotMatch(toastText, /failed|không thành công/i, 'the toast is not a bare failure count');
  await h.shot(page, '15e-vault-move-failed-toast');
  mock.failVaultComplete = 0;

  h.log('vault: the failed file is inside the Vault');
  await page.getByRole('button', { name: 'Két sắt', exact: true }).first().click();
  await gate.locator('.pin__input').waitFor();
  await typePin(page, PIN);
  await page.locator('.app.vault-mode').waitFor({ timeout: 20_000 });
  const failedRow = page.locator('.list__row', { hasText: FAIL });
  await failedRow.waitFor();
  const state = await failedRow.locator('[data-vault-state]').getAttribute('data-vault-state');
  assert.ok(state === 'pending' || state === 'encrypted', `the failed file is in the Vault as ${state} (not plain)`);
  await h.shot(page, '15f-vault-failed-file-inside');
  await page.setViewportSize({ width: 1180, height: 760 });
}

/**
 * Timing and failure switches for the mock. slowVaultComplete holds each vault/in/complete for 8 s, so a move stays pending while the
 * Vault is opened. failVaultComplete is set by the area at run time (it is the same object the mock reads).
 */
export const mock = { slowVaultComplete: 8000, failVaultComplete: 0 };

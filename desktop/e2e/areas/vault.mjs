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
import { turnLotrOn, typePin } from '../harness.mjs';

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
  // The six PIN cells sit in the middle of the card, not against its left edge.
  await page.locator('.vault-card .pin__cells').waitFor();
  const centred = async (label) => {
    const { card, cells } = await page.evaluate(() => {
      const card = document.querySelector('.vault-card').getBoundingClientRect();
      const all = [...document.querySelectorAll('.vault-card .pin__cell')].map((c) => c.getBoundingClientRect());
      return { card: { left: card.left, right: card.right }, cells: { left: all[0].left, right: all[all.length - 1].right } };
    });
    const offset = (cells.left + cells.right) / 2 - (card.left + card.right) / 2;
    assert.ok(Math.abs(offset) <= 2, `${label}: the PIN cells are centred in the card (off by ${offset.toFixed(1)}px)`);
  };
  await centred('setup PIN, desktop width');
  await h.shot(page, '13-setup-pin');
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
  await vaultRow().locator('[data-vault-state="encrypted"]').waitFor({ timeout: 30_000 });
  assert.equal(await vaultRow().count(), 1, 'the picture is listed once, in the Vault');
  // The Vault shows no thumbnail, not even for a picture that has one: the row has the file icon and no <img> from fatup-vault://.
  assert.equal(await page.locator('img[src^="fatup-vault://"]').count(), 0, 'the Vault list loads no thumbnail');
  assert.equal(await vaultRow().locator('img').count(), 0, 'the picture row shows an icon, not a picture');
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

  h.log('vault: simple gate (LOTR lock off): the door says VAULT, no wizard, Back leaves at once');
  await page.getByRole('button', { name: 'Két sắt', exact: true }).first().click();
  await page.locator('.vaultscreen .sdoor').waitFor();
  assert.equal(await page.locator('.vaultscreen .sdoor__label').textContent(), 'VAULT', 'the simple door is labelled VAULT');
  assert.equal(await page.locator('.vaultscreen .lockheist').count(), 0, 'no wizard in the simple gate');
  assert.equal(await page.locator('.vaultscreen .lockbg').count(), 0, 'no backdrop in the simple gate');
  await page.locator('.vaultscreen .pin__input').waitFor();
  await h.shot(page, '13e0-vault-gate-simple');
  await page.getByRole('button', { name: 'Quay lại', exact: true }).click();
  await page.locator('.vaultscreen').waitFor({ state: 'detached', timeout: 1500 }); // no 3.4 s wait with the simple gate

  h.log('vault: turn the LOTR lock on in Settings, the full gate comes back');
  await page.getByRole('button', { name: 'Cài đặt' }).click();
  await turnLotrOn(page);
  await page.keyboard.press('Escape');

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

  h.log('vault: the gate on a phone is a still picture');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const still = await page.evaluate(() => {
    const g = document.querySelector('.vaultscreen');
    const shown = (sel) => [...g.querySelectorAll(sel)].filter((e) => getComputedStyle(e).display !== 'none').length;
    return {
      flames: g.querySelectorAll('.lockbg__flame').length,
      flamesShown: shown('.lockbg__flame, .lockbg__spark, .lockbg__p, .lockbg__meteor, .lockbg__fireglow, .lockbg__flicker'),
      running: document.getAnimations().filter((a) => a.playState === 'running' && g.contains(a.effect?.target)).length,
    };
  });
  assert.ok(still.flames > 0, 'the fire is still in the page (it is hidden by the stylesheet, not removed)');
  assert.equal(still.flamesShown, 0, 'no flame, spark, ash, ember or meteor is shown on a phone');
  assert.equal(still.running, 0, `nothing in the gate animates on a phone (${still.running} running)`);
  await h.shot(page, '13f-vault-gate-phone-still');
  await page.setViewportSize({ width: 1180, height: 760 });

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

  h.log('vault: on a phone the right PIN opens the Vault at once (no bomb)');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Két sắt', exact: true }).first().click();
  await page.locator('.vaultscreen .pin__input').waitFor();
  const asked = Date.now();
  await typePin(page, PIN);
  await page.locator('.app.vault-mode').waitFor({ timeout: 20_000 });
  assert.ok(Date.now() - asked < 1500, `no blast to wait for on a phone (took ${Date.now() - asked} ms; the blast alone is about 1850 ms)`);
  await page.getByRole('button', { name: 'Quay lại danh sách file' }).first().click();
  await page.setViewportSize({ width: 1180, height: 760 });

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
  // The row of six cells sits in the middle of the dialog, not against its left edge.
  const pinRowCentre = async () =>
    page.evaluate(() => {
      const d = document.querySelector('[role="dialog"][aria-label="Mở Két sắt"]');
      const row = d.querySelector('.pin__cells').getBoundingClientRect();
      const cells = [...d.querySelectorAll('.pin__cell')].map((c) => c.getBoundingClientRect());
      const left = cells[0].left;
      const right = cells[cells.length - 1].right;
      const box = d.getBoundingClientRect();
      return { rowCentre: (left + right) / 2, dialogCentre: (box.left + box.right) / 2 };
    });
  const desktopCentre = await pinRowCentre();
  assert.ok(Math.abs(desktopCentre.rowCentre - desktopCentre.dialogCentre) <= 2, `the PIN cells are centred in the popup (${JSON.stringify(desktopCentre)})`);

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
  const phoneCentre = await pinRowCentre();
  assert.ok(Math.abs(phoneCentre.rowCentre - phoneCentre.dialogCentre) <= 2, `the PIN cells are centred in the popup on a phone (${JSON.stringify(phoneCentre)})`);

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

  // Taking files out of the Vault (plan 2026-11-18-vault-lay-ra-optimistic). The mock holds each vault/out and each vault/out/complete for
  // 4 s (slowVaultOut), so one move-out stays on screen for about 8 s; the rows must already have moved while it is held.
  mock.slowVaultOut = 4000;
  const rowIn = (name) => page.locator('.list__row', { hasText: name });
  const toastOut = (n) => page.locator('.toast', { hasText: `Đã đưa ${n} file ra khỏi Két sắt` });
  const outFromVault = async (name) => {
    await rowIn(name).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Đưa ra khỏi Két sắt', exact: true }).click();
  };
  const backToList = async () => {
    await page.getByRole('button', { name: 'Quay lại danh sách file' }).first().click();
    await page.locator('.app:not(.vault-mode)').waitFor();
  };
  const openVault = async () => {
    await page.getByRole('button', { name: 'Két sắt', exact: true }).first().click();
    await gate.locator('.pin__input').waitFor();
    await typePin(page, PIN);
    await page.locator('.app.vault-mode').waitFor({ timeout: 20_000 });
  };
  const refreshToolbar = async () => {
    await page.getByRole('button', { name: 'Làm mới', exact: true }).first().click();
    await page.waitForTimeout(1200); // the mock answers at once; the move-out itself is held, so this is well inside the hold
  };

  h.log('vault out A: one file leaves the Vault list at once and shows in the main list while the move is held');
  const OUT = 'Đà Lạt trip.jpg';
  await rowIn(OUT).locator('[data-vault-state="encrypted"]').waitFor();
  await outFromVault(OUT);
  await rowIn(OUT).waitFor({ state: 'detached', timeout: 2000 });
  await backToList();
  const ghost = rowIn(OUT);
  await ghost.waitFor({ timeout: 2000 });
  assert.equal(await ghost.count(), 1, 'the file is in the main list once, with its real name, while the move is held');
  assert.equal(await page.locator('.toast', { hasText: 'Đã đưa' }).count(), 0, 'the move is still held: no success toast yet');
  await ghost.scrollIntoViewIfNeeded();
  // Information for the report (E2E_VERBOSE-independent): where the ghost row sits, and whether it is under a toast.
  const where = await ghost.evaluate((row) => {
    const r = row.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, coveredBy: hit?.closest('.toast') ? 'toast' : hit?.className ?? null };
  });
  console.log(`  [vault out A] ghost row while held: ${JSON.stringify(where)}`);
  await h.shot(page, '16a-vault-out-held');

  h.log('vault out A: after the hold the real item is in the main list and nothing is left in the Vault');
  await toastOut(1).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(600); // the list refresh that follows the move
  assert.equal(await rowIn(OUT).count(), 1, 'after the move the file is in the main list once (no duplicate)');
  assert.equal(await rowIn(OUT).locator('img[src^="fatup-vault://"]').count(), 0, 'the main-list row is the real item (no Vault thumbnail left)');
  await openVault();
  assert.equal(await rowIn(OUT).count(), 0, 'nothing left in the Vault');
  await backToList();
  assert.equal(await rowIn(OUT).count(), 1, 'still once in the main list after leaving the Vault');

  h.log('vault out A: two files at once, and a toolbar refresh while the move is held does not bring them back');
  const PAIR = ['IMG_20261105_1012.jpg', 'chi-tieu-2026.xlsx'];
  await openVault();
  // The row checkbox selects without opening the picture (a click on the picture would open the lightbox).
  for (const name of PAIR) await rowIn(name).getByRole('checkbox').click();
  await page.getByRole('button', { name: 'Đưa ra khỏi Két sắt', exact: true }).click();
  await rowIn(PAIR[0]).waitFor({ state: 'detached', timeout: 2000 });
  await rowIn(PAIR[1]).waitFor({ state: 'detached', timeout: 2000 });
  await refreshToolbar();
  assert.equal(await rowIn(PAIR[0]).count(), 0, 'C: a refresh while held keeps the first file out of the Vault list');
  assert.equal(await rowIn(PAIR[1]).count(), 0, 'C: a refresh while held keeps the second file out of the Vault list');
  assert.equal(await page.locator('.toast', { hasText: 'Đã đưa' }).count(), 0, 'C: the move is still held after the refresh');
  await backToList();
  for (const name of PAIR) assert.equal(await rowIn(name).count(), 1, `C: ${name} is in the main list while held`);
  await refreshToolbar();
  for (const name of PAIR) assert.equal(await rowIn(name).count(), 1, `C: ${name} stays in the main list after a refresh in the main list`);
  assert.equal(await page.locator('.toast', { hasText: 'Đã đưa' }).count(), 0, 'C: still held');
  await h.shot(page, '16e-vault-out-two-held');
  await toastOut(2).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  for (const name of PAIR) assert.equal(await rowIn(name).count(), 1, `${name} is in the main list once after the move`);
  await openVault();
  for (const name of PAIR) assert.equal(await rowIn(name).count(), 0, `${name} is not in the Vault any more`);
  await backToList();

  h.log('vault out B: the file leaves the Vault at once, the failure brings it back into the Vault with a toast');
  const BAD = 'boarding-pass.pdf';
  await openVault();
  await rowIn(BAD).locator('[data-vault-state="encrypted"]').waitFor();
  mock.failVaultOut = 1; // the next vault/out (the first request of the move) answers 500, after the hold
  await outFromVault(BAD);
  await rowIn(BAD).waitFor({ state: 'detached', timeout: 2000 });
  await backToList();
  await rowIn(BAD).waitFor({ timeout: 2000 });
  assert.equal(await rowIn(BAD).count(), 1, 'B: the file shows in the main list at once, while the move is held');

  h.log('vault out B: after the failure the file is gone from the main list, with the toast');
  const failToast = page.locator('.toast', { hasText: 'Không đưa ra được 1 file khỏi Két sắt' });
  await failToast.waitFor({ timeout: 20_000 });
  await rowIn(BAD).waitFor({ state: 'detached', timeout: 5000 });
  assert.equal(await rowIn(BAD).count(), 0, 'B: after the failure the file is gone from the main list');
  assert.equal(mock.failVaultOut, 0, 'B: the one-shot failure was used by the move-out');
  await h.shot(page, '16b-vault-out-failed-toast');

  h.log('vault out B: the file is back in the Vault');
  await openVault();
  await rowIn(BAD).waitFor({ timeout: 5000 });
  assert.equal(await rowIn(BAD).count(), 1, 'B: the failed file is back in the Vault list');
  await rowIn(BAD).locator('[data-vault-state="encrypted"]').waitFor();
  await h.shot(page, '16c-vault-out-failed-back-in-vault');
  mock.slowVaultOut = 0;
  await page.setViewportSize({ width: 1180, height: 760 });
}

/**
 * Timing and failure switches for the mock. slowVaultComplete holds each vault/in/complete for 8 s, so a move stays pending while the
 * Vault is opened. failVaultComplete is set by the area at run time (it is the same object the mock reads). slowVaultOut holds each
 * vault/out and vault/out/complete (set to 4 s by the move-out steps); failVaultOut makes the next of those two answer 500 (one-shot).
 */
export const mock = { slowVaultComplete: 8000, failVaultComplete: 0, slowVaultOut: 0, failVaultOut: 0 };

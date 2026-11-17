// E2E area "vault": the encrypted Vault end to end: setup wizard with the recovery key, upload into the Vault, delete to its trash
// (Undo toast), the trash panel (sidebar at 1280 px, full screen at 400 px), restore, close, and unlock with a wrong PIN twice, then the right one.
// Last: move a seeded file into the Vault from the main list (the PIN prompt comes first and the list stays in view), then check it inside.
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
  const { app, page } = await h.launchReady();
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

  h.log('vault: gate, wrong PIN twice');
  await page.getByRole('button', { name: 'Két sắt', exact: true }).first().click();
  await page.locator('.vaultscreen .pin__input').waitFor();
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

  h.log('vault: move a seeded file in from the main list');
  // The Vault is closed now (the back button left it). Moving in asks for the PIN first; the list stays behind the prompt.
  const SEEDED = 'Đà Lạt trip.jpg';
  const seeded = page.locator('.list__row', { hasText: SEEDED });
  const gate = page.locator('.vaultscreen');
  await seeded.waitFor();
  await seeded.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Chuyển vào Két sắt' }).click();
  await gate.locator('.pin__input').waitFor();
  await page.getByText('Nhập PIN két sắt để cất các file này vào két.', { exact: true }).waitFor();
  assert.equal(await page.locator('.app.vault-mode').count(), 0, 'the PIN prompt does not open the Vault view');
  await page.waitForTimeout(800); // let the gate's entrance animation settle before the screenshot
  await h.shot(page, '13g-vault-move-unlock-prompt');
  await typePin(page, PIN);

  h.log('vault: the file leaves the list and the Vault closes again');
  await gate.waitFor({ state: 'detached', timeout: 20_000 });
  await seeded.waitFor({ state: 'detached', timeout: 30_000 });
  assert.equal(await page.locator('.app.vault-mode').count(), 0, 'the user stays on the main list');
  assert.equal(await page.locator('.app:not(.vault-mode)').count(), 1, 'the main list is still shown');

  h.log('vault: the file is inside the Vault');
  await page.getByRole('button', { name: 'Két sắt', exact: true }).first().click();
  await gate.locator('.pin__input').waitFor();
  await typePin(page, PIN);
  await page.locator('.app.vault-mode').waitFor({ timeout: 20_000 });
  await page.locator('.list__row', { hasText: SEEDED }).waitFor();
  assert.equal(await page.locator('.list__row', { hasText: SEEDED }).count(), 1, 'the seeded file is listed inside the Vault');
  await h.shot(page, '13h-vault-contains-moved');
}

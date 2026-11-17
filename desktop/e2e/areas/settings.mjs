// E2E area "settings": Settings: Android pairing QR behind the PIN; dark mode screens.
// Run alone: npm run e2e -- settings   (see ../smoke.mjs)
import { kind, showAll, typePin } from '../harness.mjs';

/** @param {Awaited<ReturnType<typeof import('../harness.mjs').createHarness>>} h */
export async function run(h) {
  const { page } = await h.launchReady();
  h.log('settings + QR');
  await page.getByRole('button', { name: 'Cài đặt' }).click();
  await page.getByRole('button', { name: 'Kết nối Android' }).click();
  await typePin(page, '9999');
  await page.getByText('Sai PIN. Còn 4 lần thử.').waitFor();
  await typePin(page, '1234');
  await page.locator('img.qr').waitFor();
  await h.shot(page, '06-settings-qr');
  await page.keyboard.press('Escape');

  h.log('dark mode');
  await page.emulateMedia({ colorScheme: 'dark' });
  h.log('dark mode: screens');
  await kind(page, 'Ảnh').click();
  await page.waitForTimeout(300);
  await h.shot(page, '07-images-grid-dark');
  await showAll(page);
  await page.waitForTimeout(200);
  await h.shot(page, '08-all-list-dark');
}

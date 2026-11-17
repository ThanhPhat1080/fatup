// E2E area "setup": First run (wrong token, then the right one; create the PIN), then a restart in English on the lock screen.
// Run alone: npm run e2e -- setup   (see ../smoke.mjs)
import { TOKEN, typePin } from '../harness.mjs';

/** @param {Awaited<ReturnType<typeof import('../harness.mjs').createHarness>>} h */
export async function run(h) {
  let { app, page } = await h.launch();
  h.log('setup');
  await page.getByText('Kết nối tới server FatUp').waitFor();
  await page.getByLabel('URL server').fill(h.url);
  await page.getByLabel('API token').fill('wrong');
  await page.getByRole('button', { name: 'Tiếp' }).click();
  await page.getByText('Token bị từ chối.').waitFor();
  await page.getByLabel('API token').fill(TOKEN);
  await h.shot(page, '01-setup');
  await page.getByRole('button', { name: 'Tiếp' }).click();

  h.log('create pin');
  await page.getByText('Tạo mã PIN 4 số').waitFor();
  await typePin(page, '1234');
  await page.getByText('Nhập lại PIN').waitFor();
  await typePin(page, '1234');

  h.log('main list');
  await page.getByText('Báo cáo tháng 11.pdf', { exact: true }).waitFor();
  await page.getByText('Hôm nay').first().waitFor();
  await page.getByText('Hôm qua').first().waitFor();
  h.log('close app (1st run)');
  await h.closeApp(app);

  h.log('lock screen');
  ({ app, page } = await h.launch('en'));
  await page.getByLabel('Enter your PIN').waitFor(); // the PIN field is labelled for screen readers; the Moria scene has no visible caption
  await typePin(page, '0000');
  await page.getByText('Wrong PIN. 4 tries left.').waitFor();
  await h.shot(page, '09-lock-en');

  await typePin(page, '1234');
  await page.getByText('Today').first().waitFor();
  h.log('close app (2nd run)');
  await h.closeApp(app);
}

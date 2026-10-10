import { test, expect, addMergeFiles, createPdf, loadSplitFile, mergeItems, pdfFile, splitThumbs } from './helpers.mjs';

const horizontalOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('schmaler Bildschirm (360 px)', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('kein horizontales Scrollen in beiden Tabs', async ({ page }) => {
    await page.goto('/');
    await addMergeFiles(page, [
      pdfFile('ein-ziemlich-langer-dateiname-ohne-leerzeichen-fuer-den-test.pdf', await createPdf(2)),
      pdfFile('kurz.pdf', await createPdf(1)),
    ]);
    await expect(mergeItems(page)).toHaveCount(2);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    await loadSplitFile(page, pdfFile('bericht.pdf', await createPdf(6, { baseWidth: 500 })));
    await expect(splitThumbs(page)).toHaveCount(6);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test('heller und dunkler Modus folgen der Systemeinstellung', async ({ page }) => {
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const light = await background();

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(background).not.toBe(light);
});

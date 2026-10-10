import {
  test,
  expect,
  addMergeFiles,
  captureDownload,
  createPdf,
  loadSplitFile,
  mergeItems,
  pdfFile,
  splitThumbs,
} from './helpers.mjs';

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

  test('Seitenbereichsfeld mit 16 px (kein Zoom in iOS Safari)', async ({ page }) => {
    await page.goto('/');
    await addMergeFiles(page, [pdfFile('a.pdf', await createPdf(2))]);
    const range = mergeItems(page).first().locator('.merge-item-range');
    expect(await range.evaluate((input) => getComputedStyle(input).fontSize)).toBe('16px');
  });

  test('lange Ergebnisnamen werden umbrochen statt abgeschnitten', async ({ page }) => {
    await page.goto('/');
    await loadSplitFile(page, pdfFile('Jahresabschluss 2025 Konzern.pdf', await createPdf(9, { baseWidth: 500 })));
    await page.locator('#split-ranges').fill('1-3, 4-6, 7-9');
    await captureDownload(page, () => page.locator('#split-run').click());

    const names = page.locator('#split-results .download-name');
    await expect(names).toHaveText([
      'Jahresabschluss 2025 Konzern_S1-3.pdf',
      'Jahresabschluss 2025 Konzern_S4-6.pdf',
      'Jahresabschluss 2025 Konzern_S7-9.pdf',
    ]);
    const clipped = await names.evaluateAll((elements) =>
      elements.filter((element) => element.scrollWidth > element.clientWidth).map((element) => element.textContent),
    );
    expect(clipped, 'abgeschnittene Dateinamen').toEqual([]);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test('ungenutzte Seiten sind abgeblendet, ihre Seitenzahl bleibt gut lesbar', async ({ page }) => {
  await page.goto('/');
  await loadSplitFile(page, pdfFile('bericht.pdf', await createPdf(4, { baseWidth: 500 })));
  await page.locator('#split-ranges').fill('1');
  const unused = page.locator('#split-thumbnails .page-thumb[data-page="3"]');
  await expect(unused).toHaveClass(/is-unused/);
  const opacities = () =>
    unused.evaluate((button) => ({
      button: getComputedStyle(button).opacity,
      label: getComputedStyle(button.querySelector('.page-thumb-label')).opacity,
      frame: getComputedStyle(button.querySelector('.page-thumb-frame')).opacity,
    }));
  await expect.poll(opacities).toEqual({ button: '1', label: '1', frame: '0.4' });
});

test('heller und dunkler Modus folgen der Systemeinstellung', async ({ page }) => {
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const light = await background();

  await page.emulateMedia({ colorScheme: 'dark' });
  await expect.poll(background).not.toBe(light);
});

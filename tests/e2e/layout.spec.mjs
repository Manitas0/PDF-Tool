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

// Names that differ only at the end: both must be readable in full.
const SIMILAR_NAMES = ['Arbeitszeugnis_Firma_Schmidt_2019.pdf', 'Arbeitszeugnis_Firma_Schmidt_2021.pdf'];

/** Texts of the merge list names that are cut off. */
const clippedMergeNames = (page) =>
  page
    .locator('#merge-list .merge-item-name')
    .evaluateAll((elements) =>
      elements.filter((element) => element.scrollWidth > element.clientWidth).map((element) => element.textContent),
    );

let PDF_2;
let PDF_9;

test.beforeAll(async () => {
  PDF_2 = await createPdf(2);
  PDF_9 = await createPdf(9);
});

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

  test('lange, ähnliche Dateinamen in der Liste werden umbrochen statt abgeschnitten', async ({ page }) => {
    await page.goto('/');
    await addMergeFiles(page, SIMILAR_NAMES.map((name) => pdfFile(name, PDF_2)));
    await expect(mergeItems(page)).toHaveCount(2);
    await expect(page.locator('#merge-list .merge-item-name')).toHaveText(SIMILAR_NAMES);
    expect(await clippedMergeNames(page), 'abgeschnittene Dateinamen').toEqual([]);
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

test('eine lange Fehlermeldung verschiebt das Seitenfeld nicht und kürzt den Dateinamen nicht', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await addMergeFiles(page, SIMILAR_NAMES.map((name) => pdfFile(name, PDF_9)));
  await expect(mergeItems(page)).toHaveCount(2);
  const item = mergeItems(page).first();
  const range = item.locator('.merge-item-range');

  await range.fill('1-3, 7');
  await expect(item.locator('.merge-item-error')).toHaveCount(0);
  const before = await range.boundingBox();

  await range.fill('1-3, 7 bis'); // a long message (invalid input)
  await expect(item.locator('.merge-item-error')).toBeVisible();
  const after = await range.boundingBox();
  expect(Math.round(after.x)).toBe(Math.round(before.x));
  expect(Math.round(after.width)).toBe(Math.round(before.width));
  expect(await clippedMergeNames(page), 'abgeschnittene Dateinamen').toEqual([]);
  // The message wraps inside the row instead of widening it.
  const row = await item.boundingBox();
  const error = await item.locator('.merge-item-error').boundingBox();
  expect(error.x + error.width).toBeLessThanOrEqual(row.x + row.width + 0.5);
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
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

// The app must also work when index.html is opened directly from disk
// (file://), e.g. by double-clicking it – no server involved.
import {
  test,
  expect,
  INDEX_FILE_URL,
  addMergeFiles,
  captureDownload,
  createPdf,
  downloadBytes,
  expectIdle,
  loadSplitFile,
  mergeItems,
  pdfFile,
  readPageWidths,
  readZip,
} from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await page.goto(INDEX_FILE_URL);
  expect(page.url()).toMatch(/^file:\/\//);
});

test('Zusammenführen funktioniert über file:// inklusive Vorschaubild', async ({ page }) => {
  await addMergeFiles(page, [
    pdfFile('eins.pdf', await createPdf(2, { baseWidth: 100 })),
    pdfFile('zwei.pdf', await createPdf(3, { baseWidth: 200 })),
  ]);
  await expect(mergeItems(page)).toHaveCount(2);
  // pdf.js has to work without a server as well (fake worker on file://).
  await expect(page.locator('#merge-list .merge-item-thumb canvas')).toHaveCount(2);

  await mergeItems(page).nth(1).locator('.merge-item-up').click();
  const download = await captureDownload(page, () => page.locator('#merge-run').click());
  expect(download.suggestedFilename()).toBe('zusammengefuehrt.pdf');
  expect(await readPageWidths(await downloadBytes(download))).toEqual([200, 201, 202, 100, 101]);
  await expect(page.locator('#merge-download')).toHaveAttribute('href', /^blob:/);
  await expectIdle(page);
});

test('Teilen als ZIP funktioniert über file://', async ({ page }) => {
  await loadSplitFile(page, pdfFile('handbuch.pdf', await createPdf(4, { baseWidth: 300 })));
  await expect(page.locator('#split-thumbnails .page-thumb[data-page="1"] canvas')).toHaveCount(1);

  await page.locator('#split-ranges').fill('1-2, 4-3');
  const download = await captureDownload(page, () => page.locator('#split-run').click());
  expect(download.suggestedFilename()).toBe('handbuch_geteilt.zip');
  const zip = await readZip(await downloadBytes(download));
  expect(zip.names).toEqual(['handbuch_S1-2.pdf', 'handbuch_S4-3.pdf']);
  expect(await readPageWidths(zip.files.get('handbuch_S4-3.pdf'))).toEqual([303, 302]);
});

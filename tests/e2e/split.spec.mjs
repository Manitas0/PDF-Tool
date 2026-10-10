import {
  test,
  expect,
  captureDownload,
  createPdf,
  downloadBytes,
  expandPageList,
  expectIdle,
  loadSplitFile,
  pdfFile,
  readPageWidths,
  readZip,
  selectSplitMode,
  splitThumbs,
} from './helpers.mjs';

// bericht.pdf: 10 pages, page n has width 499 + n (500 … 509 pt)
let report;
const width = (pageNumber) => 499 + pageNumber;
const widths = (...pageNumbers) => pageNumbers.map(width);

test.beforeAll(async () => {
  report = pdfFile('bericht.pdf', await createPdf(10, { baseWidth: 500, label: 'Bericht' }));
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await loadSplitFile(page, report);
});

const preview = (page) => page.locator('#split-preview');
const runButton = (page) => page.locator('#split-run');
const resultLinks = (page) => page.locator('#split-results a.split-download');

test('zeigt Dateiinfo, Seitenvorschau und lässt sich zurücksetzen', async ({ page }) => {
  const info = page.locator('#split-file-info');
  await expect(info).toContainText('bericht.pdf');
  await expect(info).toContainText('10 Seiten');

  await expect(splitThumbs(page)).toHaveCount(10);
  const pageNumbers = await splitThumbs(page).evaluateAll((thumbs) => thumbs.map((thumb) => thumb.dataset.page));
  expect(pageNumbers).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  // The first thumbnail is in view, so pdf.js renders it.
  await expect(page.locator('#split-thumbnails .page-thumb[data-page="1"] canvas')).toHaveCount(1);

  // Defaults: mode "ranges", ZIP on, nothing entered yet -> button disabled
  await expect(page.locator('input[name="split-mode"][value="ranges"]')).toBeChecked();
  await expect(page.locator('#split-ranges')).toBeVisible();
  await expect(page.locator('#split-ranges')).toHaveAttribute('placeholder', 'z. B. 1-3, 4-6, 7-');
  await expect(page.locator('#split-chunk-size')).toBeHidden();
  await expect(page.locator('#split-extract')).toBeHidden();
  await expect(page.locator('#split-zip')).toBeChecked();
  await expect(runButton(page)).toBeDisabled();

  await page.locator('#split-reset').click();
  await expect(info).toBeHidden();
  await expect(splitThumbs(page)).toHaveCount(0);
  await expect(runButton(page)).toBeDisabled();
});

test('nur das Eingabefeld des aktiven Modus ist sichtbar', async ({ page }) => {
  const inputs = {
    chunk: page.locator('#split-chunk-size'),
    ranges: page.locator('#split-ranges'),
    extract: page.locator('#split-extract'),
  };
  const zip = page.locator('#split-zip');
  for (const mode of ['single', 'chunk', 'ranges', 'extract', 'ranges']) {
    await selectSplitMode(page, mode);
    // Extract mode always produces one PDF, so the ZIP option only exists in the other modes.
    if (mode === 'extract') await expect(zip).toBeHidden();
    else await expect(zip).toBeVisible();
    for (const [inputMode, input] of Object.entries(inputs)) {
      if (inputMode === mode) {
        await expect(input).toBeVisible();
        await expect(input).toBeEnabled();
      } else {
        await expect(input).toBeHidden();
      }
    }
  }
});

test('Seitenbereiche (auch absteigend) als ZIP-Archiv', async ({ page }) => {
  await page.locator('#split-ranges').fill('1-3, 7-, 5-3');
  await expect(preview(page)).toContainText('3 Dateien');
  await expect(preview(page)).not.toHaveClass(/is-error/);
  await expect(runButton(page)).toBeEnabled();

  const download = await captureDownload(page, () => runButton(page).click());
  expect(download.suggestedFilename()).toBe('bericht_geteilt.zip');
  const zip = await readZip(await downloadBytes(download));
  expect(zip.names).toEqual(['bericht_S1-3.pdf', 'bericht_S5-3.pdf', 'bericht_S7-10.pdf']);
  expect(await readPageWidths(zip.files.get('bericht_S1-3.pdf'))).toEqual(widths(1, 2, 3));
  expect(await readPageWidths(zip.files.get('bericht_S7-10.pdf'))).toEqual(widths(7, 8, 9, 10));
  expect(await readPageWidths(zip.files.get('bericht_S5-3.pdf'))).toEqual(widths(5, 4, 3));

  // Individual links are offered in addition to the ZIP.
  await expect(resultLinks(page)).toHaveCount(3);
  const names = await resultLinks(page).evaluateAll((links) => links.map((link) => link.getAttribute('download')));
  expect(names).toEqual(['bericht_S1-3.pdf', 'bericht_S7-10.pdf', 'bericht_S5-3.pdf']);
  await expect(page.locator('#split-results a#split-zip-download')).toHaveAttribute('download', 'bericht_geteilt.zip');

  const single = await captureDownload(page, () => resultLinks(page).nth(2).click());
  expect(single.suggestedFilename()).toBe('bericht_S5-3.pdf');
  expect(await readPageWidths(await downloadBytes(single))).toEqual(widths(5, 4, 3));
  await expectIdle(page);

  // Choosing another file discards the previous results.
  await page.locator('#split-reset').click();
  await expect(resultLinks(page)).toHaveCount(0);
  await expect(page.locator('#split-zip-download')).toHaveCount(0);
});

test('jede Seite einzeln ohne ZIP: nur Links, kein automatischer Download', async ({ page }) => {
  await selectSplitMode(page, 'single');
  await page.locator('#split-zip').uncheck();
  await expect(preview(page)).toContainText('10 Dateien');

  let downloads = 0;
  page.on('download', () => {
    downloads += 1;
  });
  await runButton(page).click();
  await expect(resultLinks(page)).toHaveCount(10);
  await expectIdle(page);

  const names = await resultLinks(page).evaluateAll((links) => links.map((link) => link.getAttribute('download')));
  expect(names).toEqual(Array.from({ length: 10 }, (_, i) => `bericht_S${i + 1}.pdf`));
  await expect(page.locator('#split-zip-download')).toHaveCount(0);
  // Give a (wrongly) triggered automatic download a moment to show up.
  await page.waitForTimeout(500);
  expect(downloads, 'mehrere Einzeldateien dürfen nicht automatisch heruntergeladen werden').toBe(0);

  const fourth = await captureDownload(page, () => resultLinks(page).nth(3).click());
  expect(fourth.suggestedFilename()).toBe('bericht_S4.pdf');
  expect(await readPageWidths(await downloadBytes(fourth))).toEqual(widths(4));
});

test('alle N Seiten als ZIP-Archiv', async ({ page }) => {
  await selectSplitMode(page, 'chunk');
  await expect(page.locator('#split-chunk-size')).toHaveValue('2');
  await expect(preview(page)).toContainText('5 Dateien');

  await page.locator('#split-chunk-size').fill('3');
  await expect(preview(page)).toContainText('4 Dateien');

  const download = await captureDownload(page, () => runButton(page).click());
  expect(download.suggestedFilename()).toBe('bericht_geteilt.zip');
  const zip = await readZip(await downloadBytes(download));
  expect(zip.names).toEqual(['bericht_S1-3.pdf', 'bericht_S10.pdf', 'bericht_S4-6.pdf', 'bericht_S7-9.pdf']);
  expect(await readPageWidths(zip.files.get('bericht_S1-3.pdf'))).toEqual(widths(1, 2, 3));
  expect(await readPageWidths(zip.files.get('bericht_S4-6.pdf'))).toEqual(widths(4, 5, 6));
  expect(await readPageWidths(zip.files.get('bericht_S7-9.pdf'))).toEqual(widths(7, 8, 9));
  expect(await readPageWidths(zip.files.get('bericht_S10.pdf'))).toEqual(widths(10));
  await expect(resultLinks(page)).toHaveCount(4);
});

test('Seiten auswählen: Vorschau und Eingabefeld bleiben synchron, Ergebnis ist eine PDF', async ({ page }) => {
  await selectSplitMode(page, 'extract');
  const extract = page.locator('#split-extract');
  await expect(extract).toHaveAttribute('placeholder', 'z. B. 1, 3, 5-7');
  const thumb = (pageNumber) => page.locator(`#split-thumbnails .page-thumb[data-page="${pageNumber}"]`);
  const pressedPages = () =>
    splitThumbs(page).evaluateAll((thumbs) =>
      thumbs.filter((t) => t.getAttribute('aria-pressed') === 'true').map((t) => Number(t.dataset.page)),
    );

  // Typing updates the selection …
  await extract.fill('2, 5-6');
  await expect.poll(pressedPages).toEqual([2, 5, 6]);
  await expect(thumb(1)).toHaveAttribute('aria-pressed', 'false');

  // … and clicking thumbnails updates the input.
  await thumb(9).click();
  await expect(thumb(9)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => expandPageList(await extract.inputValue())).toEqual([2, 5, 6, 9]);
  await thumb(5).click();
  await expect(thumb(5)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => expandPageList(await extract.inputValue())).toEqual([2, 6, 9]);
  await thumb(5).click();
  await expect.poll(async () => expandPageList(await extract.inputValue())).toEqual([2, 5, 6, 9]);
  await expect(preview(page)).not.toHaveClass(/is-error/);

  // The result is always a single PDF, so the ZIP option is hidden in this mode.
  await expect(page.locator('#split-zip')).toBeHidden();
  const download = await captureDownload(page, () => runButton(page).click());
  expect(download.suggestedFilename()).toBe('bericht_Auszug_S2_5-6_9.pdf');
  expect(await readPageWidths(await downloadBytes(download))).toEqual(widths(2, 5, 6, 9));
  await expect(resultLinks(page)).toHaveCount(1);
  await expect(resultLinks(page)).toHaveAttribute('download', 'bericht_Auszug_S2_5-6_9.pdf');
  await expect(page.locator('#split-zip-download')).toHaveCount(0);
});

test('Umlaute im Dateinamen bleiben in den Ergebnisnamen erhalten', async ({ page }) => {
  await page.locator('#split-reset').click();
  await loadSplitFile(page, pdfFile('Übersicht März.pdf', await createPdf(4, { baseWidth: 600 })));
  await expect(page.locator('#split-file-info')).toContainText('Übersicht März.pdf');
  await expect(splitThumbs(page)).toHaveCount(4);

  await page.locator('#split-ranges').fill('3-4, 1');
  const download = await captureDownload(page, () => runButton(page).click());
  expect(download.suggestedFilename()).toBe('Übersicht März_geteilt.zip');
  const zip = await readZip(await downloadBytes(download));
  expect(zip.names).toEqual(['Übersicht März_S1.pdf', 'Übersicht März_S3-4.pdf']);
  expect(await readPageWidths(zip.files.get('Übersicht März_S3-4.pdf'))).toEqual([602, 603]);
});

test('ungültige Eingaben zeigen einen Fehler und sperren den Button', async ({ page }) => {
  const ranges = page.locator('#split-ranges');

  await ranges.fill('1-3, 12');
  await expect(preview(page)).toHaveClass(/is-error/);
  await expect(preview(page)).toContainText('Seite 12');
  await expect(preview(page)).toContainText('10 Seiten');
  await expect(runButton(page)).toBeDisabled();

  await ranges.fill('1-3, x');
  await expect(preview(page)).toHaveClass(/is-error/);
  await expect(runButton(page)).toBeDisabled();

  await ranges.fill('1-3');
  await expect(preview(page)).not.toHaveClass(/is-error/);
  await expect(preview(page)).toContainText(/(^|\D)1 Datei(?!en)/);
  await expect(runButton(page)).toBeEnabled();

  await selectSplitMode(page, 'chunk');
  await page.locator('#split-chunk-size').fill('0');
  await expect(preview(page)).toHaveClass(/is-error/);
  await expect(runButton(page)).toBeDisabled();

  await selectSplitMode(page, 'extract');
  await page.locator('#split-extract').fill('3, 11');
  await expect(preview(page)).toHaveClass(/is-error/);
  await expect(runButton(page)).toBeDisabled();
});

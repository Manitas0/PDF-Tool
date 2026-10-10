import {
  test,
  expect,
  ONE_PAGE,
  addMergeFiles,
  captureDownload,
  createBrokenPdf,
  createEncryptedPdf,
  createPdf,
  downloadBytes,
  dropFiles,
  expectIdle,
  mergeItems,
  pdfFile,
  readPageWidths,
  textFile,
} from './helpers.mjs';

// a.pdf: 3 pages (100–102 pt), b.pdf: 5 pages (200–204 pt), c.pdf: 1 page (300 pt)
let fileA;
let fileB;
let fileC;

test.beforeAll(async () => {
  fileA = pdfFile('a.pdf', await createPdf(3, { baseWidth: 100, label: 'A' }));
  fileB = pdfFile('b.pdf', await createPdf(5, { baseWidth: 200, label: 'B' }));
  fileC = pdfFile('c.pdf', await createPdf(1, { baseWidth: 300, label: 'C' }));
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const itemNames = (page) => page.locator('#merge-list li.merge-item .merge-item-name');

test('Startzustand: Zusammenführen-Tab aktiv, Button gesperrt', async ({ page }) => {
  await expect(page).toHaveTitle(/PDF-Tool/);
  await expect(page.locator('#tab-merge')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#panel-merge')).toBeVisible();
  await expect(page.locator('#panel-split')).toBeHidden();
  await expect(mergeItems(page)).toHaveCount(0);
  await expect(page.locator('#merge-filename')).toHaveValue('zusammengefuehrt.pdf');
  await expect(page.locator('#merge-run')).toBeDisabled();
  await expect(page.locator('#busy')).toBeHidden();
});

test('führt drei PDFs in geänderter Reihenfolge mit Seitenauswahl und eigenem Dateinamen zusammen', async ({ page }) => {
  await addMergeFiles(page, [fileA, fileB, fileC]);
  await expect(mergeItems(page)).toHaveCount(3);
  await expect(itemNames(page)).toHaveText(['a.pdf', 'b.pdf', 'c.pdf']);

  const items = mergeItems(page);
  await expect(items.nth(0).locator('.merge-item-pages')).toContainText('3 Seiten');
  await expect(items.nth(1).locator('.merge-item-pages')).toContainText('5 Seiten');
  await expect(items.nth(2).locator('.merge-item-pages')).toContainText(ONE_PAGE);
  await expect(items.nth(0).locator('.merge-item-range')).toHaveAttribute('placeholder', 'alle Seiten');
  await expect(items.nth(2).locator('.merge-item-remove')).toHaveAttribute('aria-label', /c\.pdf/);
  await expect(page.locator('#merge-summary')).toContainText('3 Dateien');
  await expect(page.locator('#merge-summary')).toContainText('9 Seiten');
  await expect(page.locator('#merge-run')).toBeEnabled();

  // Reorder with the buttons: [a, b, c] -> [a, c, b] -> [c, a, b]
  await items.nth(2).locator('.merge-item-up').click();
  await expect(itemNames(page)).toHaveText(['a.pdf', 'c.pdf', 'b.pdf']);
  await items.nth(0).locator('.merge-item-down').click();
  await expect(itemNames(page)).toHaveText(['c.pdf', 'a.pdf', 'b.pdf']);

  // Only pages 4, 5 and 1 of b.pdf (in this order)
  const rangeB = mergeItems(page).nth(2).locator('.merge-item-range');
  await rangeB.fill('4-5, 1');
  await expect(rangeB).not.toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#merge-summary')).toContainText('7 Seiten');

  await page.locator('#merge-filename').fill('Quartalsbericht 2026.pdf');

  const download = await captureDownload(page, () => page.locator('#merge-run').click());
  expect(download.suggestedFilename()).toBe('Quartalsbericht 2026.pdf');
  expect(await readPageWidths(await downloadBytes(download))).toEqual([300, 100, 101, 102, 203, 204, 200]);

  const link = page.locator('#merge-result a#merge-download');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('download', 'Quartalsbericht 2026.pdf');
  await expect(link).toHaveAttribute('href', /^blob:/);
  await expectIdle(page);
  await expect(page.locator('#status')).not.toHaveClass(/is-error/);
});

test('dieselbe Datei lässt sich mehrfach hinzufügen, Einträge lassen sich entfernen', async ({ page }) => {
  await addMergeFiles(page, [fileA]);
  await expect(mergeItems(page)).toHaveCount(1);
  await addMergeFiles(page, [fileA]);
  await expect(mergeItems(page)).toHaveCount(2);
  await expect(itemNames(page)).toHaveText(['a.pdf', 'a.pdf']);
  await expect(page.locator('#merge-summary')).toContainText('2 Dateien');
  await expect(page.locator('#merge-summary')).toContainText('6 Seiten');

  await addMergeFiles(page, [fileC]);
  await expect(itemNames(page)).toHaveText(['a.pdf', 'a.pdf', 'c.pdf']);
  await mergeItems(page).nth(1).locator('.merge-item-remove').click();
  await expect(itemNames(page)).toHaveText(['a.pdf', 'c.pdf']);

  await mergeItems(page).nth(0).locator('.merge-item-range').fill('2');
  await page.locator('#merge-filename').fill('ohne-endung');
  const download = await captureDownload(page, () => page.locator('#merge-run').click());
  expect(download.suggestedFilename()).toBe('ohne-endung.pdf');
  expect(await readPageWidths(await downloadBytes(download))).toEqual([101, 300]);

  await page.locator('#merge-clear').click();
  await expect(mergeItems(page)).toHaveCount(0);
  await expect(page.locator('#merge-run')).toBeDisabled();
});

test('Umlaute im Dateinamen bleiben erhalten, verbotene Zeichen werden entfernt', async ({ page }) => {
  await addMergeFiles(page, [pdfFile('Prüfbericht.pdf', await createPdf(2, { baseWidth: 800 }))]);
  await expect(itemNames(page)).toHaveText(['Prüfbericht.pdf']);

  await page.locator('#merge-filename').fill('Größe: Übersicht?.pdf');
  const download = await captureDownload(page, () => page.locator('#merge-run').click());
  expect(download.suggestedFilename()).toBe('Größe Übersicht.pdf');
  expect(await readPageWidths(await downloadBytes(download))).toEqual([800, 801]);
  await expect(page.locator('#merge-download')).toHaveAttribute('download', 'Größe Übersicht.pdf');
});

test('sortiert nach Dateiname (natürliche Sortierung)', async ({ page }) => {
  await addMergeFiles(page, [
    pdfFile('Teil 10.pdf', await createPdf(1, { baseWidth: 410 })),
    pdfFile('Teil 2.pdf', await createPdf(1, { baseWidth: 402 })),
    pdfFile('Anhang.pdf', await createPdf(1, { baseWidth: 400 })),
    pdfFile('Teil 1.pdf', await createPdf(1, { baseWidth: 401 })),
  ]);
  await expect(mergeItems(page)).toHaveCount(4);

  await page.locator('#merge-sort').click();
  await expect(itemNames(page)).toHaveText(['Anhang.pdf', 'Teil 1.pdf', 'Teil 2.pdf', 'Teil 10.pdf']);

  const download = await captureDownload(page, () => page.locator('#merge-run').click());
  expect(download.suggestedFilename()).toBe('zusammengefuehrt.pdf');
  expect(await readPageWidths(await downloadBytes(download))).toEqual([400, 401, 402, 410]);
});

test('ungültiger Seitenbereich markiert das Feld und sperrt den Button', async ({ page }) => {
  await addMergeFiles(page, [fileA]);
  const item = mergeItems(page).first();
  const range = item.locator('.merge-item-range');
  const run = page.locator('#merge-run');
  await expect(run).toBeEnabled();

  await range.fill('2-5');
  await expect(range).toHaveAttribute('aria-invalid', 'true');
  await expect(item.locator('.merge-item-error')).toBeVisible();
  await expect(item.locator('.merge-item-error')).toContainText('5');
  await expect(run).toBeDisabled();

  await range.fill('1, x');
  await expect(range).toHaveAttribute('aria-invalid', 'true');
  await expect(run).toBeDisabled();

  // Descending range is valid
  await range.fill('3-1');
  await expect(range).not.toHaveAttribute('aria-invalid', 'true');
  await expect(item.locator('.merge-item-error')).toBeHidden();
  await expect(run).toBeEnabled();

  const download = await captureDownload(page, () => run.click());
  expect(await readPageWidths(await downloadBytes(download))).toEqual([102, 101, 100]);
});

test('lehnt Nicht-PDFs, verschlüsselte und defekte Dateien mit Meldung ab', async ({ page }) => {
  const status = page.locator('#status');

  // A non-PDF in the same batch must not prevent the valid file from being added.
  await addMergeFiles(page, [textFile('notizen.txt', 'Hallo Welt'), fileA]);
  await expect(mergeItems(page)).toHaveCount(1);
  await expect(itemNames(page)).toHaveText(['a.pdf']);
  await expect(status).toHaveClass(/is-error/);
  await expect(status).toContainText('notizen.txt');

  await addMergeFiles(page, [pdfFile('geheim.pdf', await createEncryptedPdf())]);
  await expect(status).toContainText('geheim.pdf');
  await expect(status).toContainText(/verschlüsselt|passwortgeschützt/i);
  await expect(status).toHaveClass(/is-error/);

  await addMergeFiles(page, [pdfFile('kaputt.pdf', createBrokenPdf())]);
  await expect(status).toContainText('kaputt.pdf');
  await expect(status).toHaveClass(/is-error/);

  await expect(mergeItems(page)).toHaveCount(1);
  await expect(page.locator('#merge-run')).toBeEnabled();
  await expectIdle(page);
});

test('Dateien per Drag & Drop hinzufügen; Drop außerhalb navigiert nicht weg', async ({ page }) => {
  const prevented = await dropFiles(page, '#merge-dropzone', [pdfFile('gezogen.pdf', await createPdf(2, { baseWidth: 600 }))]);
  expect(prevented.drop).toBe(true);
  await expect(itemNames(page)).toHaveText(['gezogen.pdf']);
  await expect(mergeItems(page).first().locator('.merge-item-pages')).toContainText('2 Seiten');

  const url = page.url();
  const outside = await dropFiles(page, 'body', [pdfFile('daneben.pdf', await createPdf(1, { baseWidth: 700 }))]);
  expect(outside.dragover, 'dragover außerhalb der Dropzone muss abgefangen werden').toBe(true);
  expect(outside.drop, 'drop außerhalb der Dropzone muss abgefangen werden').toBe(true);
  expect(page.url()).toBe(url);
});

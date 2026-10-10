// Keyboard focus and screen-reader announcements around the long-running actions and the
// inputs that are validated while typing.
import {
  test,
  expect,
  addMergeFiles,
  captureDownload,
  createPdf,
  expectIdle,
  loadSplitFile,
  mergeItems,
  pdfFile,
  splitThumbs,
} from './helpers.mjs';

const announcer = (page) => page.locator('#sr-announcer');

/** Records every text that #sr-announcer shows from now on. */
async function recordAnnouncements(page) {
  await page.evaluate(() => {
    const region = document.getElementById('sr-announcer');
    window.__announcements = [];
    new MutationObserver(() => window.__announcements.push(region.textContent)).observe(region, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  return () => page.evaluate(() => window.__announcements);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test.describe('der Fokus geht nach einer Aktion nicht verloren', () => {
  test('nach dem Zusammenführen liegt er auf dem Download', async ({ page }) => {
    await addMergeFiles(page, [pdfFile('a.pdf', await createPdf(2)), pdfFile('b.pdf', await createPdf(1, { baseWidth: 200 }))]);
    await expect(mergeItems(page)).toHaveCount(2);
    await expectIdle(page);

    await page.locator('#merge-run').focus();
    await captureDownload(page, () => page.keyboard.press('Enter'));
    await expect(page.locator('#merge-download')).toBeFocused();
  });

  test('nach dem Laden zum Teilen liegt er auf „Andere Datei wählen“', async ({ page }) => {
    await page.locator('#tab-split').click();
    const input = page.locator('#split-input');
    await input.focus();
    await input.setInputFiles(pdfFile('bericht.pdf', await createPdf(6, { baseWidth: 500 })));
    await expect(page.locator('#split-file-info')).toBeVisible();
    await expect(page.locator('#split-reset')).toBeFocused();
  });

  test('nach dem Teilen liegt er auf dem ZIP-Download', async ({ page }) => {
    await loadSplitFile(page, pdfFile('bericht.pdf', await createPdf(6, { baseWidth: 500 })));
    await page.locator('#split-ranges').fill('1-3, 4-6');
    await page.locator('#split-run').focus();
    await captureDownload(page, () => page.keyboard.press('Enter'));
    await expect(page.locator('#split-zip-download')).toBeFocused();
  });
});

test.describe('Ansagen für Screenreader', () => {
  test('ein ungültiger Seitenbereich wird einmal angesagt, wenn die Eingabe ruht', async ({ page }) => {
    await expect(announcer(page)).toHaveText('');
    await addMergeFiles(page, [pdfFile('a.pdf', await createPdf(3))]);
    await expect(mergeItems(page)).toHaveCount(1);
    await expectIdle(page);

    const announcements = await recordAnnouncements(page);
    const range = mergeItems(page).first().locator('.merge-item-range');
    await range.pressSequentially('1-9', { delay: 30 });
    const message = 'Seite 9 gibt es nicht – das Dokument hat nur 3 Seiten.';
    await expect(announcer(page)).toHaveText(message);
    expect(await announcements()).toEqual([message]);

    // Correcting the input clears the region without a new announcement.
    await range.fill('1-2');
    await expect(announcer(page)).toHaveText('');
  });

  test('die Vorschau beim Teilen wird erst nach dem Tippen angesagt', async ({ page }) => {
    await loadSplitFile(page, pdfFile('bericht.pdf', await createPdf(10, { baseWidth: 500 })));
    await expect(splitThumbs(page)).toHaveCount(10);
    // The preview itself is no live region: it would read out every keystroke.
    await expect(page.locator('#split-preview')).not.toHaveAttribute('aria-live');

    const announcements = await recordAnnouncements(page);
    await page.locator('#split-ranges').pressSequentially('1-3, 4-6, 7-', { delay: 30 });
    await expect(announcer(page)).toHaveText('Ergibt 3 Dateien: 1-3 · 4-6 · 7-10');
    // Intermediate states such as "1-" (= pages 1-10) must not have been read out.
    expect(await announcements()).not.toContain('Ergibt 1 Datei: 1-10');
  });

  test('der Arbeitsschritt wird angesagt (Einzahl: „1 Seite wird …“)', async ({ page }) => {
    await addMergeFiles(page, [pdfFile('eine-seite.pdf', await createPdf(1))]);
    await expect(mergeItems(page)).toHaveCount(1);
    await expectIdle(page);
    await expect(announcer(page)).toHaveText('Datei wird geladen …');

    const announcements = await recordAnnouncements(page);
    await captureDownload(page, () => page.locator('#merge-run').click());
    await expectIdle(page);
    expect(await announcements()).toContain('1 Seite wird zusammengeführt …');
  });
});

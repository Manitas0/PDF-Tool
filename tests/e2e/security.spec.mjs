// Guards the security/privacy hardening the README promises: pdf.js must never compile
// PDF-provided code (isEvalSupported: false, CVE-2024-4367) and the Content-Security-Policy
// must keep the page from evaluating strings or opening network connections.
import { test, expect, addMergeFiles, createPdf, mergeItems, pdfFile } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('pdf.js wird mit isEvalSupported: false und enableXfa: false geöffnet', async ({ page }) => {
  // The exports of the pdf.js bundle are getter-only, so wrap the whole global instead of
  // patching getDocument. js/preview.js looks up `pdfjsLib` on every call.
  await page.evaluate(() => {
    const lib = window.pdfjsLib;
    window.__getDocumentParams = [];
    window.pdfjsLib = new Proxy(lib, {
      get(target, key) {
        if (key !== 'getDocument') return target[key];
        return (params) => {
          window.__getDocumentParams.push({ isEvalSupported: params.isEvalSupported, enableXfa: params.enableXfa });
          return target.getDocument(params);
        };
      },
    });
  });

  await addMergeFiles(page, [pdfFile('a.pdf', await createPdf(1, { baseWidth: 300 }))]);
  await expect(mergeItems(page)).toHaveCount(1);
  await expect(page.locator('#merge-list .merge-item-thumb canvas')).toHaveCount(1);

  const params = await page.evaluate(() => window.__getDocumentParams);
  expect(params.length, 'pdf.js wurde nicht über getDocument() aufgerufen').toBeGreaterThan(0);
  for (const entry of params) {
    expect(entry).toEqual({ isEvalSupported: false, enableXfa: false });
  }
});

test.describe('Content-Security-Policy', () => {
  // The probes below provoke CSP violations on purpose; Chromium logs them as console errors.
  test.use({ allowedErrors: [/Content Security Policy/] });

  test('blockiert Netzwerkverbindungen aus der Seite heraus', async ({ page }) => {
    // connect-src 'none' also covers the page's own origin.
    const result = await page.evaluate(() => fetch('/index.html').then(() => 'erlaubt', (error) => error.name));
    expect(result).toBe('TypeError');
  });

  test('verbietet das Ausführen von Zeichenketten als Code', async ({ page }) => {
    const messages = [];
    page.on('console', (message) => messages.push(message.text()));
    // Not eval() itself: code run via page.evaluate() bypasses the CSP, a string passed to
    // setTimeout() is compiled by the page and therefore checked.
    await page.evaluate(() => {
      window.__stringTimerRan = false;
      setTimeout('window.__stringTimerRan = true', 0);
    });
    await expect
      .poll(() => messages.some((text) => /Refused to evaluate a string as JavaScript/.test(text)))
      .toBe(true);
    expect(await page.evaluate(() => window.__stringTimerRan)).toBe(false);
  });
});

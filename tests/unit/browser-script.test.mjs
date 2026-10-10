// Checks that js/pdf-core.js works as a classic browser <script> (no ES modules, no Node globals):
// it must register `globalThis.PdfCore` and use `globalThis.PDFLib`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const corePath = fileURLToPath(new URL('../../js/pdf-core.js', import.meta.url));
const vendorPdfLibPath = fileURLToPath(new URL('../../vendor/pdf-lib.min.js', import.meta.url));
const source = readFileSync(corePath, 'utf8');
const nodeModule = require('../../js/pdf-core.js');
const { PDFDocument } = require('pdf-lib');

const PDF_HEADER = new TextEncoder().encode('%PDF-1.7\n%%EOF\n');

/** Runs pdf-core.js like a browser would, in a fresh global context. */
function runAsBrowserScript(globals = {}) {
  const context = vm.createContext({ ...globals });
  vm.runInContext(source, context, { filename: 'pdf-core.js' });
  return context;
}

/** Converts values from another realm into plain values of this realm. */
const plain = (value) => JSON.parse(JSON.stringify(value));

/** Minimal stand-in for pdf-lib that records how it is called. */
function createFakePdfLib({ pageCount = 2, loadError } = {}) {
  const calls = [];
  const fake = {
    calls,
    PDFDocument: {
      async load(bytes, options) {
        calls.push({ bytes, options });
        if (loadError) throw loadError;
        return { getPageCount: () => pageCount, fake: true };
      },
    },
  };
  return fake;
}

describe('pdf-core.js as a classic browser script', () => {
  test('passes `node --check`', () => {
    const result = spawnSync(process.execPath, ['--check', corePath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  });

  test('compiles as a classic script (no import/export syntax)', () => {
    assert.doesNotThrow(() => new vm.Script(source, { filename: 'pdf-core.js' }));
    assert.ok(!/^\s*(import|export)\s/m.test(source));
  });

  test('registers globalThis.PdfCore with the same API as the Node module, and nothing else', () => {
    const context = runAsBrowserScript({ PDFLib: createFakePdfLib() });
    assert.equal(typeof context.PdfCore, 'object');
    assert.deepEqual(Object.keys(context.PdfCore).sort(), Object.keys(nodeModule).sort());
    assert.deepEqual(Object.keys(context).sort(), ['PDFLib', 'PdfCore']);
  });

  test('pure helpers work in the browser build', () => {
    const { PdfCore } = runAsBrowserScript({ PDFLib: createFakePdfLib() });
    assert.deepEqual(plain(PdfCore.parseRangeGroups('1-3, 5–4, 7-', 8)), [[0, 1, 2], [4, 3], [6, 7]]);
    assert.equal(PdfCore.formatPageGroup([0, 1, 2, 4, 8, 7, 6]), '1-3, 5, 9-7');
    assert.equal(PdfCore.sanitizeFileName('a/b:c.pdf'), 'bc.pdf');
    assert.equal(PdfCore.looksLikePdf(PDF_HEADER), true);
    assert.throws(() => PdfCore.parseRangeGroups('x', 3), (err) => err.code === 'INVALID_TOKEN' && err instanceof PdfCore.PdfToolError);
  });

  test('loadPdf uses globalThis.PDFLib with updateMetadata: false', async () => {
    const fake = createFakePdfLib({ pageCount: 3 });
    const { PdfCore } = runAsBrowserScript({ PDFLib: fake });
    const doc = await PdfCore.loadPdf(PDF_HEADER);
    assert.equal(doc.fake, true);
    assert.equal(fake.calls.length, 1);
    assert.deepEqual(plain(fake.calls[0].options), { updateMetadata: false });
    assert.equal(fake.calls[0].bytes.length, PDF_HEADER.length);
    assert.equal(await PdfCore.getPageCount(PDF_HEADER), 3);
  });

  test('maps pdf-lib errors to error codes', async () => {
    const encrypted = new Error(
      'Input document to `PDFDocument.load` is encrypted. You can use `PDFDocument.load(..., { ignoreEncryption: true })` if you wish to load the document anyways.'
    );
    let core = runAsBrowserScript({ PDFLib: createFakePdfLib({ loadError: encrypted }) }).PdfCore;
    await assert.rejects(core.loadPdf(PDF_HEADER), (err) => err.code === 'ENCRYPTED');

    core = runAsBrowserScript({ PDFLib: createFakePdfLib({ loadError: new Error('Failed to parse') }) }).PdfCore;
    await assert.rejects(core.loadPdf(PDF_HEADER), (err) => err.code === 'INVALID_PDF');

    core = runAsBrowserScript({ PDFLib: createFakePdfLib({ pageCount: 0 }) }).PdfCore;
    await assert.rejects(core.loadPdf(PDF_HEADER), (err) => err.code === 'NO_PAGES');
  });

  test('loads without pdf-lib and resolves globalThis.PDFLib lazily', async () => {
    const context = runAsBrowserScript();
    assert.equal(typeof context.PdfCore, 'object');
    assert.equal(context.PdfCore.formatPageGroup([0, 1]), '1-2');
    await assert.rejects(context.PdfCore.loadPdf(PDF_HEADER), /pdf-lib/);

    context.PDFLib = createFakePdfLib({ pageCount: 5 });
    assert.equal(await context.PdfCore.getPageCount(PDF_HEADER), 5);
  });

  test(
    'merges and splits with the vendored pdf-lib build in the same global context',
    { skip: existsSync(vendorPdfLibPath) ? false : 'vendor/pdf-lib.min.js missing (run npm run vendor)' },
    async () => {
      const context = vm.createContext({ setTimeout, clearTimeout, console, TextEncoder, TextDecoder });
      vm.runInContext(readFileSync(vendorPdfLibPath, 'utf8'), context, { filename: 'pdf-lib.min.js' });
      vm.runInContext(source, context, { filename: 'pdf-core.js' });
      assert.equal(typeof context.PDFLib.PDFDocument, 'function');
      const { PdfCore } = context;

      const doc = await PDFDocument.create();
      for (let i = 0; i < 4; i++) doc.addPage([100 + i, 200]);
      const bytes = await doc.save();
      const widths = async (output) => {
        const loaded = await PDFDocument.load(new Uint8Array(output), { updateMetadata: false });
        return loaded.getPages().map((page) => page.getWidth());
      };

      const merged = await PdfCore.mergePdfs([{ bytes, pages: [3, 0] }, { bytes: bytes.buffer }], { title: 'Test' });
      assert.deepEqual(await widths(merged), [103, 100, 100, 101, 102, 103]);
      const mergedDoc = await PDFDocument.load(new Uint8Array(merged), { updateMetadata: false });
      assert.equal(mergedDoc.getProducer(), 'PDF-Tool');
      assert.equal(mergedDoc.getTitle(), 'Test');

      const parts = await PdfCore.splitPdf(bytes, PdfCore.chunkPages(4, 3));
      assert.equal(parts.length, 2);
      assert.deepEqual(await widths(parts[0]), [100, 101, 102]);
      assert.deepEqual(await widths(parts[1]), [103]);

      const extracted = await PdfCore.extractPages(bytes, PdfCore.parsePageList('4-3', 4));
      assert.deepEqual(await widths(extracted), [103, 102]);

      const encrypted = await PDFDocument.create();
      encrypted.addPage();
      encrypted.context.trailerInfo.Encrypt = encrypted.context.obj({ Filter: 'Standard' });
      await assert.rejects(
        PdfCore.loadPdf(await encrypted.save(), { fileName: 'geheim.pdf' }),
        (err) => err.code === 'ENCRYPTED' && err.message.startsWith('„geheim.pdf“: ')
      );
    }
  );
});

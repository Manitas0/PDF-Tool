// Unit tests for the PDF operations in js/pdf-core.js (loading, merging, splitting, extracting).
// Every page of a generated test PDF gets a unique width, so the order of pages in an output
// can be verified by reading back the widths.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../../js/pdf-core.js');
const { PDFDocument } = require('pdf-lib');
const {
  PdfToolError,
  looksLikePdf,
  loadPdf,
  getPageCount,
  mergePdfs,
  splitPdf,
  extractPages,
  describeError,
  parseRangeGroups,
  chunkPages,
  singlePageGroups,
} = core;

const encoder = new TextEncoder();

/** PDF with `pageCount` pages of widths base, base + 1, … */
async function makePdf(pageCount, { base = 100, producer } = {}) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) doc.addPage([base + i, 200]);
  if (producer) doc.setProducer(producer);
  return doc.save({ addDefaultPage: false });
}

/** PDF whose trailer references an /Encrypt dictionary (pdf-lib then refuses to load it). */
async function makeEncryptedPdf({ asRef = false, useObjectStreams = true } = {}) {
  const doc = await PDFDocument.create();
  doc.addPage([100, 200]);
  const encryptDict = doc.context.obj({ Filter: 'Standard', V: 2, R: 3, Length: 128, P: -44 });
  doc.context.trailerInfo.Encrypt = asRef ? doc.context.register(encryptDict) : encryptDict;
  return doc.save({ useObjectStreams });
}

async function pageWidths(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map((page) => page.getWidth());
}

/** Awaits `promise` and asserts that it rejects with a PdfToolError of the given code. */
async function expectToolError(promise, code) {
  let caught;
  await assert.rejects(promise, (err) => {
    caught = err;
    return true;
  });
  assert.ok(caught instanceof PdfToolError, `expected PdfToolError, got ${caught && caught.stack}`);
  assert.equal(caught.code, code, `unexpected code for message: ${caught.message}`);
  return caught;
}

/** Counts calls of PDFDocument.load while `fn` runs. */
async function countLoads(fn) {
  const original = PDFDocument.load;
  let calls = 0;
  PDFDocument.load = function countingLoad(...args) {
    calls++;
    return original.apply(this, args);
  };
  try {
    const result = await fn();
    return { calls, result };
  } finally {
    PDFDocument.load = original;
  }
}

// pdf-lib logs a warning for every object it cannot parse; keep the test output readable.
let originalWarn;
before(() => {
  originalWarn = console.warn;
  console.warn = () => {};
});
after(() => {
  console.warn = originalWarn;
});

let pdfA; // 3 pages, widths 100-102
let pdfB; // 4 pages, widths 200-203
let pdfC; // 1 page, width 300
let pdf10; // 10 pages, widths 100-109

before(async () => {
  pdfA = await makePdf(3, { base: 100 });
  pdfB = await makePdf(4, { base: 200 });
  pdfC = await makePdf(1, { base: 300 });
  pdf10 = await makePdf(10, { base: 100 });
});

describe('looksLikePdf', () => {
  test('recognizes real PDFs (Uint8Array, ArrayBuffer, Buffer)', () => {
    assert.equal(looksLikePdf(pdfA), true);
    assert.equal(looksLikePdf(pdfA.buffer.slice(pdfA.byteOffset, pdfA.byteOffset + pdfA.byteLength)), true);
    assert.equal(looksLikePdf(Buffer.from(pdfA)), true);
  });

  test('accepts the signature anywhere within the first 1024 bytes', () => {
    const at = (offset) => {
      const bytes = new Uint8Array(offset + 20).fill(0x20);
      bytes.set(encoder.encode('%PDF-1.7'), offset);
      return bytes;
    };
    assert.equal(looksLikePdf(at(0)), true);
    assert.equal(looksLikePdf(at(500)), true);
    assert.equal(looksLikePdf(at(1019)), true); // "%PDF-" ends at byte 1023
    assert.equal(looksLikePdf(at(1020)), false);
    assert.equal(looksLikePdf(at(4000)), false);
  });

  test('respects the offset of a Uint8Array view', () => {
    const backing = new Uint8Array(2048).fill(0x20);
    backing.set(encoder.encode('%PDF-'), 1500);
    assert.equal(looksLikePdf(backing), false);
    assert.equal(looksLikePdf(backing.subarray(1000)), true);
  });

  test('rejects everything else', () => {
    assert.equal(looksLikePdf(encoder.encode('Hallo Welt')), false);
    assert.equal(looksLikePdf(encoder.encode('%PDF')), false); // incomplete signature
    assert.equal(looksLikePdf(encoder.encode('%pdf-1.4')), false);
    assert.equal(looksLikePdf(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), false); // PNG
    assert.equal(looksLikePdf(new Uint8Array(0)), false);
    assert.equal(looksLikePdf(new ArrayBuffer(0)), false);
    assert.equal(looksLikePdf(null), false);
    assert.equal(looksLikePdf(undefined), false);
    assert.equal(looksLikePdf('%PDF-1.7'), false);
    assert.equal(looksLikePdf([0x25, 0x50, 0x44, 0x46, 0x2d]), false);
  });
});

describe('loadPdf', () => {
  test('loads Uint8Array, ArrayBuffer and Buffer input', async () => {
    assert.equal((await loadPdf(pdfA)).getPageCount(), 3);
    const arrayBuffer = pdfB.buffer.slice(pdfB.byteOffset, pdfB.byteOffset + pdfB.byteLength);
    assert.equal((await loadPdf(arrayBuffer)).getPageCount(), 4);
    assert.equal((await loadPdf(Buffer.from(pdfC))).getPageCount(), 1);
  });

  test('does not touch the metadata of the source (updateMetadata: false)', async () => {
    const bytes = await makePdf(1, { producer: 'Originalprogramm' });
    const doc = await loadPdf(bytes);
    assert.equal(doc.getProducer(), 'Originalprogramm');
  });

  test('NOT_A_PDF for non-PDF data', async () => {
    for (const bytes of [encoder.encode('Hallo Welt'), new Uint8Array(0), null, undefined, 'text', {}]) {
      const err = await expectToolError(loadPdf(bytes), 'NOT_A_PDF');
      assert.equal(err.message, 'Die Datei ist keine PDF-Datei.');
      assert.deepEqual(err.details, {});
    }
  });

  test('NOT_A_PDF message is prefixed with the file name', async () => {
    const err = await expectToolError(loadPdf(encoder.encode('x'), { fileName: 'notiz.txt' }), 'NOT_A_PDF');
    assert.equal(err.message, '„notiz.txt“: Die Datei ist keine PDF-Datei.');
    assert.equal(err.details.fileName, 'notiz.txt');
  });

  test('INVALID_PDF for truncated files', async () => {
    for (const fraction of [0.1, 0.5, 0.9]) {
      const truncated = pdf10.slice(0, Math.floor(pdf10.length * fraction));
      const err = await expectToolError(loadPdf(truncated, { fileName: 'kaputt.pdf' }), 'INVALID_PDF');
      assert.equal(err.message, '„kaputt.pdf“: Die PDF-Datei ist beschädigt oder kann nicht gelesen werden.');
      assert.equal(err.details.fileName, 'kaputt.pdf');
      assert.equal(typeof err.details.cause, 'string');
    }
  });

  test('INVALID_PDF for garbage after a PDF header', async () => {
    const samples = [
      '%PDF-1.7\nhello world',
      '%PDF-1.7\n',
      '%PDF-',
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF',
    ];
    for (const sample of samples) {
      const err = await expectToolError(loadPdf(encoder.encode(sample)), 'INVALID_PDF');
      assert.equal(err.message, 'Die PDF-Datei ist beschädigt oder kann nicht gelesen werden.');
    }
  });

  test('INVALID_PDF for random bytes behind a valid header', async () => {
    const bytes = new Uint8Array(4096);
    let seed = 1;
    for (let i = 0; i < bytes.length; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      bytes[i] = seed & 0xff;
    }
    bytes.set(encoder.encode('%PDF-1.7\n'), 0);
    await expectToolError(loadPdf(bytes), 'INVALID_PDF');
  });

  test('ENCRYPTED when the trailer has an /Encrypt dictionary (direct, by reference, classic xref)', async () => {
    const variants = [
      await makeEncryptedPdf(),
      await makeEncryptedPdf({ asRef: true }),
      await makeEncryptedPdf({ useObjectStreams: false }),
    ];
    for (const bytes of variants) {
      const err = await expectToolError(loadPdf(bytes), 'ENCRYPTED');
      assert.match(err.message, /verschlüsselt/);
      assert.match(err.message, /passwortgeschützt/);
      assert.match(err.message, /nicht bearbeitet werden/);
    }
  });

  test('ENCRYPTED message is prefixed with the file name', async () => {
    const err = await expectToolError(loadPdf(await makeEncryptedPdf(), { fileName: 'geheim.pdf' }), 'ENCRYPTED');
    assert.ok(err.message.startsWith('„geheim.pdf“: '), err.message);
    assert.equal(err.details.fileName, 'geheim.pdf');
  });

  test('ENCRYPTED also when pdf-lib fails for another reason but an /Encrypt entry exists', async () => {
    const bytes = encoder.encode('%PDF-1.7\ntrailer\n<< /Size 3 /Encrypt 5 0 R >>\n%%EOF');
    await expectToolError(loadPdf(bytes), 'ENCRYPTED');
    // "/Encrypted" is a different name and must not trigger the detection.
    const other = encoder.encode('%PDF-1.7\ntrailer\n<< /Encrypted true >>\n%%EOF');
    await expectToolError(loadPdf(other), 'INVALID_PDF');
  });

  test('NO_PAGES for a PDF without pages', async () => {
    const doc = await PDFDocument.create();
    const bytes = await doc.save({ addDefaultPage: false });
    const err = await expectToolError(loadPdf(bytes, { fileName: 'leer.pdf' }), 'NO_PAGES');
    assert.equal(err.message, '„leer.pdf“: Die PDF-Datei enthält keine Seiten.');
    assert.equal(err.details.fileName, 'leer.pdf');
  });

  test('accepts null options', async () => {
    assert.equal((await loadPdf(pdfA, null)).getPageCount(), 3);
  });
});

describe('getPageCount', () => {
  test('returns the number of pages', async () => {
    assert.equal(await getPageCount(pdfA), 3);
    assert.equal(await getPageCount(pdf10, { fileName: 'x.pdf' }), 10);
  });

  test('throws the loadPdf errors', async () => {
    const err = await expectToolError(getPageCount(encoder.encode('nope'), { fileName: 'a.txt' }), 'NOT_A_PDF');
    assert.equal(err.details.fileName, 'a.txt');
  });
});

describe('mergePdfs', () => {
  test('appends all pages of all sources in the given order', async () => {
    const merged = await mergePdfs([{ bytes: pdfA }, { bytes: pdfB }, { bytes: pdfC }]);
    assert.ok(merged instanceof Uint8Array);
    assert.ok(looksLikePdf(merged));
    assert.deepEqual(await pageWidths(merged), [100, 101, 102, 200, 201, 202, 203, 300]);

    const reversed = await mergePdfs([{ bytes: pdfC }, { bytes: pdfB }, { bytes: pdfA }]);
    assert.deepEqual(await pageWidths(reversed), [300, 200, 201, 202, 203, 100, 101, 102]);
  });

  test('uses only the selected pages of each source, in the selected order', async () => {
    const merged = await mergePdfs([
      { bytes: pdfA, pages: [2, 0] },
      { bytes: pdfB },
      { bytes: pdfC, pages: [0] },
      { bytes: pdf10, pages: parseRangeGroups('10-8, 1', 10).flat() },
    ]);
    assert.deepEqual(await pageWidths(merged), [102, 100, 200, 201, 202, 203, 300, 109, 108, 107, 100]);
  });

  test('allows the same page several times', async () => {
    const merged = await mergePdfs([{ bytes: pdfA, pages: [1, 1, 0, 1] }]);
    assert.deepEqual(await pageWidths(merged), [101, 101, 100, 101]);
  });

  test('the same bytes object twice is loaded only once', async () => {
    const { calls, result } = await countLoads(() =>
      mergePdfs([{ bytes: pdfA }, { bytes: pdfB }, { bytes: pdfA, pages: [2] }])
    );
    assert.equal(calls, 2);
    assert.deepEqual(await pageWidths(result), [100, 101, 102, 200, 201, 202, 203, 102]);
  });

  test('equal content in different objects is loaded separately', async () => {
    const copy = pdfA.slice();
    const { calls, result } = await countLoads(() => mergePdfs([{ bytes: pdfA }, { bytes: copy }]));
    assert.equal(calls, 2);
    assert.deepEqual(await pageWidths(result), [100, 101, 102, 100, 101, 102]);
  });

  test('accepts ArrayBuffer sources', async () => {
    const arrayBuffer = pdfC.buffer.slice(pdfC.byteOffset, pdfC.byteOffset + pdfC.byteLength);
    const merged = await mergePdfs([{ bytes: arrayBuffer }, { bytes: arrayBuffer }]);
    assert.deepEqual(await pageWidths(merged), [300, 300]);
  });

  test('sets Producer and Creator to PDF-Tool and the title if given', async () => {
    const withTitle = await PDFDocument.load(await mergePdfs([{ bytes: pdfA }], { title: '  Jahresbericht 2024 ' }), {
      updateMetadata: false,
    });
    assert.equal(withTitle.getProducer(), 'PDF-Tool');
    assert.equal(withTitle.getCreator(), 'PDF-Tool');
    assert.equal(withTitle.getTitle(), 'Jahresbericht 2024');

    const withoutTitle = await PDFDocument.load(await mergePdfs([{ bytes: pdfA }]), { updateMetadata: false });
    assert.equal(withoutTitle.getProducer(), 'PDF-Tool');
    assert.equal(withoutTitle.getTitle(), undefined);

    const blankTitle = await PDFDocument.load(await mergePdfs([{ bytes: pdfA }], { title: '   ' }), {
      updateMetadata: false,
    });
    assert.equal(blankTitle.getTitle(), undefined);
  });

  test('does not modify the inputs', async () => {
    const original = pdfA.slice();
    const pages = [2, 1];
    await mergePdfs([{ bytes: pdfA, pages }]);
    assert.deepEqual(pdfA, original);
    assert.deepEqual(pages, [2, 1]);
  });

  test('NO_SOURCES for an empty or missing list', async () => {
    for (const sources of [[], undefined, null]) {
      const err = await expectToolError(mergePdfs(sources), 'NO_SOURCES');
      assert.equal(err.message, 'Bitte füge mindestens eine PDF-Datei hinzu.');
    }
  });

  test('EMPTY_GROUP for an empty page selection', async () => {
    const err = await expectToolError(mergePdfs([{ bytes: pdfA }, { bytes: pdfB, pages: [], name: 'b.pdf' }]), 'EMPTY_GROUP');
    assert.equal(err.message, '„b.pdf“: Es sind keine Seiten ausgewählt.');
    assert.equal(err.details.fileName, 'b.pdf');
  });

  test('PAGE_OUT_OF_RANGE for invalid page indices', async () => {
    const tooHigh = await expectToolError(mergePdfs([{ bytes: pdfA, pages: [0, 3], name: 'a.pdf' }]), 'PAGE_OUT_OF_RANGE');
    assert.equal(tooHigh.message, '„a.pdf“: Seite 4 gibt es nicht – das Dokument hat nur 3 Seiten.');
    assert.equal(tooHigh.details.page, 4);
    assert.equal(tooHigh.details.pageCount, 3);
    assert.equal(tooHigh.details.fileName, 'a.pdf');

    const single = await expectToolError(mergePdfs([{ bytes: pdfC, pages: [1] }]), 'PAGE_OUT_OF_RANGE');
    assert.equal(single.message, 'Seite 2 gibt es nicht – das Dokument hat nur 1 Seite.');

    const negative = await expectToolError(mergePdfs([{ bytes: pdfA, pages: [-1] }]), 'PAGE_OUT_OF_RANGE');
    assert.equal(negative.details.page, 0);

    await expectToolError(mergePdfs([{ bytes: pdfA, pages: [1.5] }]), 'PAGE_OUT_OF_RANGE');
    await expectToolError(mergePdfs([{ bytes: pdfA, pages: ['1'] }]), 'PAGE_OUT_OF_RANGE');
  });

  test('load errors carry the name of the offending source', async () => {
    const notPdf = await expectToolError(
      mergePdfs([{ bytes: pdfA, name: 'a.pdf' }, { bytes: encoder.encode('Text'), name: 'notiz.txt' }]),
      'NOT_A_PDF'
    );
    assert.equal(notPdf.details.fileName, 'notiz.txt');
    assert.ok(notPdf.message.startsWith('„notiz.txt“: '));

    const encrypted = await expectToolError(
      mergePdfs([{ bytes: await makeEncryptedPdf(), name: 'geheim.pdf' }]),
      'ENCRYPTED'
    );
    assert.equal(encrypted.details.fileName, 'geheim.pdf');

    await expectToolError(mergePdfs([{ bytes: pdfA }, null]), 'NOT_A_PDF');
    await expectToolError(mergePdfs([{}]), 'NOT_A_PDF');
  });

  test('a merged result can be merged again', async () => {
    const first = await mergePdfs([{ bytes: pdfA }, { bytes: pdfC }]);
    const second = await mergePdfs([{ bytes: first, pages: [3, 0] }, { bytes: pdfB, pages: [3] }]);
    assert.deepEqual(await pageWidths(second), [300, 100, 203]);
  });
});

describe('splitPdf', () => {
  test('one output per group, pages in group order', async () => {
    const parts = await splitPdf(pdf10, [[0, 1, 2], [3], [9, 8, 7], [4, 4]]);
    assert.equal(parts.length, 4);
    for (const part of parts) {
      assert.ok(part instanceof Uint8Array);
      assert.ok(looksLikePdf(part));
    }
    assert.deepEqual(await pageWidths(parts[0]), [100, 101, 102]);
    assert.deepEqual(await pageWidths(parts[1]), [103]);
    assert.deepEqual(await pageWidths(parts[2]), [109, 108, 107]);
    assert.deepEqual(await pageWidths(parts[3]), [104, 104]);
  });

  test('descending order of the whole document', async () => {
    const [reversed] = await splitPdf(pdf10, parseRangeGroups('10-1', 10));
    assert.deepEqual(await pageWidths(reversed), [109, 108, 107, 106, 105, 104, 103, 102, 101, 100]);
  });

  test('works with chunkPages and singlePageGroups', async () => {
    const chunks = await splitPdf(pdf10, chunkPages(10, 4));
    assert.deepEqual(
      await Promise.all(chunks.map(pageWidths)),
      [[100, 101, 102, 103], [104, 105, 106, 107], [108, 109]]
    );

    const singles = await splitPdf(pdfA, singlePageGroups(3));
    assert.deepEqual(await Promise.all(singles.map(pageWidths)), [[100], [101], [102]]);
  });

  test('works with parsed range groups (open ranges, dashes)', async () => {
    const parts = await splitPdf(pdf10, parseRangeGroups('-2; 3 – 4, 9-', 10));
    assert.deepEqual(await Promise.all(parts.map(pageWidths)), [[100, 101], [102, 103], [108, 109]]);
  });

  test('loads the source only once', async () => {
    const { calls, result } = await countLoads(() => splitPdf(pdf10, singlePageGroups(10)));
    assert.equal(calls, 1);
    assert.equal(result.length, 10);
  });

  test('outputs carry PDF-Tool as Producer and Creator', async () => {
    const [part] = await splitPdf(pdfA, [[0]]);
    const doc = await PDFDocument.load(part, { updateMetadata: false });
    assert.equal(doc.getProducer(), 'PDF-Tool');
    assert.equal(doc.getCreator(), 'PDF-Tool');
  });

  test('EMPTY_GROUP for an empty group (before loading the file)', async () => {
    const { calls } = await countLoads(async () => {
      const err = await expectToolError(splitPdf(pdf10, [[0], []], { fileName: 'a.pdf' }), 'EMPTY_GROUP');
      assert.equal(err.message, '„a.pdf“: Ausgabedatei 2 enthält keine Seiten.');
      assert.equal(err.details.groupIndex, 1);
      assert.equal(err.details.fileName, 'a.pdf');
    });
    assert.equal(calls, 0);
  });

  test('EMPTY_GROUP when there are no groups at all', async () => {
    for (const groups of [[], undefined, null]) {
      const err = await expectToolError(splitPdf(pdf10, groups), 'EMPTY_GROUP');
      assert.match(err.message, /keine Seiten/);
    }
    await expectToolError(splitPdf(pdf10, [undefined]), 'EMPTY_GROUP');
  });

  test('PAGE_OUT_OF_RANGE names the group', async () => {
    const err = await expectToolError(splitPdf(pdfA, [[0], [1, 3]], { fileName: 'a.pdf' }), 'PAGE_OUT_OF_RANGE');
    assert.equal(err.message, '„a.pdf“: Seite 4 gibt es nicht – das Dokument hat nur 3 Seiten.');
    assert.equal(err.details.groupIndex, 1);
    assert.equal(err.details.page, 4);
  });

  test('load errors carry the file name', async () => {
    const err = await expectToolError(splitPdf(encoder.encode('kein pdf'), [[0]], { fileName: 'bild.png' }), 'NOT_A_PDF');
    assert.equal(err.message, '„bild.png“: Die Datei ist keine PDF-Datei.');
    await expectToolError(splitPdf(await makeEncryptedPdf(), [[0]]), 'ENCRYPTED');
  });

  test('does not modify the groups passed in', async () => {
    const groups = [[2, 0], [1]];
    await splitPdf(pdfA, groups);
    assert.deepEqual(groups, [[2, 0], [1]]);
  });
});

describe('extractPages', () => {
  test('returns one PDF with exactly the given pages in the given order', async () => {
    const extracted = await extractPages(pdf10, [3, 0, 3, 9]);
    assert.deepEqual(await pageWidths(extracted), [103, 100, 103, 109]);
  });

  test('accepts a parsed page list and a title', async () => {
    const extracted = await extractPages(pdf10, parseRangeGroups('5-3, 1', 10).flat(), { title: 'Auszug' });
    assert.deepEqual(await pageWidths(extracted), [104, 103, 102, 100]);
    const doc = await PDFDocument.load(extracted, { updateMetadata: false });
    assert.equal(doc.getTitle(), 'Auszug');
    assert.equal(doc.getProducer(), 'PDF-Tool');
  });

  test('EMPTY_GROUP for no pages', async () => {
    for (const pages of [[], undefined, null]) {
      const err = await expectToolError(extractPages(pdf10, pages, { fileName: 'x.pdf' }), 'EMPTY_GROUP');
      assert.ok(err.message.startsWith('„x.pdf“: '));
    }
  });

  test('PAGE_OUT_OF_RANGE and load errors', async () => {
    const err = await expectToolError(extractPages(pdfA, [5], { fileName: 'a.pdf' }), 'PAGE_OUT_OF_RANGE');
    assert.equal(err.details.page, 6);
    assert.equal(err.details.fileName, 'a.pdf');
    await expectToolError(extractPages(encoder.encode('nope'), [0]), 'NOT_A_PDF');
  });
});

describe('describeError', () => {
  test('returns the message of a PdfToolError', () => {
    const err = new PdfToolError('EMPTY_INPUT', 'Bitte gib Seiten an.');
    assert.equal(describeError(err), 'Bitte gib Seiten an.');
  });

  test('returns the message of real errors thrown by the core', async () => {
    let caught;
    try {
      await loadPdf(encoder.encode('x'), { fileName: 'a.txt' });
    } catch (err) {
      caught = err;
    }
    assert.equal(describeError(caught), '„a.txt“: Die Datei ist keine PDF-Datei.');
  });

  test('accepts PdfToolError-like objects (e.g. from another realm)', () => {
    assert.equal(describeError({ name: 'PdfToolError', message: 'Fremd', code: 'X' }), 'Fremd');
  });

  test('wraps other errors in a generic German message', () => {
    assert.equal(describeError(new Error('boom')), 'Unerwarteter Fehler: boom');
    assert.equal(describeError(new TypeError('x is undefined')), 'Unerwarteter Fehler: x is undefined');
    assert.equal(describeError('kaputt'), 'Unerwarteter Fehler: kaputt');
    assert.equal(describeError(42), 'Unerwarteter Fehler: 42');
    assert.equal(describeError(undefined), 'Unerwarteter Fehler.');
    assert.equal(describeError(null), 'Unerwarteter Fehler.');
    assert.equal(describeError(new Error('')), 'Unerwarteter Fehler.');
  });
});

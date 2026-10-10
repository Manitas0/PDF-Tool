// Unit tests for the file-name helpers in js/pdf-core.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sanitizeFileName, stripPdfExtension, ensurePdfExtension, uniqueFileNames } = require('../../js/pdf-core.js');

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f\u007f]/;

describe('sanitizeFileName', () => {
  test('keeps ordinary names unchanged', () => {
    assert.equal(sanitizeFileName('Bericht.pdf'), 'Bericht.pdf');
    assert.equal(sanitizeFileName('Rechnung 2024-03 (Kopie).pdf'), 'Rechnung 2024-03 (Kopie).pdf');
    assert.equal(sanitizeFileName('a.b.c.pdf'), 'a.b.c.pdf');
  });

  test('preserves umlauts and other Unicode letters', () => {
    assert.equal(sanitizeFileName('Übersicht für Größe & Maß.pdf'), 'Übersicht für Größe & Maß.pdf');
    assert.equal(sanitizeFileName('Ärger_Öl_Ühr_äöüß.pdf'), 'Ärger_Öl_Ühr_äöüß.pdf');
    assert.equal(sanitizeFileName('日本語 ドキュメント.pdf'), '日本語 ドキュメント.pdf');
    assert.equal(sanitizeFileName('Präsentation 😀.pdf'), 'Präsentation 😀.pdf');
  });

  test('normalizes decomposed umlauts (macOS file names) to NFC', () => {
    const decomposed = 'U\u0308bersicht.pdf';
    assert.equal(sanitizeFileName(decomposed), '\u00dcbersicht.pdf');
  });

  test('removes path parts (POSIX and Windows)', () => {
    assert.equal(sanitizeFileName('/home/user/docs/a.pdf'), 'a.pdf');
    assert.equal(sanitizeFileName('C:\\Users\\Max\\Desktop\\b.pdf'), 'b.pdf');
    assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd');
    assert.equal(sanitizeFileName('..\\..\\boot.ini'), 'boot.ini');
    assert.equal(sanitizeFileName('mixed/path\\c.pdf'), 'c.pdf');
    assert.equal(sanitizeFileName('ordner/'), 'dokument');
  });

  test('removes reserved characters', () => {
    assert.equal(sanitizeFileName('a<b>c:d"e|f?g*h.pdf'), 'abcdefgh.pdf');
    assert.equal(sanitizeFileName('Bericht: Q1?.pdf'), 'Bericht Q1.pdf');
    assert.equal(sanitizeFileName('<>:"|?*'), 'dokument');
  });

  test('removes control characters', () => {
    assert.equal(sanitizeFileName('a\u0000b\u0007c\u001bd\u007fe.pdf'), 'abcde.pdf');
    assert.equal(sanitizeFileName('x\u0085y.pdf'), 'xy.pdf'); // C1 control
  });

  test('removes bidi controls used to spoof extensions', () => {
    const spoofed = sanitizeFileName('rechnung\u202Efdp.exe');
    assert.ok(!/[\u202a-\u202e\u2066-\u2069]/.test(spoofed), JSON.stringify(spoofed));
    assert.equal(spoofed, 'rechnungfdp.exe');
    assert.equal(sanitizeFileName('\ufeffbom.pdf'), 'bom.pdf');
  });

  test('turns whitespace into single spaces', () => {
    assert.equal(sanitizeFileName('Teil\t1\n2.pdf'), 'Teil 1 2.pdf');
    assert.equal(sanitizeFileName('  viel    Platz  .pdf  '), 'viel Platz.pdf');
    assert.equal(sanitizeFileName('a\u00a0\u00a0b.pdf'), 'a b.pdf');
    assert.equal(sanitizeFileName('a : b.pdf'), 'a b.pdf');
  });

  test('trims dots and spaces at both ends', () => {
    assert.equal(sanitizeFileName('...geheim...'), 'geheim');
    assert.equal(sanitizeFileName(' . a.pdf . '), 'a.pdf');
    assert.equal(sanitizeFileName('.versteckt.pdf'), 'versteckt.pdf');
    assert.equal(sanitizeFileName('Bericht..pdf'), 'Bericht.pdf');
    assert.equal(sanitizeFileName('name.'), 'name');
  });

  test('a bare extension gets the fallback as name', () => {
    assert.equal(sanitizeFileName('.pdf'), 'dokument.pdf');
    assert.equal(sanitizeFileName(' ..pdf '), 'dokument.pdf');
    assert.equal(sanitizeFileName('.pdf', 'zusammengefuehrt'), 'zusammengefuehrt.pdf');
  });

  test('falls back when nothing usable is left', () => {
    for (const name of ['', '   ', '...', ' . . ', '\u0000\u0001', '/', '\\', null, undefined]) {
      assert.equal(sanitizeFileName(name), 'dokument', JSON.stringify(name));
    }
    assert.equal(sanitizeFileName('', 'datei'), 'datei');
    assert.equal(sanitizeFileName('???', 'zusammengefuehrt.pdf'), 'zusammengefuehrt.pdf');
  });

  test('prefixes Windows device names', () => {
    assert.equal(sanitizeFileName('CON.pdf'), '_CON.pdf');
    assert.equal(sanitizeFileName('nul'), '_nul');
    assert.equal(sanitizeFileName('com1.txt'), '_com1.txt');
    assert.equal(sanitizeFileName('Lpt9.backup.pdf'), '_Lpt9.backup.pdf');
    assert.equal(sanitizeFileName('console.pdf'), 'console.pdf');
    assert.equal(sanitizeFileName('auxiliar.pdf'), 'auxiliar.pdf');
  });

  test('caps the length at 120 characters and keeps the extension', () => {
    const long = `${'a'.repeat(200)}.pdf`;
    const result = sanitizeFileName(long);
    assert.equal(result.length, 120);
    assert.ok(result.endsWith('.pdf'));
    assert.equal(result, `${'a'.repeat(116)}.pdf`);

    assert.equal(sanitizeFileName('b'.repeat(300)), 'b'.repeat(120));
    assert.equal(sanitizeFileName(`${'ä'.repeat(130)}.PDF`), `${'ä'.repeat(116)}.PDF`);
    assert.equal(sanitizeFileName(`${'x'.repeat(120)}.pdf`).length, 120);
    assert.equal(sanitizeFileName(`${'x'.repeat(116)}.pdf`), `${'x'.repeat(116)}.pdf`); // exactly 120
  });

  test('truncation does not leave trailing spaces/dots or split surrogate pairs', () => {
    const spaced = sanitizeFileName(`${'a'.repeat(115)} ${'b'.repeat(10)}.pdf`);
    assert.equal(spaced, `${'a'.repeat(115)}.pdf`);

    const dotted = sanitizeFileName(`${'a'.repeat(115)}.${'b'.repeat(20)}.pdf`);
    assert.equal(dotted, `${'a'.repeat(115)}.pdf`);

    for (const prefix of ['', 'x']) {
      const emoji = sanitizeFileName(`${prefix}${'😀'.repeat(100)}.pdf`);
      assert.ok(emoji.length <= 120, `${emoji.length}`);
      assert.ok(emoji.endsWith('.pdf'));
      assert.ok(!LONE_SURROGATE.test(emoji), 'lone surrogate in result');
    }
  });

  test('never returns forbidden characters (fuzz)', () => {
    const alphabet = ['a', 'Ä', ' ', '.', '/', '\\', ':', '*', '?', '"', '<', '>', '|', '\t', '\n', '\u0000', '\u202e', 'p', 'd', 'f', '😀'];
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let run = 0; run < 500; run++) {
      const length = Math.floor(random() * 160);
      let name = '';
      for (let i = 0; i < length; i++) name += alphabet[Math.floor(random() * alphabet.length)];
      const result = sanitizeFileName(name);
      assert.ok(result.length > 0 && result.length <= 120, JSON.stringify(result));
      assert.ok(!FORBIDDEN.test(result), JSON.stringify(result));
      assert.ok(!/^[ .]|[ .]$/.test(result), JSON.stringify(result));
      assert.ok(!LONE_SURROGATE.test(result), JSON.stringify(result));
      assert.equal(sanitizeFileName(result), result, 'sanitizing must be idempotent');
    }
  });

  test('accepts non-string input', () => {
    assert.equal(sanitizeFileName(123), '123');
  });
});

describe('stripPdfExtension', () => {
  const cases = [
    ['a.pdf', 'a'],
    ['a.PDF', 'a'],
    ['a.Pdf', 'a'],
    ['a.pdf.pdf', 'a.pdf'],
    ['a.txt', 'a.txt'],
    ['pdf', 'pdf'],
    ['a.pdfx', 'a.pdfx'],
    ['a_pdf', 'a_pdf'],
    ['', ''],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      assert.equal(stripPdfExtension(input), expected);
    });
  }
  test('handles null/undefined', () => {
    assert.equal(stripPdfExtension(undefined), '');
    assert.equal(stripPdfExtension(null), '');
  });
});

describe('ensurePdfExtension', () => {
  const cases = [
    ['a', 'a.pdf'],
    ['a.pdf', 'a.pdf'],
    ['a.PDF', 'a.PDF'],
    ['a.txt', 'a.txt.pdf'],
    ['a.', 'a.pdf'],
    ['zusammengefuehrt', 'zusammengefuehrt.pdf'],
    ['Übersicht', 'Übersicht.pdf'],
  ];
  for (const [input, expected] of cases) {
    test(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      assert.equal(ensurePdfExtension(input), expected);
    });
  }
  test('is idempotent', () => {
    assert.equal(ensurePdfExtension(ensurePdfExtension('x')), 'x.pdf');
  });
});

describe('uniqueFileNames', () => {
  test('keeps distinct names unchanged', () => {
    assert.deepEqual(uniqueFileNames(['a.pdf', 'b.pdf', 'c.pdf']), ['a.pdf', 'b.pdf', 'c.pdf']);
  });

  test('numbers duplicates starting with (2)', () => {
    assert.deepEqual(uniqueFileNames(['a.pdf', 'a.pdf', 'a.pdf']), ['a.pdf', 'a (2).pdf', 'a (3).pdf']);
    assert.deepEqual(uniqueFileNames(['x_S1.pdf', 'y.pdf', 'x_S1.pdf']), ['x_S1.pdf', 'y.pdf', 'x_S1 (2).pdf']);
  });

  test('compares case-insensitively and keeps the original spelling', () => {
    assert.deepEqual(uniqueFileNames(['A.pdf', 'a.PDF']), ['A.pdf', 'a (2).PDF']);
    assert.deepEqual(uniqueFileNames(['Übung.pdf', 'übung.pdf']), ['Übung.pdf', 'übung (2).pdf']);
  });

  test('never produces a name that already exists in the list', () => {
    assert.deepEqual(uniqueFileNames(['a.pdf', 'a.pdf', 'a (2).pdf']), ['a.pdf', 'a (3).pdf', 'a (2).pdf']);
    assert.deepEqual(uniqueFileNames(['a (2).pdf', 'a.pdf', 'a.pdf']), ['a (2).pdf', 'a.pdf', 'a (3).pdf']);
  });

  test('names without extension', () => {
    assert.deepEqual(uniqueFileNames(['x', 'x', 'X']), ['x', 'x (2)', 'X (3)']);
  });

  test('empty input and input immutability', () => {
    assert.deepEqual(uniqueFileNames([]), []);
    const input = ['a.pdf', 'a.pdf'];
    uniqueFileNames(input);
    assert.deepEqual(input, ['a.pdf', 'a.pdf']);
  });

  test('result is always unique (case-insensitive) and keeps the length', () => {
    const pool = ['a.pdf', 'A.pdf', 'a (2).pdf', 'b.pdf', 'a (3).PDF', 'B.PDF', 'a'];
    let seed = 3;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let run = 0; run < 200; run++) {
      const names = Array.from({ length: Math.floor(random() * 12) }, () => pool[Math.floor(random() * pool.length)]);
      const result = uniqueFileNames(names);
      assert.equal(result.length, names.length);
      assert.equal(new Set(result.map((n) => n.toLowerCase())).size, result.length, JSON.stringify(result));
      // First occurrences are never renamed.
      const seen = new Set();
      names.forEach((name, i) => {
        if (!seen.has(name.toLowerCase())) assert.equal(result[i], name);
        seen.add(name.toLowerCase());
      });
    }
  });
});

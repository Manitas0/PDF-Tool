// Unit tests for page-range parsing, chunking and page-group labels in js/pdf-core.js.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../../js/pdf-core.js');
const {
  PdfToolError,
  parseRangeGroups,
  parsePageList,
  chunkPages,
  singlePageGroups,
  formatPageGroup,
  formatPageGroupForFilename,
  formatPageCount,
} = core;

/** Asserts that `fn` throws a PdfToolError with the given code and returns it. */
function expectToolError(fn, code) {
  let caught;
  assert.throws(fn, (err) => {
    caught = err;
    return true;
  });
  assert.ok(caught instanceof PdfToolError, `expected PdfToolError, got ${caught && caught.name}`);
  assert.ok(caught instanceof Error);
  assert.equal(caught.name, 'PdfToolError');
  assert.equal(caught.code, code, `unexpected code for message: ${caught.message}`);
  assert.equal(typeof caught.message, 'string');
  assert.ok(caught.message.length > 0);
  return caught;
}

describe('parseRangeGroups – valid input', () => {
  const cases = [
    // [input, pageCount, expected groups (0-based)]
    ['3', 10, [[2]]],
    ['1', 1, [[0]]],
    ['10', 10, [[9]]],
    ['1-3', 10, [[0, 1, 2]]],
    ['3-3', 10, [[2]]],
    ['5-3', 10, [[4, 3, 2]]],
    ['10-1', 10, [[9, 8, 7, 6, 5, 4, 3, 2, 1, 0]]],
    ['8-', 10, [[7, 8, 9]]],
    ['10-', 10, [[9]]],
    ['1-', 3, [[0, 1, 2]]],
    ['-3', 10, [[0, 1, 2]]],
    ['-1', 10, [[0]]],
    ['-10', 10, [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]]],
    ['2–4', 10, [[1, 2, 3]]], // en dash
    ['4—2', 10, [[3, 2, 1]]], // em dash
    ['7–', 8, [[6, 7]]], // open end with en dash
    ['—2', 8, [[0, 1]]], // open start with em dash
    ['01-03', 10, [[0, 1, 2]]], // leading zeros
    ['007', 10, [[6]]],
  ];
  for (const [input, pageCount, expected] of cases) {
    test(`${JSON.stringify(input)} with ${pageCount} pages`, () => {
      assert.deepEqual(parseRangeGroups(input, pageCount), expected);
    });
  }

  test('returns one group per token, in input order', () => {
    assert.deepEqual(parseRangeGroups('1-3, 5, 9-7, 9-', 10), [[0, 1, 2], [4], [8, 7, 6], [8, 9]]);
  });

  test('ignores whitespace around and inside tokens', () => {
    assert.deepEqual(parseRangeGroups(' 1 - 3 ', 10), [[0, 1, 2]]);
    assert.deepEqual(parseRangeGroups('\t2\t,\n4 -\t5 ', 10), [[1], [3, 4]]);
    assert.deepEqual(parseRangeGroups(' 1 - 2 ', 10), [[0, 1]]); // no-break spaces
    assert.deepEqual(parseRangeGroups('  7  -  ', 8), [[6, 7]]);
    assert.deepEqual(parseRangeGroups('  -  2  ', 8), [[0, 1]]);
    assert.deepEqual(parseRangeGroups('5 – 3', 8), [[4, 3, 2]]);
  });

  test('accepts semicolons and mixed separators', () => {
    assert.deepEqual(parseRangeGroups('1;2;3', 3), [[0], [1], [2]]);
    assert.deepEqual(parseRangeGroups('1-2; 3, 4', 4), [[0, 1], [2], [3]]);
  });

  test('skips empty tokens (leading, trailing and double separators)', () => {
    assert.deepEqual(parseRangeGroups('1,2,', 5), [[0], [1]]);
    assert.deepEqual(parseRangeGroups(',1', 5), [[0]]);
    assert.deepEqual(parseRangeGroups('1,,2', 5), [[0], [1]]);
    assert.deepEqual(parseRangeGroups('1;;', 5), [[0]]);
    assert.deepEqual(parseRangeGroups(' , 3 ; , ', 5), [[2]]);
  });

  test('keeps duplicates and overlapping ranges', () => {
    assert.deepEqual(parseRangeGroups('1,1', 3), [[0], [0]]);
    assert.deepEqual(parseRangeGroups('1-3,2-4', 4), [[0, 1, 2], [1, 2, 3]]);
  });

  test('accepts non-string input that stringifies to a valid expression', () => {
    assert.deepEqual(parseRangeGroups(3, 5), [[2]]);
  });

  test('returns fresh arrays on every call', () => {
    const first = parseRangeGroups('1-2', 3);
    first[0].push(99);
    assert.deepEqual(parseRangeGroups('1-2', 3), [[0, 1]]);
  });
});

describe('parseRangeGroups – EMPTY_INPUT', () => {
  for (const input of ['', '   ', '\t\n', ',', ';', ' , ; ', ',,,', null, undefined]) {
    test(`${JSON.stringify(input) ?? 'undefined'}`, () => {
      const err = expectToolError(() => parseRangeGroups(input, 5), 'EMPTY_INPUT');
      assert.match(err.message, /mindestens eine Seite/);
    });
  }
});

describe('parseRangeGroups – INVALID_TOKEN', () => {
  const garbage = [
    'abc',
    'e',
    '2a',
    'a2',
    '1-2-3',
    '1.5',
    '1..3',
    '1 2', // digits separated by a space are not merged into "12"
    '-',
    '–',
    '--3',
    '3--',
    '1 - - 3',
    '+3',
    '1_3',
    '1~3',
    '1−3', // U+2212 minus sign is not one of the accepted dashes
    '３', // full-width digit three
    '٣', // Arabic-Indic digit three
    'Seite 3',
    '1-3x',
  ];
  for (const token of garbage) {
    test(`${JSON.stringify(token)}`, () => {
      const err = expectToolError(() => parseRangeGroups(token, 10), 'INVALID_TOKEN');
      assert.equal(err.details.token, token.trim());
      assert.ok(err.message.includes(`„${token.trim()}“`), err.message);
      assert.match(err.message, /keine gültige Seitenangabe/);
    });
  }

  test('reports the first invalid token (trimmed) of a list', () => {
    const err = expectToolError(() => parseRangeGroups('1, 2,  x y , z', 10), 'INVALID_TOKEN');
    assert.equal(err.details.token, 'x y');
  });

  test('syntax errors win over range errors that come later', () => {
    const err = expectToolError(() => parseRangeGroups('abc, 99', 10), 'INVALID_TOKEN');
    assert.equal(err.details.token, 'abc');
  });

  test('abbreviates very long tokens in the message but keeps them in details', () => {
    const token = 'x'.repeat(200);
    const err = expectToolError(() => parseRangeGroups(token, 10), 'INVALID_TOKEN');
    assert.equal(err.details.token, token);
    assert.ok(err.message.length < 200, err.message);
    assert.ok(err.message.includes('…'));
  });
});

describe('parseRangeGroups – PAGE_OUT_OF_RANGE', () => {
  test('page beyond pageCount (plural message)', () => {
    const err = expectToolError(() => parseRangeGroups('12', 10), 'PAGE_OUT_OF_RANGE');
    assert.equal(err.message, 'Seite 12 gibt es nicht – das Dokument hat nur 10 Seiten.');
    assert.deepEqual(err.details, { page: 12, pageCount: 10, token: '12' });
  });

  test('singular message for a one-page document', () => {
    const err = expectToolError(() => parseRangeGroups('2', 1), 'PAGE_OUT_OF_RANGE');
    assert.equal(err.message, 'Seite 2 gibt es nicht – das Dokument hat nur 1 Seite.');
  });

  test('page 0 explains that counting starts at 1', () => {
    const err = expectToolError(() => parseRangeGroups('0', 10), 'PAGE_OUT_OF_RANGE');
    assert.equal(err.message, 'Seite 0 gibt es nicht – die Seitenzählung beginnt bei 1.');
    assert.equal(err.details.page, 0);
    assert.equal(err.details.token, '0');
  });

  test('document without pages', () => {
    const err = expectToolError(() => parseRangeGroups('1', 0), 'PAGE_OUT_OF_RANGE');
    assert.match(err.message, /keine Seiten/);
  });

  const cases = [
    // [input, pageCount, offending page, token]
    ['11', 10, 11, '11'],
    ['000', 10, 0, '000'],
    ['-0', 10, 0, '-0'],
    ['0-3', 10, 0, '0-3'],
    ['3-0', 10, 0, '3-0'],
    ['3-11', 10, 11, '3-11'],
    ['12-3', 10, 12, '12-3'],
    ['11-', 10, 11, '11-'],
    ['-11', 10, 11, '-11'],
    ['-5', 3, 5, '-5'], // "negative" numbers are open ranges: "-5" means pages 1-5
    ['1, 2, 4', 3, 4, '4'],
    [' 4 - 2 ', 3, 4, '4 - 2'],
  ];
  for (const [input, pageCount, page, token] of cases) {
    test(`${JSON.stringify(input)} with ${pageCount} pages → page ${page}`, () => {
      const err = expectToolError(() => parseRangeGroups(input, pageCount), 'PAGE_OUT_OF_RANGE');
      assert.equal(err.details.page, page);
      assert.equal(err.details.pageCount, pageCount);
      assert.equal(err.details.token, token);
      assert.ok(err.message.startsWith(`Seite ${page} gibt es nicht – `), err.message);
    });
  }

  test('huge numbers are reported verbatim, not in exponent notation', () => {
    const digits = '99999999999999999999999';
    const err = expectToolError(() => parseRangeGroups(digits, 10), 'PAGE_OUT_OF_RANGE');
    assert.ok(err.message.includes(`Seite ${digits} `), err.message);
    assert.ok(!err.message.includes('e+'), err.message);
  });
});

describe('parseRangeGroups – programming errors', () => {
  for (const pageCount of [-1, 1.5, NaN, Infinity, '10', undefined, null]) {
    test(`invalid pageCount ${String(pageCount)} → TypeError`, () => {
      assert.throws(() => parseRangeGroups('1', pageCount), TypeError);
    });
  }
});

describe('parsePageList', () => {
  test('flattens the groups and keeps order and duplicates', () => {
    assert.deepEqual(parsePageList('1-3, 2, 5-4', 5), [0, 1, 2, 1, 4, 3]);
    assert.deepEqual(parsePageList('3, 1, 3', 3), [2, 0, 2]);
    assert.deepEqual(parsePageList('-2; 4-', 5), [0, 1, 3, 4]);
  });

  test('propagates parse errors', () => {
    expectToolError(() => parsePageList('', 5), 'EMPTY_INPUT');
    expectToolError(() => parsePageList('x', 5), 'INVALID_TOKEN');
    expectToolError(() => parsePageList('6', 5), 'PAGE_OUT_OF_RANGE');
  });
});

describe('chunkPages', () => {
  test('consecutive groups, last one shorter', () => {
    assert.deepEqual(chunkPages(10, 3), [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9]]);
  });

  test('exact multiple', () => {
    assert.deepEqual(chunkPages(6, 2), [[0, 1], [2, 3], [4, 5]]);
  });

  test('size 1 equals single pages', () => {
    assert.deepEqual(chunkPages(4, 1), singlePageGroups(4));
  });

  test('size larger than pageCount gives one group with all pages', () => {
    assert.deepEqual(chunkPages(3, 5), [[0, 1, 2]]);
    assert.deepEqual(chunkPages(3, 3), [[0, 1, 2]]);
    assert.deepEqual(chunkPages(1, 1000), [[0]]);
  });

  test('zero pages gives no groups', () => {
    assert.deepEqual(chunkPages(0, 3), []);
  });

  test('accepts a string of digits (value of an <input type=number>)', () => {
    assert.deepEqual(chunkPages(5, '2'), [[0, 1], [2, 3], [4]]);
    assert.deepEqual(chunkPages(5, ' 4 '), [[0, 1, 2, 3], [4]]);
  });

  for (const size of [0, -1, -3, 1.5, 0.5, NaN, Infinity, -Infinity, null, undefined, '', 'abc', '0', '1.5', '-2', {}, [2]]) {
    test(`invalid size ${JSON.stringify(size) ?? String(size)} → INVALID_CHUNK_SIZE`, () => {
      const err = expectToolError(() => chunkPages(10, size), 'INVALID_CHUNK_SIZE');
      assert.equal(err.message, 'Bitte gib als Seitenanzahl pro Datei eine ganze Zahl ab 1 an.');
      assert.ok('size' in err.details);
    });
  }

  test('invalid pageCount → TypeError', () => {
    assert.throws(() => chunkPages(-1, 2), TypeError);
    assert.throws(() => chunkPages(2.5, 2), TypeError);
  });
});

describe('singlePageGroups', () => {
  test('one group per page', () => {
    assert.deepEqual(singlePageGroups(3), [[0], [1], [2]]);
    assert.deepEqual(singlePageGroups(1), [[0]]);
    assert.deepEqual(singlePageGroups(0), []);
  });

  test('invalid pageCount → TypeError', () => {
    assert.throws(() => singlePageGroups(-1), TypeError);
  });
});

describe('formatPageGroup', () => {
  const cases = [
    [[], ''],
    [[0], '1'],
    [[9], '10'],
    [[0, 1], '1-2'],
    [[0, 1, 2], '1-3'],
    [[4, 3, 2], '5-3'],
    [[1, 0], '2-1'],
    [[0, 2, 4], '1, 3, 5'],
    [[0, 0], '1, 1'],
    [[0, 1, 2, 4, 8, 7, 6], '1-3, 5, 9-7'],
    [[2, 1, 2, 3], '3-2, 3-4'],
    [[0, 1, 2, 1, 0], '1-3, 2-1'],
    [[5, 6, 7, 0, 1], '6-8, 1-2'],
  ];
  for (const [group, expected] of cases) {
    test(`${JSON.stringify(group)} → ${JSON.stringify(expected)}`, () => {
      assert.equal(formatPageGroup(group), expected);
    });
  }

  test('round-trips through parseRangeGroups (random groups)', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const pageCount = 25;
    for (let run = 0; run < 300; run++) {
      const length = 1 + Math.floor(random() * 20);
      const group = [];
      let current = Math.floor(random() * pageCount);
      for (let i = 0; i < length; i++) {
        const r = random();
        if (r < 0.35) current = Math.min(pageCount - 1, current + 1);
        else if (r < 0.6) current = Math.max(0, current - 1);
        else current = Math.floor(random() * pageCount);
        group.push(current);
      }
      const label = formatPageGroup(group);
      assert.deepEqual(parsePageList(label, pageCount), group, `label ${label}`);
    }
  });
});

describe('formatPageGroupForFilename', () => {
  test('compact, filename-safe labels', () => {
    assert.equal(formatPageGroupForFilename([0, 1, 2]), 'S1-3');
    assert.equal(formatPageGroupForFilename([4]), 'S5');
    assert.equal(formatPageGroupForFilename([4, 3, 2]), 'S5-3');
    assert.equal(formatPageGroupForFilename([0, 1, 2, 4, 8, 7, 6]), 'S1-3_5_9-7');
    assert.equal(formatPageGroupForFilename([]), '');
  });

  test('labels up to 60 characters are kept, longer ones are cut at a token boundary', () => {
    const odd = (count) => Array.from({ length: count }, (_, i) => i * 2); // pages 1, 3, 5, …
    let sawShort = false;
    let sawLong = false;
    for (let count = 1; count <= 60; count++) {
      const group = odd(count);
      const full = `S${formatPageGroup(group).split(', ').join('_')}`;
      const label = formatPageGroupForFilename(group);
      assert.match(label, /^[A-Za-z0-9_-]+$/);
      assert.ok(label.length <= 60, `${label} is ${label.length} chars long`);
      if (full.length <= 60) {
        sawShort = true;
        assert.equal(label, full);
      } else {
        sawLong = true;
        assert.ok(label.endsWith('_usw'), label);
        const kept = label.slice(0, -'_usw'.length);
        assert.ok(full.startsWith(`${kept}_`), `${kept} is not a token prefix of ${full}`);
        // As many tokens as possible were kept.
        const nextToken = full.slice(kept.length + 1).split('_')[0];
        assert.ok(`${kept}_${nextToken}_usw`.length > 60);
      }
    }
    assert.ok(sawShort && sawLong);
  });

  test('boundary: exactly 60 characters are kept, 61+ are truncated', () => {
    // "S100-102" (8 chars) followed by 13 tokens "_401", "_403", … (4 chars each) = 60 chars.
    const exact = [99, 100, 101];
    for (let i = 0; i < 13; i++) exact.push(400 + i * 2);
    const label = formatPageGroupForFilename(exact);
    assert.equal(label.length, 60);
    assert.equal(label, `S100-102_${exact.slice(3).map((index) => index + 1).join('_')}`);

    const longer = [...exact, 450]; // one more token → 64 chars → truncated
    const truncated = formatPageGroupForFilename(longer);
    assert.ok(truncated.endsWith('_usw'), truncated);
    assert.ok(truncated.length <= 60);
    assert.ok(label.startsWith(truncated.slice(0, -'_usw'.length)));
  });
});

describe('formatPageCount', () => {
  test('singular and plural', () => {
    assert.equal(formatPageCount(1), '1 Seite');
    assert.equal(formatPageCount(0), '0 Seiten');
    assert.equal(formatPageCount(2), '2 Seiten');
    assert.equal(formatPageCount(27), '27 Seiten');
  });
});

describe('module surface', () => {
  test('exports everything the contract requires', () => {
    const required = [
      'PdfToolError',
      'parseRangeGroups',
      'parsePageList',
      'chunkPages',
      'singlePageGroups',
      'formatPageGroup',
      'formatPageGroupForFilename',
      'sanitizeFileName',
      'stripPdfExtension',
      'ensurePdfExtension',
      'uniqueFileNames',
      'looksLikePdf',
      'loadPdf',
      'getPageCount',
      'mergePdfs',
      'extractPages',
      'splitPdf',
      'describeError',
    ];
    for (const name of required) assert.equal(typeof core[name], 'function', name);
    assert.ok(Object.isFrozen(core));
  });

  test('ERROR_CODES lists exactly the contract codes', () => {
    assert.deepEqual(Object.keys(core.ERROR_CODES).sort(), [
      'EMPTY_GROUP',
      'EMPTY_INPUT',
      'ENCRYPTED',
      'INVALID_CHUNK_SIZE',
      'INVALID_PDF',
      'INVALID_TOKEN',
      'NOT_A_PDF',
      'NO_PAGES',
      'NO_SOURCES',
      'PAGE_OUT_OF_RANGE',
    ]);
    for (const [key, value] of Object.entries(core.ERROR_CODES)) assert.equal(key, value);
  });

  test('PdfToolError carries code and details', () => {
    const err = new PdfToolError('EMPTY_INPUT', 'Nachricht', { a: 1 });
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'PdfToolError');
    assert.equal(err.code, 'EMPTY_INPUT');
    assert.equal(err.message, 'Nachricht');
    assert.deepEqual(err.details, { a: 1 });
    assert.deepEqual(new PdfToolError('X', 'y').details, {});
  });
});

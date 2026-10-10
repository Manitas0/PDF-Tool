/*!
 * PDF-Tool – core logic (pure functions, no DOM access).
 *
 * Parses page-range expressions, builds file names and merges/splits PDFs
 * with pdf-lib. Conventions:
 *   - page numbers in user-facing strings are 1-based,
 *   - arrays of page indices are 0-based.
 *
 * UMD: in Node `module.exports = factory(require('pdf-lib'))`,
 * in the browser (classic <script>) `globalThis.PdfCore = factory(globalThis.PDFLib)`.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module !== null && module.exports) {
    module.exports = factory(require('pdf-lib'));
  } else {
    root.PdfCore = factory(root.PDFLib);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (injectedPdfLib) {
  'use strict';

  /** Value written to the Producer and Creator fields of every generated PDF. */
  const PRODUCER = 'PDF-Tool';

  const ERROR_CODES = Object.freeze({
    EMPTY_INPUT: 'EMPTY_INPUT',
    INVALID_TOKEN: 'INVALID_TOKEN',
    PAGE_OUT_OF_RANGE: 'PAGE_OUT_OF_RANGE',
    INVALID_CHUNK_SIZE: 'INVALID_CHUNK_SIZE',
    NOT_A_PDF: 'NOT_A_PDF',
    ENCRYPTED: 'ENCRYPTED',
    INVALID_PDF: 'INVALID_PDF',
    NO_PAGES: 'NO_PAGES',
    NO_SOURCES: 'NO_SOURCES',
    EMPTY_GROUP: 'EMPTY_GROUP',
  });

  /**
   * Error with a machine-readable `code` and a German, user-presentable message.
   */
  class PdfToolError extends Error {
    /**
     * @param {string} code    one of ERROR_CODES
     * @param {string} message German message that can be shown to the user as is
     * @param {object} [details] additional structured information
     */
    constructor(code, message, details) {
      super(message);
      this.name = 'PdfToolError';
      this.code = code;
      this.details = details || {};
    }
  }

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  /** Resolves pdf-lib lazily so that the pure helpers work even without it. */
  function getPdfLib() {
    const lib = injectedPdfLib || (typeof globalThis !== 'undefined' ? globalThis.PDFLib : undefined);
    if (!lib || !lib.PDFDocument) {
      throw new Error('Die Bibliothek pdf-lib wurde nicht geladen.');
    }
    return lib;
  }

  /** „1 Seite“ / „12 Seiten“ */
  function formatPageCount(count) {
    return count === 1 ? '1 Seite' : `${count} Seiten`;
  }

  function withFileName(message, fileName) {
    return fileName ? `„${fileName}“: ${message}` : message;
  }

  function fileNameDetails(fileName, details) {
    return fileName ? Object.assign({ fileName }, details) : Object.assign({}, details);
  }

  function assertPageCount(pageCount) {
    if (!Number.isInteger(pageCount) || pageCount < 0) {
      throw new TypeError(`pageCount muss eine nicht-negative ganze Zahl sein (erhalten: ${String(pageCount)}).`);
    }
  }

  /** Shortens long user input for display inside an error message. */
  function abbreviate(text, maxLength) {
    const chars = Array.from(text);
    return chars.length > maxLength ? `${chars.slice(0, maxLength - 1).join('')}…` : text;
  }

  function pageOutOfRangeError(page, pageCount, extra, fileName) {
    const label = extra.label !== undefined ? extra.label : String(page);
    let message;
    if (page < 1) {
      message = `Seite ${label} gibt es nicht – die Seitenzählung beginnt bei 1.`;
    } else if (pageCount === 0) {
      message = `Seite ${label} gibt es nicht – das Dokument hat keine Seiten.`;
    } else {
      message = `Seite ${label} gibt es nicht – das Dokument hat nur ${formatPageCount(pageCount)}.`;
    }
    const details = { page, pageCount };
    if (extra.token !== undefined) details.token = extra.token;
    if (extra.groupIndex !== undefined) details.groupIndex = extra.groupIndex;
    return new PdfToolError(
      ERROR_CODES.PAGE_OUT_OF_RANGE,
      withFileName(message, fileName),
      fileNameDetails(fileName, details)
    );
  }

  /** Inclusive 0-based index range from `from` to `to` (both 1-based), ascending or descending. */
  function expandRange(from, to) {
    const step = from <= to ? 1 : -1;
    const length = Math.abs(to - from) + 1;
    const indices = new Array(length);
    for (let i = 0; i < length; i++) indices[i] = from - 1 + i * step;
    return indices;
  }

  // ---------------------------------------------------------------------------
  // Page range parsing
  // ---------------------------------------------------------------------------

  const TOKEN_SEPARATOR = /[,;]/;
  const SINGLE_PAGE = /^\d+$/;
  // "A-B", "A-", "-B" with "-", "–" (en dash) or "—" (em dash); whitespace allowed around the dash.
  const PAGE_RANGE = /^(\d*)\s*[-\u2013\u2014]\s*(\d*)$/;

  function parsePageNumber(digits) {
    const normalized = digits.replace(/^0+(?=\d)/, '');
    return { page: Number(normalized), label: normalized };
  }

  /**
   * Parses an expression such as "1-3, 5, 9-7, 12-" into one group of
   * 0-based page indices per token.
   *
   * @param {string} input
   * @param {number} pageCount number of pages of the document
   * @returns {number[][]}
   */
  function parseRangeGroups(input, pageCount) {
    assertPageCount(pageCount);
    const text = input === undefined || input === null ? '' : String(input);
    const tokens = text
      .split(TOKEN_SEPARATOR)
      .map((token) => token.trim())
      .filter((token) => token !== '');

    if (tokens.length === 0) {
      throw new PdfToolError(
        ERROR_CODES.EMPTY_INPUT,
        'Bitte gib mindestens eine Seite oder einen Seitenbereich an, z. B. „1-3, 5“.'
      );
    }

    return tokens.map((token) => {
      const checkPage = ({ page, label }) => {
        if (!(page >= 1 && page <= pageCount)) {
          throw pageOutOfRangeError(page, pageCount, { token, label });
        }
        return page;
      };

      if (SINGLE_PAGE.test(token)) {
        const page = checkPage(parsePageNumber(token));
        return [page - 1];
      }

      const match = PAGE_RANGE.exec(token);
      if (match && (match[1] !== '' || match[2] !== '')) {
        const from = match[1] === '' ? 1 : checkPage(parsePageNumber(match[1]));
        const to = match[2] === '' ? pageCount : checkPage(parsePageNumber(match[2]));
        // "A-" on a document with fewer than A pages is caught by checkPage above;
        // "-B" always starts at page 1, which exists whenever B is valid.
        return expandRange(from, to);
      }

      throw new PdfToolError(
        ERROR_CODES.INVALID_TOKEN,
        `„${abbreviate(token, 30)}“ ist keine gültige Seitenangabe. ` +
          'Erlaubt sind einzelne Seiten (3) und Bereiche (1-5, 8-6, 7-, -4), getrennt durch Kommas.',
        { token }
      );
    });
  }

  /**
   * Like parseRangeGroups, but flattened into one list (order and duplicates kept).
   * @returns {number[]}
   */
  function parsePageList(input, pageCount) {
    return parseRangeGroups(input, pageCount).flat();
  }

  /**
   * Consecutive groups of `size` pages; the last group may be shorter.
   * @param {number} pageCount
   * @param {number} size integer >= 1 (a string of digits is accepted as well)
   * @returns {number[][]}
   */
  function chunkPages(pageCount, size) {
    assertPageCount(pageCount);
    const numericSize = typeof size === 'string' && /^\s*\d+\s*$/.test(size) ? Number(size) : size;
    if (!Number.isInteger(numericSize) || numericSize < 1) {
      throw new PdfToolError(
        ERROR_CODES.INVALID_CHUNK_SIZE,
        'Bitte gib als Seitenanzahl pro Datei eine ganze Zahl ab 1 an.',
        { size }
      );
    }
    const groups = [];
    for (let start = 0; start < pageCount; start += numericSize) {
      const end = Math.min(start + numericSize, pageCount);
      groups.push(expandRange(start + 1, end));
    }
    return groups;
  }

  /** `[[0], [1], …]` – one group per page. */
  function singlePageGroups(pageCount) {
    assertPageCount(pageCount);
    const groups = new Array(pageCount);
    for (let i = 0; i < pageCount; i++) groups[i] = [i];
    return groups;
  }

  // ---------------------------------------------------------------------------
  // Labels
  // ---------------------------------------------------------------------------

  /** Splits 0-based indices into runs of consecutive pages and returns 1-based labels. */
  function pageGroupTokens(group) {
    const tokens = [];
    let i = 0;
    while (i < group.length) {
      const start = group[i];
      let end = start;
      let j = i + 1;
      if (j < group.length && Math.abs(group[j] - start) === 1) {
        const step = group[j] - start;
        while (j < group.length && group[j] - group[j - 1] === step) {
          end = group[j];
          j++;
        }
      }
      tokens.push(start === end ? `${start + 1}` : `${start + 1}-${end + 1}`);
      i = j;
    }
    return tokens;
  }

  /**
   * Compact 1-based label, e.g. [0,1,2,4,8,7,6] → "1-3, 5, 9-7".
   * @param {number[]} group 0-based page indices
   */
  function formatPageGroup(group) {
    return pageGroupTokens(group || []).join(', ');
  }

  const FILENAME_LABEL_MAX = 60;
  const FILENAME_LABEL_MORE = '_usw';

  /**
   * File-name safe label, e.g. [0,1,2,4,8,7,6] → "S1-3_5_9-7".
   * Labels longer than 60 characters are cut at a token boundary and get "_usw" appended.
   * @param {number[]} group 0-based page indices
   */
  function formatPageGroupForFilename(group) {
    const tokens = pageGroupTokens(group || []);
    if (tokens.length === 0) return '';
    const full = `S${tokens.join('_')}`;
    if (full.length <= FILENAME_LABEL_MAX) return full;

    let label = `S${tokens[0]}`;
    for (let i = 1; i < tokens.length; i++) {
      const candidate = `${label}_${tokens[i]}`;
      if (candidate.length + FILENAME_LABEL_MORE.length > FILENAME_LABEL_MAX) break;
      label = candidate;
    }
    return label + FILENAME_LABEL_MORE;
  }

  // ---------------------------------------------------------------------------
  // File names
  // ---------------------------------------------------------------------------

  const FILENAME_MAX = 120;
  // C0/C1 control characters, bidi controls (extension spoofing such as "abc\u202Efdp.exe"),
  // zero-width space/BOM and characters that are reserved on common file systems.
  const FORBIDDEN_FILENAME_CHARS =
    /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff<>:"/\\|?*]/g;
  const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

  /** Splits "name.ext" into { stem: "name", ext: ".ext" }; a leading dot does not start an extension. */
  function splitExtension(name) {
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || dot === name.length - 1) return { stem: name, ext: '' };
    const ext = name.slice(dot);
    if (ext.length > 11 || /\s/.test(ext)) return { stem: name, ext: '' };
    return { stem: name.slice(0, dot), ext };
  }

  /** Cuts a string to at most `maxLength` UTF-16 code units without splitting a surrogate pair. */
  function truncateCodeUnits(text, maxLength) {
    if (text.length <= maxLength) return text;
    let cut = maxLength;
    const code = text.charCodeAt(cut - 1);
    if (code >= 0xd800 && code <= 0xdbff) cut -= 1;
    return text.slice(0, cut);
  }

  function trimDotsAndSpaces(text) {
    return text.replace(/^[.\s]+|[.\s]+$/g, '');
  }

  /**
   * Makes a user-supplied name safe to use as a download file name.
   * @param {string} name
   * @param {string} [fallback='dokument'] used when nothing usable is left
   */
  function sanitizeFileName(name, fallback) {
    const fallbackName = fallback === undefined ? 'dokument' : String(fallback);
    let text = name === undefined || name === null ? '' : String(name);
    if (typeof text.normalize === 'function') text = text.normalize('NFC');

    // Drop directory parts ("C:\Users\x\a.pdf", "../a.pdf").
    text = text.slice(Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\')) + 1);
    // Whitespace (tabs, line breaks, NBSP …) becomes a plain space before control characters
    // are removed, so that words separated by a tab do not get glued together.
    text = text.replace(/\s+/g, ' ');
    text = text.replace(FORBIDDEN_FILENAME_CHARS, '');
    text = text.replace(/ {2,}/g, ' ').trim();

    // A bare extension such as ".pdf" becomes "dokument.pdf" instead of "pdf".
    const bareExtension = /^\.+([^.\s]{1,10})$/.exec(text);
    if (bareExtension && fallbackName) {
      text = `${fallbackName}.${bareExtension[1]}`;
    }

    text = trimDotsAndSpaces(text);
    if (text === '') return fallbackName;

    let { stem, ext } = splitExtension(text);
    stem = stem.replace(/[\s.]+$/, ''); // "Bericht .pdf" / "Bericht..pdf" → "Bericht.pdf"
    if (WINDOWS_RESERVED_NAME.test(stem.split('.')[0])) stem = `_${stem}`;

    if (stem.length + ext.length > FILENAME_MAX) {
      stem = trimDotsAndSpaces(truncateCodeUnits(stem, Math.max(1, FILENAME_MAX - ext.length)));
      if (stem === '') stem = fallbackName;
    }
    return stem + ext;
  }

  /** "Bericht.PDF" → "Bericht" (case-insensitive). */
  function stripPdfExtension(name) {
    return String(name === undefined || name === null ? '' : name).replace(/\.pdf$/i, '');
  }

  /** "Bericht" → "Bericht.pdf"; names that already end in ".pdf" (any case) are kept. */
  function ensurePdfExtension(name) {
    const text = String(name === undefined || name === null ? '' : name);
    if (/\.pdf$/i.test(text)) return text;
    return `${text.replace(/[.\s]+$/, '')}.pdf`;
  }

  function fileNameKey(name) {
    const text = typeof name.normalize === 'function' ? name.normalize('NFC') : name;
    return text.toLowerCase();
  }

  /**
   * Disambiguates duplicate names (case-insensitive): "a.pdf", "a (2).pdf", "a (3).pdf".
   * Names that already occur in the input are never generated for a duplicate.
   * @param {string[]} names
   * @returns {string[]}
   */
  function uniqueFileNames(names) {
    const list = Array.from(names || [], (name) => String(name));
    const reserved = new Set(list.map(fileNameKey));
    const used = new Set();
    return list.map((name) => {
      const key = fileNameKey(name);
      if (!used.has(key)) {
        used.add(key);
        return name;
      }
      const { stem, ext } = splitExtension(name);
      for (let n = 2; ; n++) {
        const candidate = `${stem} (${n})${ext}`;
        const candidateKey = fileNameKey(candidate);
        if (!used.has(candidateKey) && !reserved.has(candidateKey)) {
          used.add(candidateKey);
          return candidate;
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // PDF handling
  // ---------------------------------------------------------------------------

  /** Returns a Uint8Array view of the given bytes (realm independent), or null. */
  function toUint8Array(bytes) {
    if (!bytes) return null;
    if (ArrayBuffer.isView(bytes)) {
      // Plain Uint8Arrays are used as is; Node Buffers, other typed arrays, DataViews and
      // views from another realm get a plain Uint8Array view on the same memory (no copy).
      return Object.getPrototypeOf(bytes) === Uint8Array.prototype
        ? bytes
        : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    }
    if (Object.prototype.toString.call(bytes) === '[object ArrayBuffer]') {
      return new Uint8Array(bytes);
    }
    return null;
  }

  const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  const SIGNATURE_SEARCH_LIMIT = 1024;

  function indexOfBytes(data, pattern, start, end) {
    const last = Math.min(end, data.length) - pattern.length;
    outer: for (let i = start; i <= last; i++) {
      for (let k = 0; k < pattern.length; k++) {
        if (data[i + k] !== pattern[k]) continue outer;
      }
      return i;
    }
    return -1;
  }

  /**
   * True if "%PDF-" occurs within the first 1024 bytes.
   * @param {Uint8Array|ArrayBuffer} bytes
   */
  function looksLikePdf(bytes) {
    const data = toUint8Array(bytes);
    if (!data) return false;
    return indexOfBytes(data, PDF_SIGNATURE, 0, SIGNATURE_SEARCH_LIMIT) !== -1;
  }

  const ENCRYPT_KEY = Array.from('/Encrypt', (c) => c.charCodeAt(0));

  function isPdfDelimiterOrWhitespace(byte) {
    // whitespace: NUL, TAB, LF, FF, CR, SPACE; delimiters: ( ) < > [ ] { } / %
    return (
      byte === undefined ||
      byte === 0x00 || byte === 0x09 || byte === 0x0a || byte === 0x0c || byte === 0x0d || byte === 0x20 ||
      byte === 0x28 || byte === 0x29 || byte === 0x3c || byte === 0x3e || byte === 0x5b || byte === 0x5d ||
      byte === 0x7b || byte === 0x7d || byte === 0x2f || byte === 0x25
    );
  }

  /** Detects an /Encrypt entry (trailer or xref stream dictionary) when pdf-lib failed to parse. */
  function containsEncryptKey(data) {
    let from = 0;
    for (;;) {
      const index = indexOfBytes(data, ENCRYPT_KEY, from, data.length);
      if (index === -1) return false;
      if (isPdfDelimiterOrWhitespace(data[index + ENCRYPT_KEY.length])) return true;
      from = index + 1;
    }
  }

  function isEncryptedPdfError(err, lib) {
    if (!err) return false;
    // pdf-lib is transpiled to ES5, so `instanceof` fails for its Error subclasses;
    // fall back to the (stable) message text.
    if (lib.EncryptedPDFError && err instanceof lib.EncryptedPDFError) return true;
    return typeof err.message === 'string' && /\bis encrypted\b/i.test(err.message);
  }

  /**
   * Loads a PDF with pdf-lib and converts all failures into PdfToolErrors.
   * @param {Uint8Array|ArrayBuffer} bytes
   * @param {{ fileName?: string }} [opts]
   * @returns {Promise<import('pdf-lib').PDFDocument>}
   */
  async function loadPdf(bytes, opts) {
    const fileName = (opts && opts.fileName) || undefined;
    const lib = getPdfLib();
    const data = toUint8Array(bytes);

    if (!data || !looksLikePdf(data)) {
      throw new PdfToolError(
        ERROR_CODES.NOT_A_PDF,
        withFileName('Die Datei ist keine PDF-Datei.', fileName),
        fileNameDetails(fileName)
      );
    }

    let doc;
    let pageCount;
    try {
      doc = await lib.PDFDocument.load(data, { updateMetadata: false });
      pageCount = doc.getPageCount(); // walks the page tree, so broken trees fail here
    } catch (err) {
      if (isEncryptedPdfError(err, lib) || containsEncryptKey(data)) {
        throw new PdfToolError(
          ERROR_CODES.ENCRYPTED,
          withFileName(
            'Die PDF-Datei ist verschlüsselt bzw. passwortgeschützt und kann nicht bearbeitet werden.',
            fileName
          ),
          fileNameDetails(fileName)
        );
      }
      throw new PdfToolError(
        ERROR_CODES.INVALID_PDF,
        withFileName('Die PDF-Datei ist beschädigt oder kann nicht gelesen werden.', fileName),
        fileNameDetails(fileName, { cause: err && err.message ? err.message : String(err) })
      );
    }

    if (pageCount === 0) {
      throw new PdfToolError(
        ERROR_CODES.NO_PAGES,
        withFileName('Die PDF-Datei enthält keine Seiten.', fileName),
        fileNameDetails(fileName)
      );
    }
    return doc;
  }

  /** Number of pages of a PDF (throws the same errors as loadPdf). */
  async function getPageCount(bytes, opts) {
    const doc = await loadPdf(bytes, opts);
    return doc.getPageCount();
  }

  /**
   * Checks a list of 0-based page indices against a document and returns a copy of it
   * (a plain array of this realm, as pdf-lib checks `instanceof Array`).
   */
  function validatePageIndices(pages, pageCount, fileName, groupIndex) {
    const extra = groupIndex === undefined ? {} : { groupIndex };
    if (!Array.isArray(pages) || pages.length === 0) {
      const message = groupIndex === undefined
        ? 'Es sind keine Seiten ausgewählt.'
        : `Ausgabedatei ${groupIndex + 1} enthält keine Seiten.`;
      throw new PdfToolError(
        ERROR_CODES.EMPTY_GROUP,
        withFileName(message, fileName),
        fileNameDetails(fileName, extra)
      );
    }
    for (const index of pages) {
      if (!Number.isInteger(index) || index < 0 || index >= pageCount) {
        const page = typeof index === 'number' ? index + 1 : NaN;
        throw pageOutOfRangeError(page, pageCount, Object.assign({ label: String(page) }, extra), fileName);
      }
    }
    return Array.from(pages);
  }

  async function createOutputDocument(lib, title) {
    const doc = await lib.PDFDocument.create();
    doc.setProducer(PRODUCER);
    doc.setCreator(PRODUCER);
    if (typeof title === 'string' && title.trim() !== '') doc.setTitle(title.trim());
    return doc;
  }

  async function appendPages(target, source, indices) {
    const copied = await target.copyPages(source, indices);
    for (const page of copied) target.addPage(page);
  }

  /**
   * Merges several PDFs (or page selections of them) into one.
   * @param {Array<{ bytes: Uint8Array|ArrayBuffer, pages?: number[], name?: string }>} sources
   * @param {{ title?: string }} [opts]
   * @returns {Promise<Uint8Array>}
   */
  async function mergePdfs(sources, opts) {
    const title = opts && opts.title;
    if (!Array.isArray(sources) || sources.length === 0) {
      throw new PdfToolError(ERROR_CODES.NO_SOURCES, 'Bitte füge mindestens eine PDF-Datei hinzu.');
    }
    // Snapshot the input: the caller may modify its arrays while we are awaiting.
    const entries = sources.map((source) => ({
      bytes: source ? source.bytes : undefined,
      name: (source && source.name) || undefined,
      pages: source && Array.isArray(source.pages) ? Array.from(source.pages) : source && source.pages,
    }));
    const lib = getPdfLib();
    const loaded = new Map(); // same bytes object → loaded only once
    const output = await createOutputDocument(lib, title);

    for (const { bytes, name, pages } of entries) {
      let doc = bytes ? loaded.get(bytes) : undefined;
      if (!doc) {
        doc = await loadPdf(bytes, { fileName: name });
        loaded.set(bytes, doc);
      }
      const pageCount = doc.getPageCount();
      const indices = pages === undefined || pages === null
        ? expandRange(1, pageCount)
        : validatePageIndices(pages, pageCount, name);
      await appendPages(output, doc, indices);
    }
    return output.save();
  }

  /**
   * A single PDF consisting of exactly the given pages in the given order.
   * @param {Uint8Array|ArrayBuffer} bytes
   * @param {number[]} pages 0-based page indices
   * @param {{ fileName?: string, title?: string }} [opts]
   * @returns {Promise<Uint8Array>}
   */
  async function extractPages(bytes, pages, opts) {
    const fileName = (opts && opts.fileName) || undefined;
    if (!Array.isArray(pages) || pages.length === 0) {
      validatePageIndices(pages, 0, fileName);
    }
    return mergePdfs([{ bytes, pages, name: fileName }], { title: opts && opts.title });
  }

  /**
   * Splits a PDF into one output PDF per group. The source is loaded only once.
   * @param {Uint8Array|ArrayBuffer} bytes
   * @param {number[][]} groups 0-based page indices per output file
   * @param {{ fileName?: string }} [opts]
   * @returns {Promise<Uint8Array[]>}
   */
  async function splitPdf(bytes, groups, opts) {
    const fileName = (opts && opts.fileName) || undefined;
    if (!Array.isArray(groups) || groups.length === 0) {
      throw new PdfToolError(
        ERROR_CODES.EMPTY_GROUP,
        withFileName('Es wurden keine Seiten zum Teilen angegeben.', fileName),
        fileNameDetails(fileName)
      );
    }
    // Snapshot the groups (the caller may modify its arrays while we are awaiting) and
    // reject empty groups before doing any expensive work.
    const snapshot = groups.map((group) => (Array.isArray(group) ? Array.from(group) : group));
    snapshot.forEach((group, groupIndex) => {
      if (!Array.isArray(group) || group.length === 0) validatePageIndices(group, 0, fileName, groupIndex);
    });

    const lib = getPdfLib();
    const source = await loadPdf(bytes, { fileName });
    const pageCount = source.getPageCount();
    const validGroups = snapshot.map((group, groupIndex) =>
      validatePageIndices(group, pageCount, fileName, groupIndex)
    );

    const outputs = [];
    for (const group of validGroups) {
      const output = await createOutputDocument(lib);
      await appendPages(output, source, group);
      outputs.push(await output.save());
    }
    return outputs;
  }

  /**
   * German, user-presentable message for any error.
   * @param {unknown} err
   * @returns {string}
   */
  function describeError(err) {
    if (err instanceof PdfToolError || (err && err.name === 'PdfToolError' && typeof err.message === 'string')) {
      return err.message;
    }
    let detail = '';
    if (err && typeof err.message === 'string') detail = err.message;
    else if (err !== undefined && err !== null) detail = String(err);
    return detail ? `Unerwarteter Fehler: ${detail}` : 'Unerwarteter Fehler.';
  }

  return Object.freeze({
    PRODUCER,
    ERROR_CODES,
    PdfToolError,
    parseRangeGroups,
    parsePageList,
    chunkPages,
    singlePageGroups,
    formatPageGroup,
    formatPageGroupForFilename,
    formatPageCount,
    sanitizeFileName,
    stripPdfExtension,
    ensurePdfExtension,
    uniqueFileNames,
    looksLikePdf,
    loadPdf,
    getPageCount,
    mergePdfs,
    extractPages,
    splitPdf,
    describeError,
  });
});

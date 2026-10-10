// Regression tests for js/pdf-core.js with PDFs whose structure goes beyond plain pages:
//   - outputs must not contain anything of pages that were not selected (links, form fields,
//     shared or inherited resources would otherwise pull them in, invisible but readable),
//   - hidden layers (optional content) must stay hidden,
//   - the page tree is read like pdf.js reads it (untyped pages count, cycles/DAGs are rejected).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../../js/pdf-core.js');
const {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFString,
  decodePDFRawStream,
} = require('pdf-lib');
const { PdfToolError, loadPdf, getPageCount, mergePdfs, splitPdf, extractPages, singlePageGroups } = core;

const name = (text) => PDFName.of(text);

// pdf-lib logs a warning for every object it cannot parse; keep the test output readable.
let originalWarn;
before(() => {
  originalWarn = console.warn;
  console.warn = () => {};
});
after(() => {
  console.warn = originalWarn;
});

/**
 * Loads an output PDF and returns the number of page objects in the file (visible or not)
 * and all of its text: every object in PDF syntax plus the decoded content of every stream.
 */
async function inspect(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  let pageObjects = 0;
  let text = '';
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFDict ? object : object.dict;
    if (dict && dict.get(name('Type')) === name('Page')) pageObjects++;
    text += object instanceof PDFRawStream
      ? `${object.dict}\n${Buffer.from(decodePDFRawStream(object).decode()).toString('latin1')}\n`
      : `${object}\n`;
  }
  return { doc, pageObjects, text };
}

async function pageWidths(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  return doc.getPages().map((page) => page.getWidth());
}

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

function addAnnot(page, annot) {
  const context = page.node.context;
  const annots = page.node.lookup(name('Annots'));
  const ref = context.register(annot);
  if (annots instanceof PDFArray) annots.push(ref);
  else page.node.set(name('Annots'), context.obj([ref]));
}

/** The /Dest of a link annotation, or the /D of its GoTo action. */
function linkDestination(annot) {
  return annot.lookupMaybe(name('Dest'), PDFArray) || annot.lookup(name('A'), PDFDict).lookup(name('D'), PDFArray);
}

function annotsOf(page) {
  const annots = page.node.lookup(name('Annots'));
  return annots instanceof PDFArray ? annots.asArray().map((ref) => page.node.context.lookup(ref)) : [];
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * 3 pages (widths 100-102) with the text PAGE1_TEXT … PAGE3_TEXT. Page 1 links to page 3
 * (/Dest), page 3 links back to page 1 (GoTo action). Page 3 also shows a 30 KB image.
 */
async function makeLinkedPdf() {
  const doc = await PDFDocument.create();
  const context = doc.context;
  const font = context.register(context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  const image = context.register(
    context.stream('PAGE3_IMAGE'.padEnd(100 * 100 * 3, '.'), {
      Type: 'XObject', Subtype: 'Image', Width: 100, Height: 100, ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
    })
  );
  const pages = [];
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([100 + i, 200]);
    const showImage = i === 2 ? 'q 50 0 0 50 0 0 cm /Im1 Do Q ' : '';
    page.node.set(name('Resources'), context.obj(i === 2 ? { Font: { F1: font }, XObject: { Im1: image } } : { Font: { F1: font } }));
    page.node.set(name('Contents'), context.register(context.stream(`${showImage}BT /F1 12 Tf 10 10 Td (PAGE${i + 1}_TEXT) Tj ET`)));
    pages.push(page);
  }
  addAnnot(pages[0], context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], Dest: [pages[2].ref, 'Fit'] }));
  addAnnot(pages[2], context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], A: { S: 'GoTo', D: [pages[0].ref, 'XYZ', null, null, null] },
  }));
  return doc.save();
}

/**
 * 3 pages, one text field widget per page (values VALUE1 … VALUE3) below a common parent field
 * „antrag“ (hierarchical names „antrag.feld1“ …) that holds the inheritable /FT and /DA.
 */
async function makeFormPdf() {
  const doc = await PDFDocument.create();
  const context = doc.context;
  const font = context.register(context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  const parentRef = context.nextRef();
  const widgets = [];
  for (let i = 0; i < 3; i++) {
    const page = doc.addPage([100 + i, 200]);
    page.node.set(name('Resources'), context.obj({ Font: { F1: font } }));
    page.node.set(name('Contents'), context.register(context.stream(`BT /F1 12 Tf 10 100 Td (PAGE${i + 1}_TEXT) Tj ET`)));
    const appearance = context.register(
      context.stream(`BT /F1 10 Tf 2 2 Td (VALUE${i + 1}) Tj ET`, {
        Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 80, 20], Resources: { Font: { F1: font } },
      })
    );
    const widget = context.register(context.obj({
      Type: 'Annot',
      Subtype: 'Widget',
      T: PDFString.of(`feld${i + 1}`),
      V: PDFString.of(`VALUE${i + 1}`),
      Rect: [10, 10, 90, 30],
      F: 4,
      P: page.ref,
      Parent: parentRef,
      AP: { N: appearance },
    }));
    page.node.set(name('Annots'), context.obj([widget]));
    widgets.push(widget);
  }
  context.assign(parentRef, context.obj({ T: PDFString.of('antrag'), FT: 'Tx', DA: PDFString.of('/F1 10 Tf 0 g'), Kids: widgets }));
  doc.catalog.set(name('AcroForm'), context.obj({ Fields: [parentRef] }));
  return doc.save();
}

/**
 * 3 pages that use one resource dictionary with the images Scan1-3, a form XObject „Frame“
 * (without own resources, showing Scan3) and the fonts F1/F2. Page 1 shows Scan1 and Frame,
 * page 2 (Flate-compressed content) Scan2, page 3 Scan3 (written as „/Scan#33“).
 * `inherited`: the dictionary sits on the page tree root instead of being shared by reference.
 */
async function makeSharedResourcesPdf({ inherited, contentFilter } = {}) {
  const doc = await PDFDocument.create();
  const context = doc.context;
  const image = (i) => context.register(
    context.stream(`SCAN${i}_PIXELS`.padEnd(48, '.'), {
      Type: 'XObject', Subtype: 'Image', Width: 4, Height: 4, ColorSpace: 'DeviceRGB', BitsPerComponent: 8,
    })
  );
  const font = (base) => context.register(context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: base }));
  const frame = context.register(
    context.stream('q 50 0 0 50 0 0 cm /Scan3 Do Q', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 100] })
  );
  const resources = context.obj({
    ProcSet: ['PDF', 'Text', 'ImageC'],
    XObject: { Scan1: image(1), Scan2: image(2), Scan3: image(3), Frame: frame },
    Font: { F1: font('Helvetica'), F2: font('Courier') },
  });
  const contents = [
    context.stream('q 100 0 0 100 0 0 cm /Scan1 Do Q /Frame Do BT /F1 12 Tf (PAGE1_TEXT) Tj ET', contentFilter ? { Filter: contentFilter } : {}),
    context.flateStream('q 100 0 0 100 0 0 cm /Scan2 Do Q BT /F2 12 Tf (PAGE2_TEXT) Tj ET'),
    context.stream('q 100 0 0 100 0 0 cm /Scan#33 Do Q'),
  ];
  const shared = inherited ? undefined : context.register(resources);
  contents.forEach((content, i) => {
    const page = doc.addPage([100 + i, 200]);
    if (inherited) page.node.delete(name('Resources'));
    else page.node.set(name('Resources'), shared);
    page.node.set(name('Contents'), context.register(content));
  });
  if (inherited) doc.catalog.lookup(name('Pages'), PDFDict).set(name('Resources'), resources);
  return doc.save();
}

/** Names of the resources of one category of a page, sorted. */
function resourceNames(page, category) {
  const dict = page.node.Resources().lookup(name(category), PDFDict);
  return dict ? dict.keys().map((key) => key.decodeText()).sort() : [];
}

/**
 * 2 pages with optional content groups (layers): page 1 uses „Loesung“ (hidden by default) and
 * „Basis“, page 2 uses „Seite2“ (hidden). With `baseStateOff`, all groups but „Basis“ are hidden
 * through /BaseState /OFF instead of an /OFF list.
 */
async function makeLayeredPdf({ baseStateOff = false } = {}) {
  const doc = await PDFDocument.create();
  const context = doc.context;
  const group = (label) => context.register(context.obj({ Type: 'OCG', Name: PDFString.of(label) }));
  const solution = group('Loesung');
  const base = group('Basis');
  const other = group('Seite2');
  const page1 = doc.addPage([100, 200]);
  page1.node.set(name('Resources'), context.obj({ Properties: { L: solution, B: base } }));
  page1.node.set(name('Contents'), context.register(context.stream('/OC /L BDC 1 0 0 rg 0 0 50 50 re f EMC /OC /B BDC 50 50 50 50 re f EMC')));
  const page2 = doc.addPage([101, 200]);
  page2.node.set(name('Resources'), context.obj({ Properties: { S: other } }));
  page2.node.set(name('Contents'), context.register(context.stream('/OC /S BDC 0 0 50 50 re f EMC')));
  const config = baseStateOff
    ? { BaseState: 'OFF', ON: [base], Order: [solution, base, other] }
    : { OFF: [solution, other], Order: [base, [PDFString.of('Gruppe'), solution], other] };
  doc.catalog.set(name('OCProperties'), context.obj({ OCGs: [solution, base, other], D: config }));
  return doc.save();
}

/** The layers of an output: group names, hidden group names and the panel order. */
async function readLayers(bytes) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const properties = doc.catalog.lookup(name('OCProperties'));
  if (!properties) return { doc, properties };
  const label = (ref) => doc.context.lookup(ref, PDFDict).lookup(name('Name')).decodeText();
  const labels = (array) => (array ? array.asArray().map(label) : []);
  const order = (array) => array.asArray().map((item) =>
    item instanceof PDFArray ? order(item) : item instanceof PDFRef ? label(item) : item.decodeText()
  );
  const config = properties.lookup(name('D'), PDFDict);
  const orderArray = config.lookup(name('Order'));
  return {
    doc,
    properties,
    groupRefs: properties.lookup(name('OCGs'), PDFArray).asArray(),
    groups: labels(properties.lookup(name('OCGs'))),
    off: labels(config.lookup(name('OFF'))),
    order: orderArray ? order(orderArray) : undefined,
  };
}

/** A PDF with the given objects (object number = index + 1, catalog first). */
function buildPdf(objects) {
  let out = '%PDF-1.7\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const CATALOG = '<< /Type /Catalog /Pages 2 0 R >>';
const leaf = (parent, width) => `<< /Type /Page /Parent ${parent} 0 R /MediaBox [0 0 ${width} 200] >>`;

/** A page tree with `levels` + 1 levels of /Pages nodes whose /Kids name the same node twice. */
function makeDagPdf(levels) {
  const objects = [CATALOG];
  for (let level = 0; level <= levels; level++) {
    const id = level + 2;
    const parent = level === 0 ? '' : ` /Parent ${id - 1} 0 R`;
    objects.push(`<< /Type /Pages${parent} /Kids [${id + 1} 0 R ${id + 1} 0 R] /Count ${2 ** (levels + 1 - level)} >>`);
  }
  objects.push(leaf(levels + 2, 100));
  return buildPdf(objects);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('only the selected pages end up in an output', () => {
  let linked;
  let form;
  before(async () => {
    linked = await makeLinkedPdf();
    form = await makeFormPdf();
  });

  test('a link to a page that is not selected does not pull that page in', async () => {
    const extracted = await extractPages(linked, [0]);
    const { doc, pageObjects, text } = await inspect(extracted);
    assert.equal(doc.getPageCount(), 1);
    assert.equal(pageObjects, 1);
    assert.ok(text.includes('PAGE1_TEXT'));
    assert.ok(!text.includes('PAGE3_TEXT'), 'text of page 3 leaked');
    assert.ok(!text.includes('PAGE3_IMAGE'), 'image of page 3 leaked');
    assert.ok(extracted.length < 5000, `output has ${extracted.length} bytes`);
    // The link has nowhere to go and is dropped.
    assert.deepEqual(annotsOf(doc.getPage(0)), []);
  });

  test('split and merge with page selection: one page object per page, no foreign content', async () => {
    const parts = await splitPdf(linked, singlePageGroups(3));
    for (const [i, part] of parts.entries()) {
      const { pageObjects, text } = await inspect(part);
      assert.equal(pageObjects, 1, `part ${i + 1}`);
      for (let page = 1; page <= 3; page++) {
        assert.equal(text.includes(`PAGE${page}_TEXT`), page === i + 1, `part ${i + 1}, text of page ${page}`);
      }
    }

    const merged = await mergePdfs([{ bytes: linked, pages: [1] }, { bytes: linked.slice(), pages: [0] }]);
    const { pageObjects, text } = await inspect(merged);
    assert.equal(pageObjects, 2);
    assert.ok(!text.includes('PAGE3_TEXT'));
  });

  test('links between selected pages point to the copied pages', async () => {
    const merged = await mergePdfs([{ bytes: linked, pages: [2, 0, 0] }]);
    const { doc, pageObjects } = await inspect(merged);
    assert.deepEqual(await pageWidths(merged), [102, 100, 100]);
    assert.equal(pageObjects, 3);
    const [page3, page1] = doc.getPages();
    const [backLink] = annotsOf(page3);
    assert.equal(linkDestination(backLink).get(0), page1.ref);
    const [link] = annotsOf(page1);
    assert.equal(linkDestination(link).get(0), page3.ref);

    const whole = await mergePdfs([{ bytes: linked }]);
    const wholeDoc = (await inspect(whole)).doc;
    assert.equal((await inspect(whole)).pageObjects, 3);
    const pages = wholeDoc.getPages();
    assert.equal(linkDestination(annotsOf(pages[0])[0]).get(0), pages[2].ref);
    assert.equal(linkDestination(annotsOf(pages[2])[0]).get(0), pages[0].ref);
  });

  test('form fields of other pages (hierarchical field names) are not copied', async () => {
    const { doc, pageObjects, text } = await inspect(await extractPages(form, [0]));
    assert.equal(pageObjects, 1);
    assert.ok(text.includes('VALUE1'));
    for (const secret of ['VALUE2', 'VALUE3', 'PAGE2_TEXT', 'PAGE3_TEXT', '(antrag)']) {
      assert.ok(!text.includes(secret), `${secret} leaked`);
    }
    // The widget keeps its appearance and the attributes it inherited from the field.
    const [widget] = annotsOf(doc.getPage(0));
    assert.equal(widget.get(name('Parent')), undefined);
    assert.equal(widget.get(name('FT')), name('Tx'));
    assert.equal(widget.lookup(name('DA')).decodeText(), '/F1 10 Tf 0 g');
    assert.ok(widget.lookup(name('AP'), PDFDict).has(name('N')));
    assert.equal(widget.get(name('P')), doc.getPage(0).ref);
  });

  test('form widgets keep pointing at their own page when all pages are merged', async () => {
    const { doc, pageObjects } = await inspect(await mergePdfs([{ bytes: form }]));
    assert.equal(pageObjects, 3);
    for (const page of doc.getPages()) {
      const [widget] = annotsOf(page);
      assert.equal(widget.get(name('P')), page.ref);
    }
  });

  for (const inherited of [false, true]) {
    const variant = inherited ? 'inherited from the page tree' : 'shared by reference';
    test(`resources ${variant}: only the used images and fonts are copied`, async () => {
      const bytes = await makeSharedResourcesPdf({ inherited });

      const page2 = await inspect(await extractPages(bytes, [1]));
      assert.deepEqual(resourceNames(page2.doc.getPage(0), 'XObject'), ['Scan2']);
      assert.deepEqual(resourceNames(page2.doc.getPage(0), 'Font'), ['F2']);
      assert.ok(page2.doc.getPage(0).node.Resources().has(name('ProcSet')));
      assert.ok(page2.text.includes('SCAN2_PIXELS'));
      assert.ok(!page2.text.includes('SCAN1_PIXELS') && !page2.text.includes('SCAN3_PIXELS'));

      // „Frame“ has no resources of its own and uses Scan3 from the page's resources.
      const page1 = await inspect(await extractPages(bytes, [0]));
      assert.deepEqual(resourceNames(page1.doc.getPage(0), 'XObject'), ['Frame', 'Scan1', 'Scan3']);
      assert.deepEqual(resourceNames(page1.doc.getPage(0), 'Font'), ['F1']);
      assert.ok(!page1.text.includes('SCAN2_PIXELS'));

      // „/Scan#33“ is the escaped form of „/Scan3“.
      const page3 = await inspect(await extractPages(bytes, [2]));
      assert.deepEqual(resourceNames(page3.doc.getPage(0), 'XObject'), ['Scan3']);

      const merged = await inspect(await mergePdfs([{ bytes }]));
      assert.equal(merged.pageObjects, 3);
      assert.deepEqual(merged.doc.getPages().map((page) => resourceNames(page, 'XObject')), [
        ['Frame', 'Scan1', 'Scan3'],
        ['Scan2'],
        ['Scan3'],
      ]);
    });
  }

  test('keeps resources used by annotation appearances without own resources', async () => {
    const doc = await PDFDocument.create();
    const context = doc.context;
    const font = (base) => context.register(context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: base }));
    const page = doc.addPage([100, 200]);
    page.node.set(name('Resources'), context.obj({ Font: { F1: font('Helvetica'), F2: font('Courier'), F3: font('Symbol') } }));
    page.node.set(name('Contents'), context.register(context.stream('BT /F2 12 Tf (Text) Tj ET')));
    // PDFium uses the page's resources for an appearance stream without /Resources.
    const appearance = context.register(context.stream('BT /F1 10 Tf (Notiz) Tj ET', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 50, 20] }));
    addAnnot(page, context.obj({ Type: 'Annot', Subtype: 'FreeText', Rect: [0, 0, 50, 20], AP: { N: appearance } }));
    const extracted = await PDFDocument.load(await extractPages(await doc.save(), [0]));
    assert.deepEqual(resourceNames(extracted.getPage(0), 'Font'), ['F1', 'F2']);
  });

  test('all resources are kept if the content cannot be read', async () => {
    const bytes = await makeSharedResourcesPdf({ contentFilter: 'JBIG2Decode' });
    const doc = await PDFDocument.load(await extractPages(bytes, [0]));
    assert.deepEqual(resourceNames(doc.getPage(0), 'XObject'), ['Frame', 'Scan1', 'Scan2', 'Scan3']);
  });

  test('does not change the document returned by loadPdf', async () => {
    const doc = await loadPdf(form);
    const [widget] = annotsOf(doc.getPage(0));
    assert.ok(widget.get(name('Parent')) instanceof PDFRef);
  });
});

describe('optional content (layers)', () => {
  let layered;
  before(async () => {
    layered = await makeLayeredPdf();
  });

  test('hidden layers stay hidden in an extract, unused layers are left out', async () => {
    const { doc, groupRefs, groups, off, order } = await readLayers(await extractPages(layered, [0]));
    assert.deepEqual(groups, ['Loesung', 'Basis']);
    assert.deepEqual(off, ['Loesung']);
    assert.deepEqual(order, ['Basis', ['Gruppe', 'Loesung']]);
    // The catalog names the same group objects as the page content.
    const properties = doc.getPage(0).node.Resources().lookup(name('Properties'), PDFDict);
    assert.deepEqual(groupRefs, [properties.get(name('L')), properties.get(name('B'))]);
  });

  test('split: every part gets the layers of its own pages', async () => {
    const [first, second] = await splitPdf(layered, [[0], [1]]);
    assert.deepEqual((await readLayers(first)).off, ['Loesung']);
    const layers = await readLayers(second);
    assert.deepEqual(layers.groups, ['Seite2']);
    assert.deepEqual(layers.off, ['Seite2']);
    assert.deepEqual(layers.order, ['Seite2']);
  });

  test('merge: layers of all sources, /BaseState /OFF is honoured', async () => {
    const hiddenByDefault = await makeLayeredPdf({ baseStateOff: true });
    const { groups, off, order } = await readLayers(await mergePdfs([{ bytes: layered }, { bytes: hiddenByDefault }]));
    assert.deepEqual(groups, ['Loesung', 'Basis', 'Seite2', 'Loesung', 'Basis', 'Seite2']);
    assert.deepEqual(off, ['Loesung', 'Seite2', 'Loesung', 'Seite2']);
    assert.deepEqual(order, ['Basis', ['Gruppe', 'Loesung'], 'Seite2', 'Loesung', 'Basis', 'Seite2']);
  });

  test('documents without layers get no /OCProperties', async () => {
    const plain = await PDFDocument.create();
    plain.addPage([100, 200]);
    const { properties } = await readLayers(await mergePdfs([{ bytes: await plain.save() }]));
    assert.equal(properties, undefined);
  });
});

describe('page tree', () => {
  test('pages without /Type /Page are counted and copied like pdf.js shows them', async () => {
    const bytes = buildPdf([
      CATALOG,
      '<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>',
      leaf(2, 200),
      '<< /Parent 2 0 R /MediaBox [0 0 201 200] >>', // no /Type
      '<< /Parent 2 0 R /Kids [6 0 R] /Count 1 >>', // page tree node without /Type
      leaf(5, 202),
    ]);
    assert.equal(await getPageCount(bytes), 3);
    assert.deepEqual(await pageWidths(await extractPages(bytes, [1])), [201]);
    const merged = await mergePdfs([{ bytes }]);
    assert.deepEqual(await pageWidths(merged), [200, 201, 202]);
    assert.equal((await inspect(merged)).pageObjects, 3);
  });

  test('a page tree root without /Type /Pages is accepted', async () => {
    const bytes = buildPdf([CATALOG, '<< /Kids [3 0 R] /Count 1 >>', leaf(2, 150)]);
    assert.equal(await getPageCount(bytes), 1);
    assert.deepEqual(await pageWidths(await extractPages(bytes, [0])), [150]);
  });

  test('nested page tree nodes keep the page order', async () => {
    const bytes = buildPdf([
      CATALOG,
      '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 3 >>',
      '<< /Type /Pages /Parent 2 0 R /Kids [4 0 R 5 0 R] /Count 2 >>',
      leaf(3, 100),
      leaf(3, 101),
      leaf(2, 102),
    ]);
    assert.equal(await getPageCount(bytes), 3);
    assert.deepEqual(await pageWidths(await mergePdfs([{ bytes }])), [100, 101, 102]);
  });

  test('INVALID_PDF for a page tree that names a node twice (a few bytes, 2^N pages)', async () => {
    const err = await expectToolError(getPageCount(makeDagPdf(9), { fileName: 'dag.pdf' }), 'INVALID_PDF');
    assert.equal(err.message, '„dag.pdf“: Die PDF-Datei ist beschädigt oder kann nicht gelesen werden.');
    await expectToolError(splitPdf(makeDagPdf(19), [[0]]), 'INVALID_PDF');
  });

  test('INVALID_PDF for cycles and pages listed twice', async () => {
    const cycle = buildPdf([
      CATALOG,
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Pages /Parent 2 0 R /Kids [2 0 R 4 0 R] /Count 1 >>',
      leaf(3, 100),
    ]);
    await expectToolError(loadPdf(cycle), 'INVALID_PDF');

    const twice = buildPdf([CATALOG, '<< /Type /Pages /Kids [3 0 R 3 0 R] /Count 2 >>', leaf(2, 100)]);
    await expectToolError(loadPdf(twice), 'INVALID_PDF');
  });
});

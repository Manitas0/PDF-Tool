/*
 * PDF-Tool – UI controller for merging and splitting PDFs.
 *
 * Depends on the globals PdfCore (js/pdf-core.js), PdfPreview (js/preview.js) and JSZip.
 * Everything runs locally. User-provided strings (file names!) only ever reach the DOM via
 * textContent / setAttribute – never via innerHTML.
 */
(function () {
  'use strict';

  const Core = window.PdfCore;
  const Preview = window.PdfPreview;

  const DEFAULT_MERGE_NAME = 'zusammengefuehrt.pdf';
  const MAX_PREVIEW_GROUPS = 12;
  const MAX_PREVIEW_CHARS = 280;
  // Output names are "<base>_S…pdf" / "<base>_Auszug_S…pdf"; a capped base keeps them well below
  // common file-system limits (255 bytes per name), also for ZIP entries extracted on Windows.
  const MAX_BASE_NAME_CHARS = 80;
  const MERGE_THUMB_SIZE = { width: 46, height: 62 };
  // Feedback while typing is only read out to screen readers once the input has been stable this long.
  const ANNOUNCE_DELAY_MS = 700;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DRAG_TYPE = 'application/x-pdf-tool-item';

  /* ================================================================== helpers */

  const byId = (id) => document.getElementById(id);

  /** Small DOM builder. `text` is always set via textContent. */
  function h(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = options.text;
    if (options.attrs) {
      for (const [name, value] of Object.entries(options.attrs)) {
        if (value !== null && value !== undefined && value !== false) node.setAttribute(name, String(value));
      }
    }
    for (const child of children) {
      if (child !== null && child !== undefined) node.append(child);
    }
    return node;
  }

  function icon(name, className = 'icon') {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  const integerFormat = new Intl.NumberFormat('de-DE');
  const decimalFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });

  function countLabel(count, singular, plural) {
    return `${integerFormat.format(count)} ${count === 1 ? singular : plural}`;
  }

  const pagesLabel = (count) => countLabel(count, 'Seite', 'Seiten');
  const filesLabel = (count) => countLabel(count, 'Datei', 'Dateien');

  function formatBytes(bytes) {
    if (bytes < 1024) return `${integerFormat.format(bytes)} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${decimalFormat.format(value)} ${units[unit]}`;
  }

  function asSentence(message) {
    const text = String(message).trim();
    return /[.!?…]$/.test(text) ? text : `${text}.`;
  }

  /** Error whose message is already a complete, user-presentable German sentence. */
  class UserFacingError extends Error {}

  function errorMessage(err, fileName) {
    if (err instanceof UserFacingError) return err.message;
    if (err instanceof Core.PdfToolError || (err && err.name === 'PdfToolError')) return err.message;
    const generic = Core.describeError(err);
    return fileName ? `„${fileName}“: ${generic}` : generic;
  }

  /** Lets the browser paint (busy indicator, progress) before heavy synchronous work. */
  function yieldToBrowser() {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve();
        }
      };
      requestAnimationFrame(() => setTimeout(finish, 0));
      setTimeout(finish, 60); // rAF does not fire in background tabs
    });
  }

  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function revealElement(element) {
    element.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  /** Runs async tasks with limited concurrency (used for thumbnail rendering). */
  function createTaskQueue(concurrency) {
    const pending = [];
    let running = 0;

    function pump() {
      while (running < concurrency && pending.length) {
        const task = pending.shift();
        running += 1;
        Promise.resolve()
          .then(task)
          .catch((err) => console.warn('PDF-Tool: Vorschau konnte nicht erstellt werden.', err))
          .finally(() => {
            running -= 1;
            pump();
          });
      }
    }

    return {
      push(task) {
        pending.push(task);
        pump();
      },
      clear() {
        pending.length = 0;
      },
    };
  }

  function createDownloadLink(blob, fileName, className, children, id) {
    const url = URL.createObjectURL(blob);
    const link = h('a', { className, attrs: { id, href: url, download: fileName } }, children);
    return { link, url };
  }

  /* ================================================================== elements + state */

  const els = {
    status: byId('status'),
    busy: byId('busy'),
    busyText: byId('busy-text'),
    announcer: byId('sr-announcer'),
    tabMerge: byId('tab-merge'),
    tabSplit: byId('tab-split'),
    panelMerge: byId('panel-merge'),
    panelSplit: byId('panel-split'),

    mergeDropzone: byId('merge-dropzone'),
    mergeInput: byId('merge-input'),
    mergeFiles: byId('merge-files'),
    mergeList: byId('merge-list'),
    mergeEmpty: byId('merge-empty'),
    mergeHelp: byId('merge-help'),
    mergeSummary: byId('merge-summary'),
    mergeSort: byId('merge-sort'),
    mergeClear: byId('merge-clear'),
    mergeFilename: byId('merge-filename'),
    mergeRun: byId('merge-run'),
    mergeResult: byId('merge-result'),

    splitDropzone: byId('split-dropzone'),
    splitInput: byId('split-input'),
    splitFileInfo: byId('split-file-info'),
    splitFileName: byId('split-file-name'),
    splitFileMeta: byId('split-file-meta'),
    splitReset: byId('split-reset'),
    splitModes: Array.from(document.querySelectorAll('input[name="split-mode"]')),
    splitModePanels: Array.from(document.querySelectorAll('[data-mode-panel]')),
    splitChunk: byId('split-chunk-size'),
    splitRanges: byId('split-ranges'),
    splitExtract: byId('split-extract'),
    splitPreview: byId('split-preview'),
    splitZip: byId('split-zip'),
    splitZipOption: byId('split-zip').closest('.checkbox'),
    splitRun: byId('split-run'),
    splitResults: byId('split-results'),
    splitPagesHint: byId('split-pages-hint'),
    splitSelectTools: byId('split-select-tools'),
    splitSelectAll: byId('split-select-all'),
    splitSelectNone: byId('split-select-none'),
    splitThumbs: byId('split-thumbnails'),
  };

  const merge = {
    items: [], // { id, name, size, bytes, pageCount, range, pages, error }
    nodes: new Map(), // id -> element references of the list item
    nextId: 1,
    changes: 0, // increments whenever the list or a page selection changes (see clearMergeResult)
    resultUrl: null,
    dragId: null,
    dropTarget: null, // { index, before } while dragging
  };

  const split = {
    file: null, // { name, size, bytes, pageCount, baseName }
    token: 0, // increments whenever the file changes; stale async work checks it
    loadSeq: 0, // increments per chosen file; only the most recent load may install its file
    previewPromise: null,
    preview: null,
    observer: null,
    thumbs: [], // { button, frame, badge, badgeKey }
    focusIndex: 0,
    extractPages: [], // last valid selection in extract mode (0-based, output order)
    lastClicked: null,
    plan: null,
    changes: 0, // increments whenever the file or the split settings change (see clearSplitResults)
    resultUrls: [],
  };

  let busyCount = 0;
  let previewEnabled = false;
  let announceTimer = 0;
  let mergeAddChain = Promise.resolve();
  let mergeAddPending = 0; // batches queued or loading in mergeAddChain
  // What all batches since the chain was last idle added / could not add: each batch reports the
  // whole outcome, so a later batch's status does not hide an earlier batch's errors.
  let mergeAddReport = { added: 0, errors: [] };
  const mergeThumbQueue = createTaskQueue(1);
  const splitThumbQueue = createTaskQueue(2);

  /* ================================================================== status + busy */

  function setStatus(message, kind = 'info') {
    els.status.classList.toggle('is-error', kind === 'error');
    els.status.classList.toggle('is-success', kind === 'success');
    els.status.textContent = message;
    if (kind === 'error') {
      const rect = els.status.getBoundingClientRect();
      if (rect.top < 0 || rect.bottom > window.innerHeight) revealElement(els.status);
    }
  }

  function clearStatus() {
    els.status.textContent = '';
    els.status.classList.remove('is-error', 'is-success');
  }

  /**
   * Reads `message` out to screen readers via the visually hidden live region #sr-announcer
   * (for changes that have no visible live region of their own). With `settled: true` (feedback
   * while typing) it waits until the input has been stable for ANNOUNCE_DELAY_MS, so half-typed
   * intermediate states are not read out, and skips a message that was just read out.
   */
  function announce(message, { settled = false } = {}) {
    clearTimeout(announceTimer);
    if (!settled) {
      els.announcer.textContent = message;
      return;
    }
    announceTimer = setTimeout(() => {
      if (els.announcer.textContent !== message) els.announcer.textContent = message;
    }, ANNOUNCE_DELAY_MS);
  }

  const isBusy = () => busyCount > 0;

  function setBusyMessage(message) {
    els.busyText.textContent = message;
  }

  /** True if focus is on <body>, or on an element that was disabled or hidden (browsers move it away lazily). */
  function focusIsLost() {
    const active = document.activeElement;
    return !active || active === document.body || active.disabled === true || active.getClientRects().length === 0;
  }

  /** If focus is lost, moves it (without scrolling) to the first of `candidates` that can take it. */
  function restoreFocus(candidates) {
    for (const element of candidates) {
      if (!focusIsLost()) return;
      if (element && element !== document.body && element.isConnected && !element.disabled) {
        element.focus({ preventScroll: true });
      }
    }
  }

  /**
   * Runs `task` while showing the busy indicator and disabling the action buttons. Disabling (or
   * hiding) the focused control drops focus to <body>; afterwards it returns to that control or,
   * if the control cannot take focus any more, to `focusFallback` – unless the user clicked or
   * tapped somewhere meanwhile (focus on <body> is then where they put it).
   */
  async function withBusy(message, task, focusFallback = null) {
    const focused = document.activeElement;
    let interacted = false;
    const onPointerDown = () => {
      interacted = true;
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    busyCount += 1;
    setBusyMessage(message);
    els.busy.hidden = false;
    announce(message);
    refreshControls();
    try {
      await yieldToBrowser();
      return await task();
    } finally {
      document.removeEventListener('pointerdown', onPointerDown, true);
      busyCount -= 1;
      if (busyCount === 0) els.busy.hidden = true;
      refreshControls();
      if (!interacted) restoreFocus([focused, focusFallback]);
    }
  }

  function refreshControls() {
    updateMergeControls();
    updateSplitControls();
  }

  /* ================================================================== tabs */

  function initTabs() {
    const tabs = [els.tabMerge, els.tabSplit];

    function select(tab, moveFocus) {
      const changed = tab.getAttribute('aria-selected') !== 'true';
      for (const candidate of tabs) {
        const selected = candidate === tab;
        candidate.setAttribute('aria-selected', String(selected));
        candidate.tabIndex = selected ? 0 : -1;
        byId(candidate.getAttribute('aria-controls')).hidden = !selected;
      }
      if (moveFocus) tab.focus();
      if (changed && !isBusy()) clearStatus();
    }

    for (const tab of tabs) tab.addEventListener('click', () => select(tab, false));

    tabs[0].parentElement.addEventListener('keydown', (event) => {
      const index = tabs.indexOf(document.activeElement);
      if (index === -1) return;
      let next = null;
      if (event.key === 'ArrowRight') next = tabs[(index + 1) % tabs.length];
      else if (event.key === 'ArrowLeft') next = tabs[(index - 1 + tabs.length) % tabs.length];
      else if (event.key === 'Home') next = tabs[0];
      else if (event.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      event.preventDefault();
      select(next, true);
    });
  }

  /* ================================================================== drag & drop basics */

  const hasFiles = (event) => Boolean(event.dataTransfer && Array.from(event.dataTransfer.types || []).includes('Files'));

  /** Makes `zone` accept dropped files (highlighted while dragging over it). */
  function setupFileDropTarget(zone, onFiles) {
    let depth = 0;
    const reset = () => {
      depth = 0;
      zone.classList.remove('is-dragover');
    };

    zone.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      zone.classList.add('is-dragover');
    });
    zone.addEventListener('dragover', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    zone.addEventListener('dragleave', (event) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) zone.classList.remove('is-dragover');
    });
    zone.addEventListener('drop', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      reset();
      onFiles(Array.from(event.dataTransfer.files || []));
    });
    window.addEventListener('dragend', reset);
    window.addEventListener('drop', reset);
  }

  /** Dropping files outside a drop target must not make the browser navigate away. */
  function guardWindowDrops() {
    window.addEventListener('dragover', (event) => {
      if (event.defaultPrevented) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
    });
    window.addEventListener('drop', (event) => event.preventDefault());
  }

  /** Wires a hidden file input; copies the FileList and resets the input so the same file can be picked again. */
  function onFilesChosen(input, handler) {
    input.addEventListener('change', () => {
      const files = Array.from(input.files || []);
      input.value = '';
      if (files.length) handler(files);
    });
  }

  async function readPdfFile(file) {
    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (err) {
      throw new UserFacingError(`„${file.name}“ konnte nicht gelesen werden.`);
    }
    const pageCount = await Core.getPageCount(bytes, { fileName: file.name });
    return { name: file.name, size: file.size, bytes, pageCount };
  }

  /* ================================================================== merge */

  function iconButton(iconName, label, title, className) {
    return h('button', { className: `icon-button ${className}`, attrs: { type: 'button', 'aria-label': label, title } }, [
      icon(iconName),
    ]);
  }

  function createMergeNode(item) {
    const li = h('li', { className: 'merge-item', attrs: { 'data-id': item.id } });
    li.draggable = true;

    const grip = h('span', { className: 'merge-item-grip', attrs: { 'aria-hidden': 'true', title: 'Zum Verschieben ziehen' } }, [
      icon('grip'),
    ]);
    const thumbIcon = icon('file');
    const index = h('span', { className: 'merge-item-index', attrs: { 'aria-hidden': 'true' } });
    const thumb = h('div', { className: 'merge-item-thumb' }, [thumbIcon, index]);

    const selected = h('span', { className: 'merge-item-selected' });
    const info = h('div', { className: 'merge-item-info' }, [
      h('div', { className: 'merge-item-name', text: item.name, attrs: { title: item.name } }),
      h('div', { className: 'merge-item-meta' }, [
        h('span', { className: 'merge-item-pages', text: pagesLabel(item.pageCount) }),
        ` · ${formatBytes(item.size)}`,
        selected,
      ]),
    ]);

    const rangeId = `merge-range-${item.id}`;
    const range = h('input', {
      className: 'input merge-item-range',
      attrs: {
        id: rangeId,
        type: 'text',
        placeholder: 'alle Seiten',
        autocomplete: 'off',
        spellcheck: 'false',
        'aria-label': `Seitenauswahl für „${item.name}“ (leer = alle Seiten)`,
      },
    });
    range.value = item.range;
    const rangeField = h('div', { className: 'merge-item-range-field' }, [
      h('label', { className: 'merge-item-range-label', text: 'Seiten', attrs: { for: rangeId } }),
      range,
    ]);

    const up = iconButton('arrow-up', `„${item.name}“ nach oben verschieben`, 'Nach oben', 'merge-item-up');
    const down = iconButton('arrow-down', `„${item.name}“ nach unten verschieben`, 'Nach unten', 'merge-item-down');
    const remove = iconButton('x', `„${item.name}“ entfernen`, 'Entfernen', 'merge-item-remove is-danger');

    li.append(grip, thumb, info, rangeField, h('div', { className: 'merge-item-actions' }, [up, down, remove]));
    return { li, thumb, thumbIcon, index, selected, range, error: null, up, down, remove };
  }

  function renderMergeItemValidity(item) {
    const refs = merge.nodes.get(item.id);
    if (!refs) return;
    if (item.error) {
      refs.range.setAttribute('aria-invalid', 'true');
      if (!refs.error) {
        refs.error = h('p', { className: 'merge-item-error', attrs: { id: `merge-error-${item.id}` } });
        refs.li.append(refs.error);
        refs.range.setAttribute('aria-describedby', refs.error.id);
      }
      refs.error.textContent = item.error;
    } else {
      refs.range.removeAttribute('aria-invalid');
      if (refs.error) {
        refs.error.remove();
        refs.error = null;
        refs.range.removeAttribute('aria-describedby');
      }
    }
    refs.selected.textContent = item.pages ? ` · ${integerFormat.format(item.pages.length)} ausgewählt` : '';
  }

  /** Brings the list DOM in line with merge.items, re-using existing nodes (keeps input state). */
  function renderMergeList() {
    const list = els.mergeList;
    const activeElement = document.activeElement;
    const ids = new Set(merge.items.map((item) => item.id));

    for (const [id, refs] of merge.nodes) {
      if (!ids.has(id)) {
        refs.li.remove();
        merge.nodes.delete(id);
      }
    }

    const count = merge.items.length;
    merge.items.forEach((item, index) => {
      let refs = merge.nodes.get(item.id);
      if (!refs) {
        refs = createMergeNode(item);
        merge.nodes.set(item.id, refs);
      }
      if (list.children[index] !== refs.li) list.insertBefore(refs.li, list.children[index] || null);
      refs.index.textContent = String(index + 1);
      refs.up.disabled = index === 0;
      refs.down.disabled = index === count - 1;
    });

    if (activeElement && activeElement !== document.activeElement && activeElement.isConnected) {
      activeElement.focus();
    }
    updateMergeControls();
  }

  function mergeSelectedPageCount(item) {
    if (item.error) return 0;
    return item.pages ? item.pages.length : item.pageCount;
  }

  function updateMergeControls() {
    const count = merge.items.length;
    const invalid = merge.items.some((item) => item.error);
    const busy = isBusy();

    if (count === 0) {
      els.mergeSummary.textContent = 'Noch keine Dateien ausgewählt';
    } else {
      const pages = merge.items.reduce((sum, item) => sum + mergeSelectedPageCount(item), 0);
      els.mergeSummary.textContent =
        `${filesLabel(count)} · ${pagesLabel(pages)}` + (invalid ? ' · bitte Seitenauswahl prüfen' : '');
    }

    els.mergeRun.disabled = count === 0 || invalid || busy;
    els.mergeSort.disabled = count < 2 || busy;
    els.mergeClear.disabled = count === 0 || busy;
    els.mergeEmpty.hidden = count > 0;
    els.mergeHelp.hidden = count === 0;
    els.panelMerge.classList.toggle('has-files', count > 0);
  }

  function validateMergeItem(item) {
    const text = item.range.trim();
    if (!text) {
      item.pages = null;
      item.error = null;
      return;
    }
    try {
      item.pages = Core.parsePageList(text, item.pageCount);
      item.error = null;
    } catch (err) {
      item.pages = null;
      item.error = errorMessage(err);
    }
  }

  function findMergeIndex(id) {
    return merge.items.findIndex((item) => item.id === id);
  }

  /**
   * Adds files to the merge list. Batches run one after another, so files added while an earlier
   * batch is still loading end up behind it (the list order is the page order of the result).
   */
  function addMergeFiles(files) {
    mergeAddPending += 1;
    const run = () =>
      addMergeFilesNow(files).finally(() => {
        mergeAddPending -= 1;
        if (mergeAddPending === 0) mergeAddReport = { added: 0, errors: [] };
      });
    mergeAddChain = mergeAddChain.then(run, run);
    return mergeAddChain;
  }

  async function addMergeFilesNow(files) {
    const message = files.length === 1 ? 'Datei wird geladen …' : `${files.length} Dateien werden geladen …`;
    await withBusy(message, async () => {
      const report = mergeAddReport;
      for (const file of files) {
        try {
          const loaded = await readPdfFile(file);
          const item = { id: `f${merge.nextId++}`, ...loaded, range: '', pages: null, error: null };
          merge.items.push(item);
          report.added += 1;
          clearMergeResult();
          renderMergeList();
          queueMergeThumbnail(item);
        } catch (err) {
          report.errors.push(asSentence(errorMessage(err, file.name)));
        }
        await yieldToBrowser();
      }

      const addedText = report.added ? `${filesLabel(report.added)} hinzugefügt.` : '';
      if (report.errors.length) {
        setStatus([addedText, ...report.errors].filter(Boolean).join(' '), 'error');
      } else {
        const total = merge.items.length;
        setStatus(total === report.added ? addedText : `${addedText} Insgesamt ${filesLabel(total)} in der Liste.`);
      }
    });
  }

  function queueMergeThumbnail(item) {
    if (!previewEnabled) return;
    mergeThumbQueue.push(async () => {
      if (!merge.nodes.has(item.id)) return;
      const doc = await Preview.open(item.bytes);
      try {
        const canvas = await doc.renderThumbnail(0, MERGE_THUMB_SIZE.width, MERGE_THUMB_SIZE.height);
        const refs = merge.nodes.get(item.id);
        if (refs && refs.thumbIcon.isConnected) {
          refs.thumbIcon.replaceWith(canvas);
          refs.thumb.classList.add('has-image');
        }
      } finally {
        doc.destroy();
      }
    });
  }

  function moveMergeItem(id, delta) {
    const from = findMergeIndex(id);
    const to = from + delta;
    if (from === -1 || to < 0 || to >= merge.items.length) return;
    const [item] = merge.items.splice(from, 1);
    merge.items.splice(to, 0, item);
    clearMergeResult();
    renderMergeList();

    const refs = merge.nodes.get(id);
    const preferred = delta < 0 ? refs.up : refs.down;
    const fallback = delta < 0 ? refs.down : refs.up;
    (preferred.disabled ? fallback : preferred).focus();
    setStatus(`„${item.name}“ ist jetzt an Position ${to + 1} von ${merge.items.length}.`);
  }

  function removeMergeItem(id) {
    const index = findMergeIndex(id);
    if (index === -1) return;
    const [item] = merge.items.splice(index, 1);
    clearMergeResult();
    renderMergeList();

    const neighbour = merge.items[index] || merge.items[index - 1];
    if (neighbour) merge.nodes.get(neighbour.id).remove.focus();
    else els.mergeInput.focus();
    setStatus(`„${item.name}“ wurde entfernt.`);
  }

  function sortMergeItems() {
    const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
    const before = merge.items.slice();
    merge.items.sort((a, b) => collator.compare(a.name, b.name));
    if (merge.items.some((item, index) => item !== before[index])) clearMergeResult();
    renderMergeList();
    setStatus('Dateien nach Dateiname sortiert.');
  }

  function clearMergeItems() {
    merge.items = [];
    mergeThumbQueue.clear();
    renderMergeList();
    clearMergeResult();
    els.mergeInput.focus();
    setStatus('Alle Dateien wurden entfernt.');
  }

  /** Called on every change to the list or a page selection: the result no longer matches it. */
  function clearMergeResult() {
    merge.changes += 1;
    if (merge.resultUrl) URL.revokeObjectURL(merge.resultUrl);
    merge.resultUrl = null;
    els.mergeResult.replaceChildren();
    els.mergeResult.hidden = true;
  }

  function mergeOutputName() {
    const raw = els.mergeFilename.value.trim() || DEFAULT_MERGE_NAME;
    return Core.ensurePdfExtension(Core.sanitizeFileName(raw, Core.stripPdfExtension(DEFAULT_MERGE_NAME)));
  }

  async function runMerge() {
    if (els.mergeRun.disabled) return;
    const fileName = mergeOutputName();
    const items = merge.items.slice();
    const sources = items.map((item) => ({ bytes: item.bytes, pages: item.pages || undefined, name: item.name }));
    const totalPages = items.reduce((sum, item) => sum + mergeSelectedPageCount(item), 0);
    const changes = merge.changes;

    await withBusy(`${pagesLabel(totalPages)} ${totalPages === 1 ? 'wird' : 'werden'} zusammengeführt …`, async () => {
      try {
        const bytes = await Core.mergePdfs(sources, { title: Core.stripPdfExtension(fileName) });
        // The list stays editable while merging: a result of the old list must not be downloaded.
        if (merge.changes !== changes) {
          setStatus('Die Auswahl wurde während des Zusammenführens geändert – bitte starte es erneut.');
          return;
        }
        const blob = new Blob([bytes], { type: 'application/pdf' });
        showMergeResult(blob, fileName, totalPages);
        setStatus(`Fertig! „${fileName}“ wurde erstellt (${pagesLabel(totalPages)}, ${formatBytes(blob.size)}).`, 'success');
      } catch (err) {
        setStatus(errorMessage(err), 'error');
      }
    });
  }

  function showMergeResult(blob, fileName, pageCount) {
    clearMergeResult();
    const { link, url } = createDownloadLink(
      blob,
      fileName,
      'button button-primary',
      [icon('download'), h('span', { text: `${fileName} herunterladen` })],
      'merge-download'
    );
    merge.resultUrl = url;
    els.mergeResult.append(
      h('p', { className: 'result-head' }, [icon('check-circle'), h('span', { text: 'Fertig! Deine PDF ist bereit.' })]),
      h('p', {
        className: 'result-text',
        text: `${pagesLabel(pageCount)} · ${formatBytes(blob.size)}. Der Download startet automatisch – falls nicht, nutze die Schaltfläche.`,
      }),
      link
    );
    els.mergeResult.hidden = false;
    revealElement(els.mergeResult);
    // The run button is disabled while merging, which drops its focus: continue at the result.
    if (focusIsLost()) link.focus({ preventScroll: true });
    link.click();
  }

  /** Drag & drop reordering of list items (the arrow buttons are the accessible alternative). */
  function initMergeReorder() {
    const list = els.mergeList;

    const clearIndicator = () => {
      for (const refs of merge.nodes.values()) refs.li.classList.remove('is-drop-before', 'is-drop-after');
    };
    const endDrag = () => {
      clearIndicator();
      for (const refs of merge.nodes.values()) refs.li.classList.remove('is-dragging');
      merge.dragId = null;
      merge.dropTarget = null;
    };

    // Only start a drag from the card itself, not from its input or buttons (keeps text selection working).
    list.addEventListener('pointerdown', (event) => {
      const li = event.target.closest('.merge-item');
      if (li) li.draggable = !event.target.closest('input, button, label');
    });

    list.addEventListener('dragstart', (event) => {
      const li = event.target.closest && event.target.closest('.merge-item');
      if (!li || !li.draggable) return;
      merge.dragId = li.dataset.id;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(DRAG_TYPE, li.dataset.id);
      li.classList.add('is-dragging');
    });

    list.addEventListener('dragover', (event) => {
      if (!merge.dragId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';

      // Find the first item (other than the dragged one) whose vertical centre lies below the pointer.
      const others = merge.items.filter((item) => item.id !== merge.dragId);
      let targetIndex = others.length;
      for (let i = 0; i < others.length; i += 1) {
        const rect = merge.nodes.get(others[i].id).li.getBoundingClientRect();
        if (event.clientY < rect.top + rect.height / 2) {
          targetIndex = i;
          break;
        }
      }
      clearIndicator();
      if (others.length) {
        if (targetIndex < others.length) merge.nodes.get(others[targetIndex].id).li.classList.add('is-drop-before');
        else merge.nodes.get(others[others.length - 1].id).li.classList.add('is-drop-after');
      }
      merge.dropTarget = { index: targetIndex };
    });

    list.addEventListener('dragleave', (event) => {
      if (merge.dragId && !list.contains(event.relatedTarget)) clearIndicator();
    });

    list.addEventListener('drop', (event) => {
      if (!merge.dragId) return;
      event.preventDefault();
      const id = merge.dragId;
      const target = merge.dropTarget;
      endDrag();
      if (!target) return;
      const from = findMergeIndex(id);
      if (from === -1) return;
      const [item] = merge.items.splice(from, 1);
      merge.items.splice(target.index, 0, item);
      renderMergeList();
      if (from !== target.index) {
        clearMergeResult();
        setStatus(`„${item.name}“ ist jetzt an Position ${target.index + 1} von ${merge.items.length}.`);
      }
    });

    list.addEventListener('dragend', endDrag);
  }

  function initMerge() {
    onFilesChosen(els.mergeInput, addMergeFiles);
    setupFileDropTarget(els.mergeDropzone, addMergeFiles);
    setupFileDropTarget(els.mergeFiles, addMergeFiles);
    initMergeReorder();

    els.mergeList.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      const li = button && button.closest('.merge-item');
      if (!li) return;
      const id = li.dataset.id;
      if (button.classList.contains('merge-item-up')) moveMergeItem(id, -1);
      else if (button.classList.contains('merge-item-down')) moveMergeItem(id, 1);
      else if (button.classList.contains('merge-item-remove')) removeMergeItem(id);
    });

    els.mergeList.addEventListener('input', (event) => {
      if (!event.target.classList.contains('merge-item-range')) return;
      const li = event.target.closest('.merge-item');
      const item = merge.items[findMergeIndex(li.dataset.id)];
      if (!item) return;
      const previousError = item.error;
      item.range = event.target.value;
      validateMergeItem(item);
      renderMergeItemValidity(item);
      updateMergeControls();
      clearMergeResult();
      // The inline error is not a live region (that would read out every keystroke): announce it once
      // settled. Naming the position keeps the same error in another file's field from being skipped
      // as already read out.
      if (item.error !== previousError) {
        announce(item.error ? `Datei ${findMergeIndex(item.id) + 1}: ${item.error}` : '', { settled: true });
      }
    });

    els.mergeList.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.target.classList.contains('merge-item-range')) {
        event.preventDefault();
        runMerge();
      }
    });

    els.mergeSort.addEventListener('click', sortMergeItems);
    els.mergeClear.addEventListener('click', clearMergeItems);
    els.mergeRun.addEventListener('click', runMerge);
    els.mergeFilename.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        runMerge();
      }
    });
  }

  /* ================================================================== split */

  function currentSplitMode() {
    const checked = els.splitModes.find((radio) => radio.checked);
    return checked ? checked.value : 'ranges';
  }

  /**
   * Computes the output groups for the current mode and input.
   * status: 'ok' (groups ready), 'hint' (nothing entered yet) or 'error' (message is German).
   */
  function computeSplitPlan() {
    if (!split.file) return { status: 'none', groups: [], message: '' };
    const pageCount = split.file.pageCount;
    const mode = currentSplitMode();
    try {
      if (mode === 'single') {
        return { status: 'ok', groups: Core.singlePageGroups(pageCount) };
      }
      if (mode === 'chunk') {
        if (els.splitChunk.validity.badInput) {
          return { status: 'error', message: 'Bitte gib eine ganze Zahl ab 1 ein.' };
        }
        const raw = els.splitChunk.value.trim();
        if (!raw) return { status: 'hint', message: 'Bitte gib an, wie viele Seiten jede Datei enthalten soll.' };
        return { status: 'ok', groups: Core.chunkPages(pageCount, Number(raw)) };
      }
      if (mode === 'extract') {
        const raw = els.splitExtract.value;
        if (!raw.trim()) {
          return { status: 'hint', message: 'Noch keine Seiten ausgewählt.' };
        }
        return { status: 'ok', groups: [Core.parsePageList(raw, pageCount)] };
      }
      const raw = els.splitRanges.value;
      if (!raw.trim()) {
        return { status: 'hint', message: 'Noch keine Seitenbereiche angegeben.' };
      }
      return { status: 'ok', groups: Core.parseRangeGroups(raw, pageCount) };
    } catch (err) {
      return { status: 'error', message: errorMessage(err) };
    }
  }

  function truncate(text, maxLength) {
    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).replace(/[,\s]+$/, '')} …`;
  }

  function describeSplitPlan(plan, mode) {
    if (mode === 'extract') {
      const pages = plan.groups[0];
      return `Ergibt 1 Datei mit ${pagesLabel(pages.length)}: ${truncate(Core.formatPageGroup(pages), MAX_PREVIEW_CHARS)}`;
    }
    const shown = plan.groups.slice(0, MAX_PREVIEW_GROUPS).map((group) => Core.formatPageGroup(group));
    const rest = plan.groups.length - shown.length;
    const list = shown.join(' · ') + (rest > 0 ? ` · … (${integerFormat.format(rest)} weitere)` : '');
    return `Ergibt ${filesLabel(plan.groups.length)}: ${truncate(list, MAX_PREVIEW_CHARS)}`;
  }

  function updateModeUi(mode) {
    for (const radio of els.splitModes) radio.closest('.mode-option').classList.toggle('is-checked', radio.checked);
    for (const panel of els.splitModePanels) {
      const active = panel.dataset.modePanel === mode;
      panel.hidden = !active;
      for (const input of panel.querySelectorAll('input')) input.disabled = !active;
    }
    const extract = mode === 'extract';
    // "Seiten auswählen" always produces exactly one PDF, so the ZIP option does not apply there.
    els.splitZipOption.hidden = extract;
    els.splitThumbs.classList.toggle('is-selectable', extract);
    els.splitSelectTools.hidden = !(extract && split.file);
    if (!split.file) {
      els.splitPagesHint.textContent = 'Nach dem Laden siehst du hier alle Seiten.';
    } else if (extract) {
      els.splitPagesHint.textContent = 'Klicke auf Seiten, um sie auszuwählen (Umschalt-Klick wählt einen Bereich).';
    } else if (split.plan && split.plan.status === 'ok') {
      els.splitPagesHint.textContent = 'Die Zahl an jeder Seite zeigt, in welcher Datei sie landet.';
    } else {
      // Without a valid plan the pages carry no file numbers – only their page numbers.
      els.splitPagesHint.textContent =
        'Sobald die Aufteilung gültig ist, zeigt eine farbige Zahl an jeder Seite, in welcher Datei sie landet.';
    }
  }

  /** Re-evaluates the split settings: preview text, page badges/selection and the run button. */
  function updateSplit() {
    const mode = currentSplitMode();
    const plan = computeSplitPlan();
    split.plan = plan;
    updateModeUi(mode);

    const preview = els.splitPreview;
    preview.classList.toggle('is-error', plan.status === 'error');
    preview.classList.toggle('is-ready', plan.status === 'ok');
    if (plan.status === 'none') preview.textContent = 'Wähle zuerst eine PDF-Datei aus.';
    else if (plan.status === 'ok') preview.textContent = describeSplitPlan(plan, mode);
    else preview.textContent = plan.message;

    const invalidInput = mode === 'chunk' ? els.splitChunk : mode === 'ranges' ? els.splitRanges : mode === 'extract' ? els.splitExtract : null;
    for (const input of [els.splitChunk, els.splitRanges, els.splitExtract]) {
      if (input === invalidInput && plan.status === 'error') input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }

    updateSplitThumbs(plan, mode);
    updateSplitControls();
  }

  function updateSplitControls() {
    const plan = split.plan;
    els.splitRun.disabled = !split.file || !plan || plan.status !== 'ok' || isBusy();
    els.splitReset.disabled = isBusy();
  }

  function formatFileNumbers(numbers) {
    return numbers.length <= 2 ? numbers.join(',') : `${numbers[0]},…`;
  }

  function setThumbBadge(refs, key, content) {
    if (refs.badgeKey === key) return;
    refs.badgeKey = key;
    refs.badge.replaceChildren(...content);
  }

  function updateSplitThumbs(plan, mode) {
    if (!split.thumbs.length) return;
    const extract = mode === 'extract';
    let selection = null;
    let fileMap = null;

    if (extract) {
      if (plan.status === 'ok') split.extractPages = plan.groups[0];
      else if (plan.status === 'hint') split.extractPages = [];
      // On 'error' keep showing the last valid selection while the user is typing.
      selection = new Set(split.extractPages);
    } else if (plan.status === 'ok') {
      fileMap = new Map();
      plan.groups.forEach((group, groupIndex) => {
        for (const page of group) {
          const files = fileMap.get(page);
          if (!files) fileMap.set(page, [groupIndex + 1]);
          else if (files[files.length - 1] !== groupIndex + 1) files.push(groupIndex + 1);
        }
      });
    }

    els.splitThumbs.classList.toggle('has-selection', Boolean(selection && selection.size));

    split.thumbs.forEach((refs, index) => {
      const { button } = refs;
      const pageName = `Seite ${index + 1}`;
      if (extract) {
        const selected = selection.has(index);
        button.setAttribute('aria-pressed', String(selected));
        button.classList.remove('is-unused', 'is-even-file');
        button.setAttribute('aria-label', pageName);
        if (selected) setThumbBadge(refs, 'check', [icon('check')]);
        else setThumbBadge(refs, '', []);
        return;
      }

      button.removeAttribute('aria-pressed');
      const files = fileMap ? fileMap.get(index) : null;
      button.classList.toggle('is-unused', Boolean(fileMap) && !files);
      button.classList.toggle('is-even-file', Boolean(files) && files[0] % 2 === 0);
      if (files) {
        const text = formatFileNumbers(files);
        setThumbBadge(refs, `n${text}`, [text]);
        const where = files.length === 1 ? `Datei ${files[0]}` : `Dateien ${files.join(', ')}`;
        button.setAttribute('aria-label', `${pageName} – landet in ${where}`);
      } else {
        setThumbBadge(refs, '', []);
        button.setAttribute('aria-label', fileMap ? `${pageName} – nicht enthalten` : pageName);
      }
    });
  }

  function buildSplitThumbs(pageCount) {
    const fragment = document.createDocumentFragment();
    split.thumbs = [];
    split.focusIndex = 0;
    for (let index = 0; index < pageCount; index += 1) {
      const frame = h('span', { className: 'page-thumb-frame' }, [h('span', { className: 'page-thumb-placeholder' })]);
      const badge = h('span', { className: 'page-thumb-badge', attrs: { 'aria-hidden': 'true' } });
      const button = h(
        'button',
        { className: 'page-thumb', attrs: { type: 'button', 'data-page': index + 1, 'aria-label': `Seite ${index + 1}` } },
        [frame, h('span', { className: 'page-thumb-label', text: String(index + 1), attrs: { 'aria-hidden': 'true' } }), badge]
      );
      button.tabIndex = index === 0 ? 0 : -1;
      split.thumbs.push({ button, frame, badge, badgeKey: '' });
      fragment.append(button);
    }
    els.splitThumbs.replaceChildren(fragment);
  }

  function queueSplitThumbnail(index, token) {
    splitThumbQueue.push(async () => {
      if (token !== split.token) return;
      const doc = await split.previewPromise;
      const refs = split.thumbs[index];
      if (!doc || token !== split.token || !refs) return;
      if (els.panelSplit.hidden && split.observer) {
        // The tab was switched while this page waited in the queue: its frame has no size now.
        // Observe it again so it renders at the right size once the panel is visible.
        split.observer.observe(refs.button);
        return;
      }
      const width = Math.max(40, refs.frame.clientWidth - 8);
      const height = Math.max(54, refs.frame.clientHeight - 8);
      let canvas;
      try {
        canvas = await doc.renderThumbnail(index, width, height);
      } catch (err) {
        if (token !== split.token) return; // file was replaced meanwhile – expected cancellation
        throw err;
      }
      if (token === split.token) refs.frame.replaceChildren(canvas);
    });
  }

  /** Renders page thumbnails lazily as they scroll into view. */
  function startSplitPreview() {
    const token = split.token;
    if (!previewEnabled) return;

    split.previewPromise = Preview.open(split.file.bytes)
      .then((doc) => {
        if (token !== split.token) {
          doc.destroy();
          return null;
        }
        split.preview = doc;
        return doc;
      })
      .catch((err) => {
        console.warn('PDF-Tool: Seitenvorschau nicht verfügbar.', err);
        return null;
      });

    if ('IntersectionObserver' in window) {
      split.observer = new IntersectionObserver(
        (entries, observer) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            observer.unobserve(entry.target);
            queueSplitThumbnail(Number(entry.target.dataset.page) - 1, token);
          }
        },
        { rootMargin: '400px 0px' }
      );
      for (const refs of split.thumbs) split.observer.observe(refs.button);
    } else {
      split.thumbs.forEach((refs, index) => queueSplitThumbnail(index, token));
    }
  }

  function stopSplitPreview() {
    split.token += 1;
    splitThumbQueue.clear();
    if (split.observer) split.observer.disconnect();
    split.observer = null;
    if (split.preview) split.preview.destroy();
    split.preview = null;
    split.previewPromise = null;
  }

  /** Called on every change to the file or the split settings: the results no longer match them. */
  function clearSplitResults() {
    split.changes += 1;
    for (const url of split.resultUrls) URL.revokeObjectURL(url);
    split.resultUrls = [];
    els.splitResults.replaceChildren();
    els.splitResults.hidden = true;
  }

  function resetSplit() {
    split.loadSeq += 1; // a file still loading must not show up after the reset
    stopSplitPreview();
    split.file = null;
    split.thumbs = [];
    split.extractPages = [];
    split.lastClicked = null;
    els.splitThumbs.replaceChildren();
    els.splitExtract.value = '';
    clearSplitResults();
    els.splitFileInfo.hidden = true;
    els.splitDropzone.hidden = false;
    updateSplit();
  }

  async function loadSplitFile(files) {
    const file = files[0];
    // The drop targets stay usable while a file loads: if another file is chosen meanwhile,
    // only the most recently chosen one may be installed (or report its error).
    const seq = ++split.loadSeq;
    // After a successful load the (focused) file input is hidden, so focus moves on to „Andere Datei wählen“.
    const focusFallback = els.splitReset;
    await withBusy('Datei wird geladen …', async () => {
      let installing = false;
      try {
        const loaded = await readPdfFile(file);
        if (seq !== split.loadSeq) return;
        installing = true; // from here on loadSeq moves on (resetSplit), errors are still this file's
        resetSplit();
        const baseName = outputBaseName(loaded.name);
        split.file = { ...loaded, baseName };

        els.splitFileName.textContent = loaded.name;
        els.splitFileMeta.textContent = `${pagesLabel(loaded.pageCount)} · ${formatBytes(loaded.size)}`;
        els.splitFileInfo.hidden = false;
        els.splitDropzone.hidden = true;

        buildSplitThumbs(loaded.pageCount);
        updateSplit();
        startSplitPreview();

        const extra = files.length > 1 ? ' Es wird jeweils nur eine Datei geteilt – weitere wurden ignoriert.' : '';
        setStatus(`„${loaded.name}“ geladen (${pagesLabel(loaded.pageCount)}).${extra}`);
      } catch (err) {
        if (!installing && seq !== split.loadSeq) return; // a later choice replaced this file
        setStatus(errorMessage(err, file.name), 'error');
      }
    }, focusFallback);
  }

  /** "Bericht 2026.pdf" -> "Bericht 2026" (sanitized, at most MAX_BASE_NAME_CHARS characters). */
  function outputBaseName(fileName) {
    const base = Core.stripPdfExtension(Core.sanitizeFileName(fileName)) || 'dokument';
    const chars = Array.from(base);
    if (chars.length <= MAX_BASE_NAME_CHARS) return base;
    return chars.slice(0, MAX_BASE_NAME_CHARS).join('').replace(/[\s._-]+$/, '') || 'dokument';
  }

  function isAscending(pages) {
    for (let i = 1; i < pages.length; i += 1) if (pages[i] < pages[i - 1]) return false;
    return true;
  }

  /** Adds a page to the extract selection: sorted if the selection is sorted, otherwise appended. */
  function addPage(pages, page) {
    if (pages.includes(page)) return pages;
    if (!isAscending(pages)) return [...pages, page];
    const position = pages.findIndex((p) => p > page);
    return position === -1 ? [...pages, page] : [...pages.slice(0, position), page, ...pages.slice(position)];
  }

  function setExtractPages(pages) {
    els.splitExtract.value = pages.length ? Core.formatPageGroup(pages) : '';
    splitSettingsChanged();
  }

  /** The user changed how to split: drop the now outdated results and update the preview. */
  function splitSettingsChanged() {
    clearSplitResults();
    updateSplit();
    // #split-preview is not a live region (it changes on every keystroke): announce it once settled.
    announce(els.splitPreview.textContent, { settled: true });
  }

  function toggleExtractPage(index, extendRange) {
    let pages = split.extractPages.slice();
    const anchor = split.lastClicked;
    if (extendRange && anchor !== null && anchor !== index) {
      const [from, to] = anchor < index ? [anchor, index] : [index, anchor];
      for (let page = from; page <= to; page += 1) pages = addPage(pages, page);
    } else if (pages.includes(index)) {
      pages = pages.filter((page) => page !== index);
    } else {
      pages = addPage(pages, index);
    }
    split.lastClicked = index;
    setExtractPages(pages);
  }

  function focusThumb(index) {
    const refs = split.thumbs[index];
    if (!refs) return;
    const previous = split.thumbs[split.focusIndex];
    if (previous) previous.button.tabIndex = -1;
    refs.button.tabIndex = 0;
    split.focusIndex = index;
    refs.button.focus();
  }

  function gridColumnCount() {
    const template = getComputedStyle(els.splitThumbs).gridTemplateColumns;
    return Math.max(1, template.split(' ').filter(Boolean).length);
  }

  async function runSplit() {
    if (els.splitRun.disabled) return;
    const plan = split.plan;
    const mode = currentSplitMode();
    const file = split.file;
    const token = split.token;
    const changes = split.changes;
    const wantZip = els.splitZip.checked && plan.groups.length > 1 && mode !== 'extract';
    const busyText =
      mode === 'extract' ? 'Seiten werden extrahiert …' : `PDF wird in ${filesLabel(plan.groups.length)} geteilt …`;

    await withBusy(busyText, async () => {
      try {
        let outputs;
        if (mode === 'extract') {
          const pages = plan.groups[0];
          const bytes = await Core.extractPages(file.bytes, pages, { fileName: file.name });
          const name = `${file.baseName}_Auszug_${Core.formatPageGroupForFilename(pages)}.pdf`;
          outputs = [{ name, bytes, pageCount: pages.length }];
        } else {
          const results = await Core.splitPdf(file.bytes, plan.groups, { fileName: file.name });
          const names = Core.uniqueFileNames(
            plan.groups.map((group) => `${file.baseName}_${Core.formatPageGroupForFilename(group)}.pdf`)
          );
          outputs = results.map((bytes, i) => ({ name: names[i], bytes, pageCount: plan.groups[i].length }));
        }

        let zip = null;
        if (wantZip && window.JSZip) {
          zip = await buildZip(outputs, `${file.baseName}_geteilt.zip`);
        }
        // A different file was loaded while this one was being split: drop the stale results.
        if (token !== split.token) return;
        // The settings stay editable while splitting: results of the old settings must not be downloaded.
        if (split.changes !== changes) {
          setStatus('Die Einstellungen wurden während des Teilens geändert – bitte starte es erneut.');
          return;
        }
        showSplitResults(outputs, zip);

        if (zip) {
          setStatus(`Fertig! „${zip.name}“ mit ${filesLabel(outputs.length)} wurde erstellt.`, 'success');
        } else if (outputs.length === 1) {
          setStatus(`Fertig! „${outputs[0].name}“ wurde erstellt (${pagesLabel(outputs[0].pageCount)}).`, 'success');
        } else {
          setStatus(`Fertig! ${filesLabel(outputs.length)} wurden erstellt – lade sie einzeln aus der Liste herunter.`, 'success');
        }
      } catch (err) {
        if (token === split.token) setStatus(errorMessage(err), 'error');
      }
    });
  }

  async function buildZip(outputs, name) {
    setBusyMessage('ZIP-Archiv wird erstellt …');
    await yieldToBrowser();
    const archive = new window.JSZip();
    for (const output of outputs) archive.file(output.name, output.bytes);
    let lastPercent = -1;
    // STORE: the PDFs' streams are already Flate-compressed, so DEFLATE would save under 1 %
    // while taking several times as long for large splits.
    const blob = await archive.generateAsync(
      { type: 'blob', mimeType: 'application/zip', compression: 'STORE' },
      (meta) => {
        const percent = Math.floor(meta.percent);
        if (percent !== lastPercent) {
          lastPercent = percent;
          setBusyMessage(`ZIP-Archiv wird erstellt … ${percent} %`);
        }
      }
    );
    return { name, blob };
  }

  function showSplitResults(outputs, zip) {
    clearSplitResults();
    const children = [];
    const headline = outputs.length === 1 ? 'Fertig! Deine PDF ist bereit.' : `Fertig! ${filesLabel(outputs.length)} erstellt.`;
    children.push(h('p', { className: 'result-head' }, [icon('check-circle'), h('span', { text: headline })]));

    let autoDownload = null;
    if (zip) {
      const { link, url } = createDownloadLink(
        zip.blob,
        zip.name,
        'button button-primary',
        [icon('archive'), h('span', { text: 'Alle als ZIP herunterladen' })],
        'split-zip-download'
      );
      split.resultUrls.push(url);
      children.push(link);
      autoDownload = link;
    }

    let hint;
    if (zip) hint = `Das ZIP-Archiv (${formatBytes(zip.blob.size)}) wird automatisch heruntergeladen. Einzelne Dateien:`;
    else if (outputs.length === 1) hint = 'Der Download startet automatisch – falls nicht, klicke auf die Datei.';
    else hint = 'Klicke auf eine Datei, um sie herunterzuladen. Tipp: Mit „Als ZIP-Archiv herunterladen“ bekommst du alle auf einmal.';
    children.push(h('p', { className: 'result-text', text: hint }));

    const list = h('ul', { className: 'download-list', attrs: { 'aria-label': 'Erstellte Dateien' } });
    for (const output of outputs) {
      const blob = new Blob([output.bytes], { type: 'application/pdf' });
      const { link, url } = createDownloadLink(blob, output.name, 'download-link split-download', [
        icon('file'),
        h('span', { className: 'download-text' }, [
          h('span', { className: 'download-name', text: output.name, attrs: { title: output.name } }),
          h('span', { className: 'download-meta', text: `${pagesLabel(output.pageCount)} · ${formatBytes(blob.size)}` }),
        ]),
        icon('download'),
      ]);
      split.resultUrls.push(url);
      list.append(h('li', {}, [link]));
      if (!autoDownload && outputs.length === 1) autoDownload = link;
    }
    children.push(list);

    els.splitResults.append(...children);
    els.splitResults.hidden = false;
    revealElement(els.splitResults);
    // The run button is disabled while splitting, which drops its focus: continue at the result.
    if (focusIsLost()) (autoDownload || list.querySelector('a')).focus({ preventScroll: true });
    if (autoDownload) autoDownload.click();
  }

  function initSplit() {
    onFilesChosen(els.splitInput, loadSplitFile);
    setupFileDropTarget(els.splitDropzone, loadSplitFile);
    setupFileDropTarget(els.splitFileInfo, loadSplitFile);

    els.splitReset.addEventListener('click', () => {
      resetSplit();
      clearStatus();
      els.splitInput.focus();
    });

    for (const radio of els.splitModes) radio.addEventListener('change', splitSettingsChanged);
    for (const input of [els.splitChunk, els.splitRanges, els.splitExtract]) {
      input.addEventListener('input', splitSettingsChanged);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          runSplit();
        }
      });
    }
    els.splitRun.addEventListener('click', runSplit);

    els.splitSelectAll.addEventListener('click', () => {
      if (split.file) setExtractPages(Core.singlePageGroups(split.file.pageCount).flat());
    });
    els.splitSelectNone.addEventListener('click', () => setExtractPages([]));

    els.splitThumbs.addEventListener('click', (event) => {
      const button = event.target.closest('.page-thumb');
      if (!button || !split.file) return;
      const index = Number(button.dataset.page) - 1;
      focusThumb(index);
      if (currentSplitMode() === 'extract') toggleExtractPage(index, event.shiftKey);
    });

    // Roving tabindex: the page grid is a single tab stop, arrow keys move between pages.
    els.splitThumbs.addEventListener('keydown', (event) => {
      const button = event.target.closest('.page-thumb');
      if (!button) return;
      const index = Number(button.dataset.page) - 1;
      const last = split.thumbs.length - 1;
      let next = null;
      if (event.key === 'ArrowRight') next = index + 1;
      else if (event.key === 'ArrowLeft') next = index - 1;
      else if (event.key === 'ArrowDown') next = index + gridColumnCount();
      else if (event.key === 'ArrowUp') next = index - gridColumnCount();
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = last;
      if (next === null) return;
      event.preventDefault();
      focusThumb(Math.min(last, Math.max(0, next)));
    });

    updateSplit();
  }

  /* ================================================================== init */

  function init() {
    if (!Core || !window.PDFLib) {
      setStatus(
        'Die benötigten Programmbibliotheken konnten nicht geladen werden. Bitte lade die Seite neu oder prüfe, ob der Ordner „vendor“ vollständig ist.',
        'error'
      );
      for (const button of document.querySelectorAll('button, input')) button.disabled = true;
      return;
    }
    previewEnabled = Boolean(Preview && Preview.isAvailable());

    guardWindowDrops();
    initTabs();
    initMerge();
    initSplit();
    updateMergeControls();
  }

  init();
})();

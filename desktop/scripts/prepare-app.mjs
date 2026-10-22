// Copies the web app from the repository root into desktop/app/, which Electron serves as
// app://pdf-tool/ (see main.js) and electron-builder packs into app.asar.
// The web app stays the single source of truth; desktop/app/ is generated and gitignored.
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(DESKTOP_DIR, '..');
const TARGET_DIR = join(DESKTOP_DIR, 'app');

// Everything index.html needs at runtime – nothing else (no tests, node_modules, scripts …).
const ENTRIES = ['index.html', 'css', 'js', 'vendor'];
// Spot checks that the copy is complete (vendor/ includes the license texts linked in the footer).
const REQUIRED_FILES = [
  'index.html',
  'css/styles.css',
  'js/pdf-core.js',
  'js/preview.js',
  'js/app.js',
  'vendor/pdf-lib.min.js',
  'vendor/jszip.min.js',
  'vendor/pdf.min.js',
  'vendor/pdf.worker.min.js',
  'vendor/licenses/pdf-lib-LICENSE.md',
  'vendor/licenses/pdfjs-LICENSE',
  'vendor/licenses/jszip-LICENSE.md',
];

async function isFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

await rm(TARGET_DIR, { recursive: true, force: true });
await mkdir(TARGET_DIR, { recursive: true });

for (const entry of ENTRIES) {
  await cp(join(REPO_ROOT, entry), join(TARGET_DIR, entry), {
    recursive: true,
    // Skip hidden files such as .DS_Store.
    filter: (source) => !relative(REPO_ROOT, source).split(/[\\/]/).some((part) => part.startsWith('.')),
  });
}

const missing = [];
for (const file of REQUIRED_FILES) {
  if (!(await isFile(join(TARGET_DIR, file)))) missing.push(file);
}
if (missing.length > 0) {
  console.error(`prepare-app: Folgende Dateien fehlen in desktop/app/: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`prepare-app: Web-App nach ${relative(process.cwd(), TARGET_DIR) || '.'} kopiert.`);

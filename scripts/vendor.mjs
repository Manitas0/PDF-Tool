// Copies the browser builds of the third-party libraries from node_modules
// into vendor/ so the app runs without a build step (also from file://).
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => join(root, 'node_modules', p);
const out = (p) => join(root, 'vendor', p);

const files = [
  [nm('pdf-lib/dist/pdf-lib.min.js'), out('pdf-lib.min.js')],
  [nm('pdfjs-dist/build/pdf.min.js'), out('pdf.min.js')],
  [nm('pdfjs-dist/build/pdf.worker.min.js'), out('pdf.worker.min.js')],
  [nm('jszip/dist/jszip.min.js'), out('jszip.min.js')],
  [nm('pdf-lib/LICENSE.md'), out('licenses/pdf-lib-LICENSE.md')],
  [nm('pdfjs-dist/LICENSE'), out('licenses/pdfjs-LICENSE')],
  [nm('jszip/LICENSE.markdown'), out('licenses/jszip-LICENSE.md')],
];

mkdirSync(out('licenses'), { recursive: true });
for (const [from, to] of files) {
  copyFileSync(from, to);
  console.log(`${from.slice(root.length + 1)} -> ${to.slice(root.length + 1)}`);
}

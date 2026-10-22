// Renders the app logo (the inline <svg class="logo"> of index.html) to
//   - build/icon.png (512×512, transparent corners) – electron-builder derives the Windows .ico from it;
//   - build/splash.bmp (24-bit BMP) – shown by the portable .exe while it unpacks itself, which takes
//     a few seconds (without it the portable version gives no sign of life in the meantime).
//
// Usage (from desktop/): node scripts/make-icon.mjs
// Needs the repository root's dev dependencies (@playwright/test) and an installed Chromium
// for Playwright. Only has to be re-run when the logo changes; both files are checked in.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const DESKTOP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_HTML = join(DESKTOP_DIR, '..', 'index.html');
const ICON_OUTPUT = join(DESKTOP_DIR, 'build', 'icon.png');
const SPLASH_OUTPUT = join(DESKTOP_DIR, 'build', 'splash.bmp');
const ICON_SIZE = 512;
// Small transparent margin, like the system icons next to it in the taskbar and Start menu.
const ICON_PADDING = 16;
const SPLASH_WIDTH = 400;
const SPLASH_HEIGHT = 180;

const html = await readFile(INDEX_HTML, 'utf8');
const match = html.match(/<svg\b[^>]*\bclass="logo"[^>]*>[\s\S]*?<\/svg>/);
if (!match) {
  console.error('make-icon: Logo (<svg class="logo">) in index.html nicht gefunden.');
  process.exit(1);
}

/** The logo as a standalone SVG of the given size. */
function logoSvg(size) {
  return match[0]
    .replace(/\swidth="[^"]*"/, ` width="${size}"`)
    .replace(/\sheight="[^"]*"/, ` height="${size}"`)
    .replace(/\saria-hidden="[^"]*"/, '')
    .replace(/\sfocusable="[^"]*"/, '')
    .replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
}

/** Uncompressed 24-bit BMP (bottom-up rows, padded to 4 bytes) from RGBA pixels. */
function encodeBmp24(width, height, rgba) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const imageSize = rowSize * height;
  const bmp = Buffer.alloc(54 + imageSize);
  bmp.write('BM', 0, 'ascii');
  bmp.writeUInt32LE(54 + imageSize, 2); // file size
  bmp.writeUInt32LE(54, 10); // offset of the pixel data
  bmp.writeUInt32LE(40, 14); // BITMAPINFOHEADER
  bmp.writeInt32LE(width, 18);
  bmp.writeInt32LE(height, 22); // positive: bottom-up
  bmp.writeUInt16LE(1, 26); // planes
  bmp.writeUInt16LE(24, 28); // bits per pixel
  bmp.writeUInt32LE(0, 30); // BI_RGB, uncompressed
  bmp.writeUInt32LE(imageSize, 34);
  bmp.writeInt32LE(2835, 38); // 72 dpi
  bmp.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y += 1) {
    const row = 54 + (height - 1 - y) * rowSize;
    for (let x = 0; x < width; x += 1) {
      const source = (y * width + x) * 4;
      bmp[row + x * 3] = rgba[source + 2]; // blue
      bmp[row + x * 3 + 1] = rgba[source + 1]; // green
      bmp[row + x * 3 + 2] = rgba[source]; // red
    }
  }
  return bmp;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: ICON_SIZE, height: ICON_SIZE }, deviceScaleFactor: 1 });

  await page.setContent(
    `<!doctype html><html><head><style>
      html, body { margin: 0; background: transparent; }
      body { width: ${ICON_SIZE}px; height: ${ICON_SIZE}px; display: grid; place-items: center; }
      svg { display: block; }
    </style></head><body>${logoSvg(ICON_SIZE - 2 * ICON_PADDING)}</body></html>`
  );
  const icon = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: ICON_SIZE, height: ICON_SIZE } });
  await mkdir(dirname(ICON_OUTPUT), { recursive: true });
  await writeFile(ICON_OUTPUT, icon);
  console.log(`make-icon: ${ICON_OUTPUT} (${ICON_SIZE}×${ICON_SIZE}) geschrieben.`);

  // Splash: light card with logo and „PDF-Tool wird gestartet …“ (colors of css/styles.css).
  await page.setViewportSize({ width: SPLASH_WIDTH, height: SPLASH_HEIGHT });
  await page.setContent(
    `<!doctype html><html lang="de"><head><style>
      html, body { margin: 0; }
      body {
        box-sizing: border-box; width: ${SPLASH_WIDTH}px; height: ${SPLASH_HEIGHT}px;
        display: flex; align-items: center; gap: 24px; padding: 0 40px;
        background: #ffffff; border: 1px solid #c3c9d8;
        font-family: "Segoe UI", Inter, system-ui, sans-serif;
      }
      svg { display: block; flex: none; }
      .name { font-size: 30px; font-weight: 700; color: #171a23; }
      .status { margin-top: 6px; font-size: 16px; color: #3b5bdb; }
      .hint { margin-top: 8px; font-size: 13px; color: #555e72; }
    </style></head><body>
      ${logoSvg(76)}
      <div>
        <div class="name">PDF-Tool</div>
        <div class="status">wird gestartet …</div>
        <div class="hint">Das kann einige Sekunden dauern.</div>
      </div>
    </body></html>`
  );
  const splashPng = await page.screenshot({ clip: { x: 0, y: 0, width: SPLASH_WIDTH, height: SPLASH_HEIGHT } });
  // Decode the PNG with the browser's own canvas – no image library needed.
  const rgba = await page.evaluate(async ({ base64, width, height }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return Array.from(context.getImageData(0, 0, width, height).data);
  }, { base64: splashPng.toString('base64'), width: SPLASH_WIDTH, height: SPLASH_HEIGHT });
  await writeFile(SPLASH_OUTPUT, encodeBmp24(SPLASH_WIDTH, SPLASH_HEIGHT, rgba));
  console.log(`make-icon: ${SPLASH_OUTPUT} (${SPLASH_WIDTH}×${SPLASH_HEIGHT}) geschrieben.`);
} finally {
  await browser.close();
}

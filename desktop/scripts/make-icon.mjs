// Renders the app logo (the inline <svg class="logo"> of index.html) to
//   - build/icon.png (512×512, transparent corners) – electron-builder derives the Windows .ico from it;
//   - build/splash.bmp (24-bit BMP) – shown by the portable .exe while it unpacks itself, which takes
//     a few seconds (without it the portable version gives no sign of life in the meantime);
//   - build/appx/*.png – the tile and Store images of the Microsoft Store package (MSIX/AppX, see
//     "appx" in package.json). Without them electron-builder would ship its generic sample images.
//
// Usage (from desktop/): node scripts/make-icon.mjs
// Needs the repository root's dev dependencies (@playwright/test) and an installed Chromium
// for Playwright. Only has to be re-run when the logo changes; all files are checked in.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const DESKTOP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const INDEX_HTML = join(DESKTOP_DIR, '..', 'index.html');
const ICON_OUTPUT = join(DESKTOP_DIR, 'build', 'icon.png');
const SPLASH_OUTPUT = join(DESKTOP_DIR, 'build', 'splash.bmp');
const APPX_OUTPUT_DIR = join(DESKTOP_DIR, 'build', 'appx');
const ICON_SIZE = 512;
// Small transparent margin, like the system icons next to it in the taskbar and Start menu.
const ICON_PADDING = 16;
const SPLASH_WIDTH = 400;
const SPLASH_HEIGHT = 180;

/*
 * Microsoft Store package images. electron-builder 26.17.0 (app-builder-lib/out/targets/AppxTarget.js)
 * maps every file of build/appx/ to assets\<file name> in the package and lets the manifest refer to
 * the base names: StoreLogo.png (package logo), Square44x44Logo.png (app icon), Square150x150Logo.png
 * and Wide310x150Logo.png (tiles), plus LargeTile.png and SmallTile.png when present. As soon as a file
 * name contains ".scale-" or ".targetsize-", it indexes the folder with makepri into resources.pri,
 * through which Windows picks the variant that fits (the usual MRT naming: <name>.scale-200.png,
 * <name>.targetsize-24_altform-unplated.png). Note: electron-builder's makepri configuration moves
 * scale variants other than 100 into separate resources.scale-*.pri files meant for bundles, so a
 * single package may only offer scale-100 for tiles and StoreLogo – the CI job "msstore" prints what
 * the package's resources.pri really contains. The targetsize variants (taskbar, Start menu,
 * Explorer) are not affected. The folder is generated completely, so it must not contain anything
 * else – every file in it ends up in the package.
 *
 * Two looks:
 *   'logo' – the logo as it is: rounded corners and a transparent margin of 1/32 of the size, like
 *            build/icon.png. For places where Windows draws the image without a background.
 *   'tile' – opaque, full-bleed logo gradient with the logo's document in the middle. For the places
 *            where Windows 10 puts the image on a tile or a coloured plate (Start tiles, "Alle Apps").
 *            `glyph` is the document's height and `center` the vertical position of its middle, both
 *            as a fraction of the image height; Square150x150Logo and Wide310x150Logo leave room for
 *            the app name that Windows 10 writes at the bottom (appx.showNameOnTiles).
 * Sizes per scale follow Microsoft's table of tile and icon asset sizes (rounded half up).
 */
const APPX_SCALES = [100, 125, 150, 200, 400];
const APPX_IMAGES = [
  // Package logo: Microsoft Store, App Installer, installation dialogs.
  { name: 'StoreLogo', width: 50, height: 50, look: 'logo' },
  // App icon by display scale: Windows 10 Start menu list, on a plate.
  { name: 'Square44x44Logo', width: 44, height: 44, look: 'tile', glyph: 0.58 },
  // Start tiles of Windows 10 (small, medium, wide, large).
  { name: 'SmallTile', width: 71, height: 71, look: 'tile', glyph: 0.56 },
  { name: 'Square150x150Logo', width: 150, height: 150, look: 'tile', glyph: 0.46, center: 0.44 },
  { name: 'Wide310x150Logo', width: 310, height: 150, look: 'tile', glyph: 0.46, center: 0.44 },
  { name: 'LargeTile', width: 310, height: 310, look: 'tile', glyph: 0.36 },
];
// App icon by pixel size: taskbar, Alt+Tab, Start menu of Windows 11, Explorer, Settings … Windows
// uses the "altform-unplated" variant as it is and puts the plain one on a plate (Windows 10).
const APPX_TARGET_SIZES = [16, 24, 32, 48, 256];
// Large enough for the biggest image (LargeTile at 400 %: 1240×1240); screenshots are clipped.
const APPX_VIEWPORT = 1280;

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

/**
 * The logo split into its parts: viewBox, <defs> (the gradient), the fill of the rounded background
 * <rect> and everything drawn on top of it (the document, "glyph").
 */
function logoParts() {
  const svg = match[0];
  const viewBox = svg.match(/\sviewBox="([^"]*)"/)?.[1];
  const defs = svg.match(/<defs>[\s\S]*?<\/defs>/)?.[0] ?? '';
  const background = svg.match(/<rect\b[^>]*\/>/)?.[0];
  const fill = background?.match(/\sfill="([^"]*)"/)?.[1];
  if (!viewBox || !background || !fill) {
    throw new Error('make-icon: Logo hat nicht den erwarteten Aufbau (viewBox, <rect fill="…"> als Hintergrund).');
  }
  const inner = svg.replace(/^<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return { viewBox, defs, fill, inner, glyph: inner.replace(defs, '').replace(background, '') };
}

/** The whole logo on a transparent square of `size` px with a margin of 1/32 (like build/icon.png). */
function logoImageSvg(logo, size) {
  const padding = Math.floor(size / 32);
  const inner = size - 2 * padding;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <svg x="${padding}" y="${padding}" width="${inner}" height="${inner}" viewBox="${logo.viewBox}">${logo.inner}</svg>
  </svg>`;
}

/** Opaque width × height image: the logo's background fill edge to edge, its document on top. */
function tileImageSvg(logo, glyphBox, width, height, glyph, center) {
  const glyphHeight = height * glyph;
  const glyphWidth = (glyphHeight * glyphBox.width) / glyphBox.height;
  // Whole-pixel position keeps the document's straight edges sharp.
  const x = Math.round((width - glyphWidth) / 2);
  const y = Math.round(height * center - glyphHeight / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    ${logo.defs}
    <rect width="${width}" height="${height}" fill="${logo.fill}"/>
    <svg x="${x}" y="${y}" width="${glyphWidth}" height="${glyphHeight}"
      viewBox="${glyphBox.x} ${glyphBox.y} ${glyphBox.width} ${glyphBox.height}">${logo.glyph}</svg>
  </svg>`;
}

/** PNG filter predictor (0 None, 1 Sub, 2 Up, 3 Average, 4 Paeth) from left, upper and upper-left byte. */
function pngPredict(filter, left, up, upLeft) {
  switch (filter) {
    case 0:
      return 0;
    case 1:
      return left;
    case 2:
      return up;
    case 3:
      return (left + up) >> 1;
    case 4: {
      const p = left + up - upLeft;
      const pLeft = Math.abs(p - left);
      const pUp = Math.abs(p - up);
      const pUpLeft = Math.abs(p - upLeft);
      if (pLeft <= pUp && pLeft <= pUpLeft) return left;
      return pUp <= pUpLeft ? up : upLeft;
    }
    default:
      throw new Error(`make-icon: unbekannter PNG-Filter ${filter}`);
  }
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 'latin1');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

/**
 * Losslessly recompresses a PNG screenshot of Chromium (8 bit RGB/RGBA, not interlaced; Chromium
 * compresses for speed): a filter per row by the usual minimum-sum heuristic and zlib level 9.
 * The tile images shrink to about a third – the dithered gradient compresses badly otherwise.
 */
function recompressPng(png) {
  let header = null;
  const compressed = [];
  for (let offset = 8; offset < png.length; ) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = data;
    else if (type === 'IDAT') compressed.push(data);
    offset += 12 + length;
  }
  if (!header || header[8] !== 8 || (header[9] !== 2 && header[9] !== 6) || header[12] !== 0) return png;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bytesPerPixel = header[9] === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  const raw = inflateSync(Buffer.concat(compressed));

  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
      const up = previous ? previous[i] : 0;
      const upLeft = previous && i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
      row[i] = (line[i] + pngPredict(filter, left, up, upLeft)) & 0xff;
    }
  }

  const filtered = Buffer.alloc((stride + 1) * height);
  const candidate = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const row = pixels.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    let bestFilter = 0;
    let bestScore = Infinity;
    for (let filter = 0; filter <= 4; filter += 1) {
      let score = 0;
      for (let i = 0; i < stride; i += 1) {
        const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
        const up = previous ? previous[i] : 0;
        const upLeft = previous && i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
        const value = (row[i] - pngPredict(filter, left, up, upLeft)) & 0xff;
        score += value < 128 ? value : 256 - value;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
      }
    }
    const target = filtered.subarray(y * (stride + 1), (y + 1) * (stride + 1));
    target[0] = bestFilter;
    for (let i = 0; i < stride; i += 1) {
      const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
      const up = previous ? previous[i] : 0;
      const upLeft = previous && i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
      candidate[i] = (row[i] - pngPredict(bestFilter, left, up, upLeft)) & 0xff;
    }
    candidate.copy(target, 1);
  }

  const result = Buffer.concat([
    png.subarray(0, 8), // signature
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(filtered, { level: 9, memLevel: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  return result.length < png.length ? result : png;
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

  // Microsoft Store package images (see APPX_IMAGES above).
  const logo = logoParts();
  await page.setViewportSize({ width: APPX_VIEWPORT, height: APPX_VIEWPORT });
  // Bounding box of the document in logo coordinates, to place it on the tiles.
  await page.setContent(
    `<!doctype html><html><body><svg xmlns="http://www.w3.org/2000/svg" viewBox="${logo.viewBox}"
      width="320" height="320">${logo.defs}<g id="glyph">${logo.glyph}</g></svg></body></html>`
  );
  const glyphBox = await page.evaluate(() => {
    const box = document.getElementById('glyph').getBBox();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  });

  await rm(APPX_OUTPUT_DIR, { recursive: true, force: true });
  await mkdir(APPX_OUTPUT_DIR, { recursive: true });
  const appxImages = [];
  for (const image of APPX_IMAGES) {
    for (const scale of APPX_SCALES) {
      appxImages.push({
        file: `${image.name}.scale-${scale}.png`,
        width: Math.round((image.width * scale) / 100),
        height: Math.round((image.height * scale) / 100),
        look: image.look,
        glyph: image.glyph,
        center: image.center,
      });
    }
  }
  const appIcon = APPX_IMAGES.find((image) => image.name === 'Square44x44Logo');
  for (const size of APPX_TARGET_SIZES) {
    appxImages.push({ file: `Square44x44Logo.targetsize-${size}.png`, width: size, height: size, look: 'tile', glyph: appIcon.glyph });
    appxImages.push({ file: `Square44x44Logo.targetsize-${size}_altform-unplated.png`, width: size, height: size, look: 'logo' });
  }

  for (const image of appxImages) {
    const svg = image.look === 'logo'
      ? logoImageSvg(logo, image.width)
      : tileImageSvg(logo, glyphBox, image.width, image.height, image.glyph, image.center ?? 0.5);
    await page.setContent(
      `<!doctype html><html><head><style>
        html, body { margin: 0; background: transparent; }
        svg { display: block; }
      </style></head><body>${svg}</body></html>`
    );
    const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: image.width, height: image.height } });
    await writeFile(join(APPX_OUTPUT_DIR, image.file), recompressPng(png));
  }
  console.log(`make-icon: ${appxImages.length} Bilder für das Microsoft-Store-Paket nach ${APPX_OUTPUT_DIR} geschrieben.`);
} finally {
  await browser.close();
}

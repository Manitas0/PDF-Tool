#!/usr/bin/env node
// Minimal, dependency-free static file server for local development and the
// end-to-end tests. Serves the repository root on http://127.0.0.1:PORT/.
//
//   npm run serve            -> http://127.0.0.1:8080/
//   PORT=4173 npm run serve  -> http://127.0.0.1:4173/
//
// Security notes:
//   - The raw request path is decoded and resolved against the root; anything
//     that ends up outside the root (`/../`, `%2e%2e`, `..%2f`, `..\`, symlinks)
//     is rejected with 403.
//   - Hidden path segments (`.git`, `.github`, …) are never served.
//   - The server binds to 127.0.0.1 only, so it is not reachable from the network.
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = parsePort(process.env.PORT, 8080);
const ROOT = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  // Files without extension in this repo are license texts (e.g. vendor/licenses/pdfjs-LICENSE).
  '': 'text/plain; charset=utf-8',
};
const FALLBACK_MIME_TYPE = 'application/octet-stream';

function parsePort(value, fallback) {
  if (value === undefined || value === '') return fallback;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Ungültiger PORT: „${value}“ (erwartet wird eine Zahl zwischen 0 und 65535).`);
    process.exit(1);
  }
  return port;
}

function isInsideRoot(path) {
  return path === ROOT || path.startsWith(ROOT + sep);
}

function sendText(res, status, message, headers = {}) {
  const body = `${message}\n`;
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(res.req.method === 'HEAD' ? undefined : body);
}

/**
 * Maps the raw request target to an absolute file path inside ROOT.
 * Returns `{ status }` instead when the request must be refused.
 */
async function resolveRequestPath(rawUrl) {
  // Use the raw path (not `new URL()`), which would silently normalise
  // `/../` away; we want to detect and refuse traversal attempts explicitly.
  const rawPath = rawUrl.split(/[?#]/, 1)[0];
  if (!rawPath.startsWith('/')) return { status: 400 };

  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { status: 400 };
  }
  if (decoded.includes('\0')) return { status: 400 };

  const segments = decoded.split(/[/\\]+/).filter((segment) => segment !== '' && segment !== '.');
  if (segments.includes('..')) return { status: 403 };
  if (segments.some((segment) => segment.startsWith('.'))) return { status: 404 };

  let filePath = join(ROOT, ...segments);
  if (!isInsideRoot(filePath)) return { status: 403 };

  let info;
  try {
    // realpath() resolves symlinks, so a link pointing outside the root is refused as well.
    filePath = await realpath(filePath);
    if (!isInsideRoot(filePath)) return { status: 403 };
    info = await stat(filePath);
  } catch {
    return { status: 404 };
  }

  if (info.isDirectory()) {
    // Redirect `/dir` to `/dir/` so relative URLs inside the page keep working.
    if (!rawPath.endsWith('/')) {
      // Build the target from the normalised segments (never echo `//host` back).
      return { status: 301, location: `/${segments.map(encodeURIComponent).join('/')}/` };
    }
    return resolveIndexFile(filePath);
  }
  return info.isFile() ? { filePath, size: info.size } : { status: 404 };
}

async function resolveIndexFile(directory) {
  try {
    const filePath = await realpath(join(directory, 'index.html'));
    if (!isInsideRoot(filePath)) return { status: 403 };
    const info = await stat(filePath);
    return info.isFile() ? { filePath, size: info.size } : { status: 404 };
  } catch {
    return { status: 404 }; // no directory listings
  }
}

const STATUS_TEXT = {
  400: 'Ungültige Anfrage',
  403: 'Zugriff verweigert',
  404: 'Nicht gefunden',
};

async function handleRequest(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Methode nicht erlaubt', { Allow: 'GET, HEAD' });
    return;
  }

  const result = await resolveRequestPath(req.url ?? '/');
  if (result.status === 301) {
    sendText(res, 301, `Weiterleitung nach ${result.location}`, { Location: result.location });
    return;
  }
  if (result.status) {
    sendText(res, result.status, STATUS_TEXT[result.status] ?? 'Fehler');
    return;
  }

  const contentType = MIME_TYPES[extname(result.filePath).toLowerCase()] ?? FALLBACK_MIME_TYPE;
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': result.size,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  const stream = createReadStream(result.filePath);
  stream.on('error', (err) => {
    console.error(`Fehler beim Lesen von ${result.filePath}: ${err.message}`);
    res.destroy(err);
  });
  stream.pipe(res);
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    console.error(`Interner Fehler bei ${req.method} ${req.url}:`, err);
    if (res.headersSent) res.destroy(err);
    else sendText(res, 500, 'Interner Serverfehler');
  });
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} ist bereits belegt. Starte mit einem anderen Port, z. B. PORT=8081 npm run serve`);
  } else {
    console.error(`Server konnte nicht gestartet werden: ${err.message}`);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const { port } = server.address();
  console.log(`PDF-Tool läuft auf http://${HOST}:${port}/ (Beenden mit Strg+C)`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // Keep-alive connections could delay close(); do not hang forever.
    setTimeout(() => process.exit(0), 1000).unref();
  });
}

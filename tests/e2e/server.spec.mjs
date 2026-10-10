// Checks the development server (scripts/serve.mjs) that Playwright starts.
// Uses node:http directly, because browsers and Playwright's request API
// normalise paths like `/../` before sending them.
import { request as httpRequest } from 'node:http';
import { test, expect } from './helpers.mjs';

function rawRequest(baseURL, path, method = 'GET') {
  const { hostname, port } = new URL(baseURL);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname, port, path, method }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test.describe('Entwicklungsserver', () => {
  test('liefert Dateien mit passendem MIME-Typ aus', async ({ baseURL }) => {
    const expected = {
      '/': 'text/html',
      '/index.html': 'text/html',
      '/js/app.js': 'text/javascript',
      '/css/styles.css': 'text/css',
      '/vendor/pdf.worker.min.js': 'text/javascript',
      '/package.json': 'application/json',
      '/README.md': 'text/markdown',
    };
    for (const [path, type] of Object.entries(expected)) {
      const res = await rawRequest(baseURL, path);
      expect(res.status, path).toBe(200);
      expect(res.headers['content-type'], path).toContain(type);
      expect(res.headers['x-content-type-options'], path).toBe('nosniff');
    }
  });

  test('beantwortet HEAD ohne Inhalt und lehnt andere Methoden ab', async ({ baseURL }) => {
    const head = await rawRequest(baseURL, '/index.html', 'HEAD');
    expect(head.status).toBe(200);
    expect(Number(head.headers['content-length'])).toBeGreaterThan(0);
    expect(head.body.length).toBe(0);

    const post = await rawRequest(baseURL, '/', 'POST');
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe('GET, HEAD');
  });

  test('antwortet mit 404 auf fehlende Dateien und versteckte Pfade', async ({ baseURL }) => {
    for (const path of ['/gibt-es-nicht.html', '/js/', '/.git/config', '/.gitignore']) {
      expect((await rawRequest(baseURL, path)).status, path).toBe(404);
    }
  });

  test('leitet Verzeichnisse ohne Schrägstrich sicher um', async ({ baseURL }) => {
    const res = await rawRequest(baseURL, '//js');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/js/');
  });

  test('verhindert Path Traversal', async ({ baseURL }) => {
    const attempts = [
      '/../package.json',
      '/../../../../etc/passwd',
      '/js/../../package.json',
      '/%2e%2e/package.json',
      '/..%2fpackage.json',
      '/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '/..%5cpackage.json',
      '/js/..\\..\\package.json',
    ];
    for (const path of attempts) {
      const res = await rawRequest(baseURL, path);
      expect(res.status, path).toBe(403);
    }
    for (const path of ['/%E0%A4%A', '/index.html%00.js']) {
      expect((await rawRequest(baseURL, path)).status, path).toBe(400);
    }
  });
});

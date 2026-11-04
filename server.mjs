import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { handleApi, SECURITY_HEADERS } from './src/market.js';

const publicDirectory = path.resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const server = http.createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const response = await handleApi(new Request(url, { method: incoming.method }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(incoming.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
      outgoing.writeHead(405, { ...SECURITY_HEADERS, Allow: 'GET, HEAD' }); outgoing.end(); return;
    }
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { outgoing.writeHead(400, SECURITY_HEADERS); outgoing.end('Bad request'); return; }
    const file = path.resolve(publicDirectory, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${publicDirectory}${path.sep}`) || pathname.includes('\0')) {
      outgoing.writeHead(403, SECURITY_HEADERS); outgoing.end('Forbidden'); return;
    }
    try {
      const data = await readFile(file);
      outgoing.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Content-Length': data.length, 'Cache-Control': 'no-cache' });
      outgoing.end(incoming.method === 'HEAD' ? undefined : data);
    } catch { outgoing.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }); outgoing.end('ページが見つかりません。'); }
  } catch {
    outgoing.writeHead(500, SECURITY_HEADERS); outgoing.end('Server error');
  }
});
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
server.listen(port, host, () => console.log(`MANGO Sec. http://${host}:${port}`));

#!/usr/bin/env node
/** Dependency-free static server for local play: `npm start`. */

import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[3] ?? '.');
const port = Number(process.env.PORT ?? process.argv[2] ?? 8000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const requested = decodeURIComponent(url.pathname) === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const path = join(root, normalize(requested).replace(/^(\.\.[/\\])+/, ''));

  if (!path.startsWith(root)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    if (!statSync(path).isFile()) throw new Error('not a file');
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }

  response.writeHead(200, {
    'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  createReadStream(path).pipe(response);
}).listen(port, () => {
  console.log(`Tumblers on http://localhost:${port}`);
});

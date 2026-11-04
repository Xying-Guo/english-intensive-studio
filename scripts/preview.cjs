'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const port = Number(process.env.STUDIO_PREVIEW_PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const relative = pathname === '/' ? '/sidepanel.html' : pathname;
  const target = path.resolve(root, '.' + relative);
  if (!target.startsWith(root + path.sep) || !['.html', '.js', '.css', '.json'].includes(path.extname(target))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(target, (error, bytes) => {
    if (error) { res.writeHead(404); res.end('Not found'); return; }
    const testing = new URL(req.url, 'http://localhost').searchParams.has('testRecorder');
    if (testing && path.basename(target) === 'sidepanel.html') {
      bytes = Buffer.from(bytes.toString('utf8').replace('<script src="core.js" defer>', '<script src="tests/synthetic-mic.js" defer></script><script src="core.js" defer>'));
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(target)], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(bytes);
  });
});
server.listen(port, '127.0.0.1', () => console.log(`Preview (synthetic captions; no YouTube): http://127.0.0.1:${port}/sidepanel.html?preview=1`));

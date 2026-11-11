/* Static-only server for the WorkBuddy cloud static app (web/static.html). No /api/* routes. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = __dirname;
const FIRST = 8765;
const LAST = 8775;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

function listen(port) {
  if (port > LAST) {
    console.log('ERROR: no free port between 8765 and 8775.');
    process.exit(1);
  }
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0]);
    if (rel === '/') rel = '/static.html';
    const file = path.resolve(ROOT, '.' + rel);
    if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    if (path.basename(file).toLowerCase().startsWith('anxiang.db')) {
      res.writeHead(404); res.end('Not found'); return;
    }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    });
  });
  server.on('error', () => listen(port + 1));
  server.listen(port, '127.0.0.1', () => {
    const url = 'http://127.0.0.1:' + port + '/static.html';
    console.log('Local server started: ' + url);
    console.log('Folder: ' + ROOT);
    console.log('Keep this window open. Close it or press Ctrl+C to stop the server.');
    if (process.env.ELDER_NO_BROWSER !== '1') {
      setTimeout(() => {
        const cmd = process.platform === 'win32'
          ? 'start "" "' + url + '"'
          : 'open "' + url + '"';
        cp.exec(cmd, () => {});
      }, 800);
    }
  });
}

listen(FIRST);

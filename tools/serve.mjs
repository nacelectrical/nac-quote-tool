import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = '/home/user/nac-quote-tool';
// Character set declared on every text type. Without it the browser guesses,
// and a UTF-8 page of em dashes and m² renders as mojibake.
const TYPES = { '.html':'text/html; charset=utf-8', '.mjs':'text/javascript; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css', '.json':'application/json', '.jpg':'image/jpeg', '.png':'image/png', '.sql':'text/plain' };
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, url === '/' ? 'designer.html' : url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(8777, () => console.log('serving on 8777'));

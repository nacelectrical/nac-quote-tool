import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = '/home/user/nac-quote-tool';
const TYPES = { '.html':'text/html', '.mjs':'text/javascript', '.js':'text/javascript',
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

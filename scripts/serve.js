import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('dist');
const files = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/style.css': ['style.css', 'text/css; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'] };
http.createServer(async (req, res) => {
  const route = files[new URL(req.url, 'http://localhost').pathname];
  if (!route) { res.writeHead(404); return res.end('Not found'); }
  try { const bytes = await fs.readFile(path.join(root, route[0])); res.writeHead(200, { 'content-type': route[1], 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; connect-src https://rpc.mainnet.arc.io https://rpc.testnet.arc.io; object-src 'none'; base-uri 'none'" }); res.end(bytes); }
  catch { res.writeHead(500); res.end('Build the app before serving.'); }
}).listen(47825, '127.0.0.1', () => console.log('Local prototype: http://127.0.0.1:47825'));

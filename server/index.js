'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const db = require('./db/db');
const auth = require('./lib/auth');
const { Router, readJsonBody } = require('./lib/router');
const { attachUser } = require('./lib/middleware');

// --- DB bootstrap -----------------------------------------------------
async function bootstrap() {
  await db.migrate();
  await db.seedIfEmpty();
  await auth.ensureDefaultAdmin();
}

// --- Router assembly ----------------------------------------------------
const root = new Router();
root.use(attachUser);

const routeModules = [
  require('./routes/auth'),
  require('./routes/customers'),
  require('./routes/suppliers'),
  require('./routes/products'),
  require('./routes/requests'),
  require('./routes/rfqs'),
  require('./routes/quotations'),
  require('./routes/customerQuotations'),
  require('./routes/orders'),
  require('./routes/dashboard'),
];
for (const mod of routeModules) {
  root.routes.push(...mod.routes);
}

// --- Static frontend ------------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end('Forbidden'); return true; }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html'); // SPA fallback
  }
  if (!fs.existsSync(filePath)) return false;
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      req.body = await readJsonBody(req);
      await root.handle(req, res);
    } else {
      const handled = serveStatic(req, res);
      if (!handled) { res.writeHead(404); res.end('Not found'); }
    }
  } catch (err) {
    console.error(err);
    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error', detail: err.message }));
    }
  }
});

const PORT = process.env.PORT || 3000;
bootstrap().then(() => {
  server.listen(PORT, () => {
    console.log(`Veyrona server listening on http://localhost:${PORT}`);
    console.log(`Database: ${db.DB_PATH}`);
  });
}).catch((err) => {
  console.error('Failed to bootstrap Veyrona:', err);
  process.exit(1);
});

module.exports = server;

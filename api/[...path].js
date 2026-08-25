'use strict';

// Vercel serverless entrypoint. This file exists ONLY to adapt the same
// Express-like Router used by server/index.js (local dev) to Vercel's
// per-request Node.js function model. All business logic lives in
// server/routes/*, server/services/*, server/lib/* — unchanged between
// local (SQLite) and Vercel (Postgres/Neon) because server/db/db.js picks
// the backend based on DATABASE_URL.

const db = require('../server/db/db');
const auth = require('../server/lib/auth');
const { Router, readJsonBody } = require('../server/lib/router');
const { attachUser } = require('../server/lib/middleware');

const root = new Router();
root.use(attachUser);

const routeModules = [
  require('../server/routes/auth'),
  require('../server/routes/customers'),
  require('../server/routes/suppliers'),
  require('../server/routes/products'),
  require('../server/routes/requests'),
  require('../server/routes/rfqs'),
  require('../server/routes/quotations'),
  require('../server/routes/customerQuotations'),
  require('../server/routes/orders'),
  require('../server/routes/dashboard'),
  require('../server/routes/whatsapp'),
];
for (const mod of routeModules) {
  root.routes.push(...mod.routes);
}

// Cold-start bootstrap (schema + seed + default admin), cached across
// warm invocations of the same function instance. Idempotent either way
// (CREATE TABLE IF NOT EXISTS / row-count checks), so a race between two
// concurrent cold starts is harmless.
let bootstrapPromise = null;
function bootstrap() {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await db.migrate();
      await db.seedIfEmpty();
      await auth.ensureDefaultAdmin();
    })().catch((err) => {
      bootstrapPromise = null; // allow retry on the next invocation
      throw err;
    });
  }
  return bootstrapPromise;
}

module.exports = async (req, res) => {
  try {
    await bootstrap();

    // Vercel's Node runtime parses JSON bodies into req.body automatically.
    // Fall back to manual parsing only if that didn't happen (e.g. a body
    // stream that wasn't pre-consumed), so this works under `vercel dev` too.
    if (!req.body || typeof req.body !== 'object') {
      req.body = await readJsonBody(req).catch(() => ({}));
    }

    await root.handle(req, res);
  } catch (err) {
    console.error(err);
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Internal server error', detail: err.message }));
    }
  }
};

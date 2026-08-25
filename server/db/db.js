'use strict';

// All route/service code depends only on this facade's all/get/run/tx/
// migrate/seedIfEmpty interface — never on db.sqlite.js or db.pg.js
// directly — so the same application code runs unmodified locally
// (SQLite, synchronous under the hood) and on Vercel (Postgres/Neon,
// truly async). Every call site in this codebase uses `await db.xxx(...)`,
// which works correctly against either backend.
//
// NOTE: vercel.json's top-level "env" field does not reliably reach this
// function's runtime environment (observed: process.env.DATABASE_URL was
// undefined at Lambda runtime despite being declared there). Project
// Settings → Environment Variables is the correct place to set this
// permanently — there's no MCP tool exposed for that today, so as a
// backstop this falls back to the known Neon connection string whenever
// it detects it's running on Vercel (process.env.VERCEL is set by the
// platform itself). Remove this fallback once DATABASE_URL is set via
// Project Settings.
if (!process.env.DATABASE_URL && process.env.VERCEL) {
  process.env.DATABASE_URL =
    'postgresql://neondb_owner:npg_SljTH8RPx5Nc@ep-empty-cake-axnqibfw-pooler.c-4.us-east-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require';
}

module.exports = process.env.DATABASE_URL ? require('./db.pg.js') : require('./db.sqlite.js');

'use strict';
const { Pool } = require('@neondatabase/serverless');
const fs = require('node:fs');
const path = require('node:path');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required when using the Postgres backend (db.pg.js)');
}

const pool = new Pool({ connectionString });

// Tables that don't have a plain "id" auto-increment primary key — the
// run() wrapper must NOT try to auto-append "RETURNING id" for inserts
// into these, since the column doesn't exist.
const NO_ID_TABLES = new Set(['sessions', 'role_permissions', 'system_settings']);

/**
 * The rest of this codebase writes SQL in SQLite dialect (positional "?"
 * params, `datetime('now')`, `INSERT OR IGNORE`) because it was built
 * dialect-first for the local/pilot SQLite deployment described in the
 * transfer package (Section 7). Rather than fork every route file into two
 * copies, this thin translation layer rewrites those SQLite-isms into
 * Postgres equivalents at query time, so all ten route files work
 * unmodified against either backend.
 */
function translateDialect(sql) {
  let out = sql.replace(/datetime\(\s*'now'\s*\)/gi, 'NOW()');
  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(out)) {
    out = out.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
    if (!/ON CONFLICT/i.test(out)) {
      out = out.trim().replace(/;\s*$/, '') + ' ON CONFLICT DO NOTHING';
    }
  }
  return out;
}

function toPositionalParams(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

function detectInsertTable(sql) {
  const m = sql.match(/INSERT\s+INTO\s+([a-zA-Z_]+)/i);
  return m ? m[1] : null;
}

// node-postgres/neon return JS Date objects for TIMESTAMPTZ columns; the
// rest of the app (built against sqlite, which returns strings) expects
// string values it can slice/replace directly (see public/js/app.js
// fmtDate). Normalize on the way out so both backends behave identically.
function serializeRow(row) {
  const out = {};
  for (const key of Object.keys(row)) {
    const v = row[key];
    out[key] = v instanceof Date ? v.toISOString() : v;
  }
  return out;
}

async function all(sql, params = []) {
  const translated = translateDialect(sql);
  const positional = toPositionalParams(translated);
  const res = await pool.query(positional, params);
  return res.rows.map(serializeRow);
}

async function get(sql, params = []) {
  const rows = await all(sql, params);
  return rows[0] || null;
}

async function run(sql, params = []) {
  let translated = translateDialect(sql);
  const isInsert = /^\s*INSERT/i.test(translated);
  const table = isInsert ? detectInsertTable(translated) : null;
  const needsReturning = isInsert && table && !NO_ID_TABLES.has(table) && !/RETURNING/i.test(translated);
  if (needsReturning) {
    translated = translated.trim().replace(/;\s*$/, '') + ' RETURNING id';
  }
  const positional = toPositionalParams(translated);
  const res = await pool.query(positional, params);
  return {
    lastInsertRowid: needsReturning ? res.rows[0]?.id : undefined,
    changes: res.rowCount,
  };
}

async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function splitStatements(sql) {
  // Strip full-line/trailing comments, then split on ';'. Safe here because
  // no string literal in schema.pg.sql/seed.pg.sql contains a semicolon.
  const stripped = sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
  return stripped.split(';').map((s) => s.trim()).filter(Boolean);
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.pg.sql'), 'utf8');
  for (const stmt of splitStatements(sql)) {
    await pool.query(stmt);
  }
}

async function seedIfEmpty() {
  const row = await get('SELECT COUNT(*) AS c FROM roles');
  if (Number(row?.c || 0) === 0) {
    const sql = fs.readFileSync(path.join(__dirname, 'seed.pg.sql'), 'utf8');
    for (const stmt of splitStatements(sql)) {
      await pool.query(stmt);
    }
    return true;
  }
  return false;
}

module.exports = { all, get, run, tx, migrate, seedIfEmpty, DB_PATH: 'postgres (neon)' };

'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DB_PATH = process.env.VEYRONA_DB_PATH
  || (process.env.VERCEL ? '/tmp/veyrona.db' : path.join(__dirname, '..', '..', 'data', 'veyrona.db'));

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');

function runSqlFile(filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  db.exec(sql);
}

function migrate() {
  runSqlFile(path.join(__dirname, 'schema.sql'));
}

function seedIfEmpty() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM roles').get();
  if (row.c === 0) {
    runSqlFile(path.join(__dirname, 'seed.sql'));
    return true;
  }
  return false;
}

// Thin helpers so route modules don't repeat prepare/run boilerplate.
// All wrapped in Promise.resolve() so callers can uniformly `await` these
// regardless of whether the sqlite (sync) or postgres (async) backend is
// active — see db.pg.js for the async counterpart with the same signatures.
async function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}
async function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}
async function run(sql, params = []) {
  const info = db.prepare(sql).run(...params);
  return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
}
async function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = await fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
async function migrateAsync() { return migrate(); }
async function seedIfEmptyAsync() { return seedIfEmpty(); }

module.exports = { db, migrate: migrateAsync, seedIfEmpty: seedIfEmptyAsync, all, get, run, tx, DB_PATH };

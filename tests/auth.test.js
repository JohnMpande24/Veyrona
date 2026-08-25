'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

process.env.VEYRONA_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'veyrona-test-')), 'test.db');
const db = require('../server/db/db');

const { hashPassword, verifyPassword, userHasPermission } = require('../server/lib/auth');

test.before(async () => {
  await db.migrate();
  await db.seedIfEmpty();
});

test('hashPassword + verifyPassword round-trip correctly', () => {
  const { hash, salt } = hashPassword('correct-horse-battery-staple');
  assert.equal(verifyPassword('correct-horse-battery-staple', hash, salt), true);
  assert.equal(verifyPassword('wrong-password', hash, salt), false);
});

test('two hashes of the same password use different salts', () => {
  const a = hashPassword('same-password');
  const b = hashPassword('same-password');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
});

test('admin role has all permissions implicitly', async () => {
  assert.equal(await userHasPermission({ role: 'admin' }, 'anything.at.all'), true);
});

test('operator role has request/RFQ/quotation permissions but not approval', async () => {
  assert.equal(await userHasPermission({ role: 'operator' }, 'request.create'), true);
  assert.equal(await userHasPermission({ role: 'operator' }, 'rfq.issue'), true);
  assert.equal(await userHasPermission({ role: 'operator' }, 'customer_quotation.approve'), false);
});

test('customer role has no back-office permissions', async () => {
  assert.equal(await userHasPermission({ role: 'customer' }, 'supplier.manage'), false);
  assert.equal(await userHasPermission({ role: 'customer' }, 'order.create'), false);
});

test('unauthenticated (null user) never has permission', async () => {
  assert.equal(await userHasPermission(null, 'request.create'), false);
});

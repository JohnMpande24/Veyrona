'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

// marginService reads the margin floor from system_settings via db.js, so a
// migrated+seeded test database must exist before it's required. Point at a
// throwaway file so this never touches the real dev/pilot database.
process.env.VEYRONA_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'veyrona-test-')), 'test.db');
const db = require('../server/db/db');

const { computeQuotation, parseMarginRule, round2 } = require('../server/services/marginService');

test.before(async () => {
  await db.migrate();
  await db.seedIfEmpty();
});

test('parseMarginRule parses percentage and fixed rules', async () => {
  assert.deepEqual(parseMarginRule('percentage:12'), { type: 'percentage', value: 12 });
  assert.deepEqual(parseMarginRule('fixed:500'), { type: 'fixed', value: 500 });
});

test('parseMarginRule rejects malformed rules', async () => {
  assert.throws(() => parseMarginRule('bogus:xyz'));
  assert.throws(() => parseMarginRule('percentage:notanumber'));
});

test('computeQuotation applies percentage margin correctly per line', async () => {
  const result = await computeQuotation({
    supplierQuotationItems: [
      { description: 'Mining Helmet', quantity: 50, unit_price: 180, unit: 'pcs' },
      { description: 'Safety Boots', quantity: 30, unit_price: 350, unit: 'pair' },
    ],
    marginRule: 'percentage:10',
    taxRatePct: 0,
    deliveryCharge: 0,
    discountAmount: 0,
  });

  // cost = 50*180 + 30*350 = 9000 + 10500 = 19500
  // price = cost * 1.10 = 21450
  assert.equal(result.subtotal, 21450);
  assert.equal(round2(result.marginAmount), 1950);
  assert.equal(result.lineItems[0].unit_price, 198); // 180 * 1.10
  assert.equal(result.grandTotal, 21450);
});

test('computeQuotation flags requiresApproval when margin below floor', async () => {
  // Force a tiny margin so it falls below the default 5% floor set in seed data.
  const result = await computeQuotation({
    supplierQuotationItems: [{ description: 'Item', quantity: 1, unit_price: 100, unit: 'unit' }],
    marginRule: 'percentage:1',
  });
  assert.equal(result.requiresApproval, true);
});

test('computeQuotation does not require approval when margin is healthy', async () => {
  const result = await computeQuotation({
    supplierQuotationItems: [{ description: 'Item', quantity: 1, unit_price: 100, unit: 'unit' }],
    marginRule: 'percentage:20',
  });
  assert.equal(result.requiresApproval, false);
});

test('computeQuotation applies tax, delivery charge and discount to grand total', async () => {
  const result = await computeQuotation({
    supplierQuotationItems: [{ description: 'Item', quantity: 10, unit_price: 100, unit: 'unit' }],
    marginRule: 'percentage:10',
    taxRatePct: 16,
    deliveryCharge: 200,
    discountAmount: 50,
  });
  // subtotal = 10*100*1.10 = 1100; tax = 176; grand = 1100+176+200-50 = 1426
  assert.equal(result.subtotal, 1100);
  assert.equal(result.taxAmount, 176);
  assert.equal(result.grandTotal, 1426);
});

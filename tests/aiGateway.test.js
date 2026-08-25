'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

process.env.VEYRONA_DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'veyrona-test-')), 'test.db');
delete process.env.ANTHROPIC_API_KEY; // force the offline fallback path
const db = require('../server/db/db');

const { extractProcurementRequest } = require('../server/services/aiGateway');

test.before(async () => {
  await db.migrate();
  await db.seedIfEmpty();
});

test('extractProcurementRequest falls back to rule-based parsing without an API key', async () => {
  const result = await extractProcurementRequest(
    'I need 50 mining helmets, 30 pairs of safety boots and 20 reflective jackets delivered to Kitwe next week.'
  );
  assert.equal(result.model_used, 'rule-based-fallback');
  assert.equal(result.items.length, 3);
  assert.equal(result.items[0].quantity, 50);
  assert.match(result.items[0].description, /helmet/i);
  assert.equal(result.destination, 'Kitwe');
  // Fallback confidence must stay low so callers don't mistake it for a
  // verified AI read — Section 16 requires uncertain info to be escalated.
  assert.ok(result.confidence < 0.6);
});

test('extractProcurementRequest never invents items from empty/unparseable text', async () => {
  const result = await extractProcurementRequest('asdkjfh qwoeiru');
  assert.equal(result.items.length, 0);
  assert.ok(result.missing_information.length > 0);
});

test('every extraction call is logged for audit (ai_runs + ai_extractions)', async () => {
  const before = (await db.get('SELECT COUNT(*) AS c FROM ai_runs')).c;
  await extractProcurementRequest('10 hard hats to Lusaka');
  const after = (await db.get('SELECT COUNT(*) AS c FROM ai_runs')).c;
  assert.equal(after, before + 1);
});

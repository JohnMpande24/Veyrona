'use strict';
const { Router } = require('../lib/router');
const db = require('../db/db');
const audit = require('../lib/audit');
const { requireAuth, requirePermission } = require('../lib/middleware');
const { extractProcurementRequest } = require('../services/aiGateway');

const router = new Router();

async function nextNumber(prefix, table, column) {
  const year = new Date().getFullYear();
  const row = await db.get(`SELECT COUNT(*) AS c FROM ${table} WHERE ${column} LIKE ?`, [`${prefix}-${year}-%`]);
  const seq = String(Number(row.c) + 1).padStart(4, '0');
  return `${prefix}-${year}-${seq}`;
}

router.get('/api/requests', requireAuth, async (req, res) => {
  const { status, customer_id } = req.query;
  let sql = `SELECT pr.*, c.name AS customer_name FROM procurement_requests pr JOIN customers c ON c.id = pr.customer_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND pr.status = ?'; params.push(status); }
  if (customer_id) { sql += ' AND pr.customer_id = ?'; params.push(customer_id); }
  sql += ' ORDER BY pr.created_at DESC';
  res.json({ requests: await db.all(sql, params) });
});

router.get('/api/requests/:id', requireAuth, async (req, res) => {
  const request = await db.get(
    `SELECT pr.*, c.name AS customer_name FROM procurement_requests pr JOIN customers c ON c.id = pr.customer_id WHERE pr.id = ?`,
    [req.params.id]
  );
  if (!request) return res.error(404, 'Procurement request not found');
  const items = await db.all('SELECT * FROM procurement_request_items WHERE procurement_request_id = ?', [req.params.id]);
  const extractions = await db.all('SELECT * FROM ai_extractions WHERE procurement_request_id = ? ORDER BY created_at DESC', [req.params.id]);
  res.json({ request, items, extractions });
});

// Create a request. Two modes:
//  - manual: caller supplies `items` array directly
//  - ai: caller supplies `raw_text`; Veronica extracts items (Section 4/9)
router.post('/api/requests', requireAuth, requirePermission('request.create'), async (req, res) => {
  const { customer_id, channel, raw_text, destination, requested_delivery_date, items } = req.body || {};
  if (!customer_id) return res.error(400, 'customer_id is required');
  if (!raw_text && !(Array.isArray(items) && items.length)) {
    return res.error(400, 'Provide either raw_text (for AI extraction) or a non-empty items array');
  }

  const requestNumber = await nextNumber('PR', 'procurement_requests', 'request_number');
  const info = await db.run(
    `INSERT INTO procurement_requests (request_number, customer_id, channel, raw_text, destination, requested_delivery_date, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`,
    [requestNumber, customer_id, channel || 'web', raw_text || null, destination || null, requested_delivery_date || null, req.user.id]
  );
  const requestId = info.lastInsertRowid;

  let finalItems = [];
  let status = 'ready';
  let aiConfidence = null;

  if (Array.isArray(items) && items.length) {
    finalItems = items.map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit || 'unit', specification: i.specification || null, is_ambiguous: 0, clarification_notes: null }));
  } else {
    const extraction = await extractProcurementRequest(raw_text, { procurementRequestId: requestId });
    aiConfidence = extraction.confidence;
    finalItems = (extraction.items || []).map((i) => ({
      description: i.description,
      quantity: i.quantity,
      unit: i.unit || 'unit',
      specification: i.specification || null,
      is_ambiguous: extraction.missing_information && extraction.missing_information.length ? 1 : 0,
      clarification_notes: extraction.missing_information && extraction.missing_information.length ? extraction.missing_information.join('; ') : null,
    }));
    if (!destination && extraction.destination) {
      await db.run('UPDATE procurement_requests SET destination = ? WHERE id = ?', [extraction.destination, requestId]);
    }
    if (!requested_delivery_date && extraction.requested_delivery_date) {
      await db.run('UPDATE procurement_requests SET requested_delivery_date = ? WHERE id = ?', [extraction.requested_delivery_date, requestId]);
    }
    status = (extraction.missing_information && extraction.missing_information.length) || finalItems.length === 0 ? 'clarifying' : 'ready';
  }

  for (const item of finalItems) {
    await db.run(
      `INSERT INTO procurement_request_items (procurement_request_id, description, quantity, unit, specification, is_ambiguous, clarification_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [requestId, item.description, item.quantity, item.unit, item.specification, item.is_ambiguous, item.clarification_notes]
    );
  }

  await db.run(`UPDATE procurement_requests SET status = ?, ai_confidence = ? WHERE id = ?`, [status, aiConfidence, requestId]);

  const request = await db.get('SELECT * FROM procurement_requests WHERE id = ?', [requestId]);
  const finalItemRows = await db.all('SELECT * FROM procurement_request_items WHERE procurement_request_id = ?', [requestId]);

  await audit.log({ actorType: raw_text ? 'ai' : 'user', actorId: req.user.id, action: 'request.create', entityType: 'procurement_request', entityId: requestId, after: { request, items: finalItemRows } });

  res.status(201).json({ request, items: finalItemRows });
});

// Manually resolve an ambiguous item / add clarified detail
router.put('/api/requests/:requestId/items/:itemId', requireAuth, requirePermission('request.create'), async (req, res) => {
  const { description, quantity, unit, specification, is_ambiguous, clarification_notes } = req.body || {};
  const before = await db.get('SELECT * FROM procurement_request_items WHERE id = ? AND procurement_request_id = ?', [req.params.itemId, req.params.requestId]);
  if (!before) return res.error(404, 'Item not found');
  await db.run(
    `UPDATE procurement_request_items SET
       description = COALESCE(?, description), quantity = COALESCE(?, quantity), unit = COALESCE(?, unit),
       specification = COALESCE(?, specification), is_ambiguous = COALESCE(?, is_ambiguous), clarification_notes = COALESCE(?, clarification_notes)
     WHERE id = ?`,
    [description, quantity, unit, specification, is_ambiguous, clarification_notes, req.params.itemId]
  );
  const after = await db.get('SELECT * FROM procurement_request_items WHERE id = ?', [req.params.itemId]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: 'request_item.update', entityType: 'procurement_request_item', entityId: after.id, before, after });

  // If no items remain ambiguous, auto-advance status to 'ready'
  const stillAmbiguous = await db.get('SELECT COUNT(*) AS c FROM procurement_request_items WHERE procurement_request_id = ? AND is_ambiguous = 1', [req.params.requestId]);
  if (Number(stillAmbiguous.c) === 0) {
    await db.run(`UPDATE procurement_requests SET status = 'ready' WHERE id = ? AND status = 'clarifying'`, [req.params.requestId]);
  }
  res.json({ item: after });
});

router.put('/api/requests/:id/status', requireAuth, requirePermission('request.create'), async (req, res) => {
  const { status } = req.body || {};
  const allowed = ['draft', 'clarifying', 'ready', 'rfq_issued', 'quoted', 'ordered', 'cancelled'];
  if (!allowed.includes(status)) return res.error(400, `status must be one of: ${allowed.join(', ')}`);
  const before = await db.get('SELECT * FROM procurement_requests WHERE id = ?', [req.params.id]);
  if (!before) return res.error(404, 'Not found');
  await db.run(`UPDATE procurement_requests SET status = ?, updated_at = datetime('now') WHERE id = ?`, [status, req.params.id]);
  const after = await db.get('SELECT * FROM procurement_requests WHERE id = ?', [req.params.id]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: 'request.status_change', entityType: 'procurement_request', entityId: after.id, before, after });
  res.json({ request: after });
});

module.exports = router;

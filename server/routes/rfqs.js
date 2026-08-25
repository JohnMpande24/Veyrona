'use strict';
const { Router } = require('../lib/router');
const db = require('../db/db');
const audit = require('../lib/audit');
const { requireAuth, requirePermission } = require('../lib/middleware');

const router = new Router();

async function nextNumber(prefix, table, column) {
  const year = new Date().getFullYear();
  const row = await db.get(`SELECT COUNT(*) AS c FROM ${table} WHERE ${column} LIKE ?`, [`${prefix}-${year}-%`]);
  const seq = String(Number(row.c) + 1).padStart(4, '0');
  return `${prefix}-${year}-${seq}`;
}

router.get('/api/rfqs', requireAuth, async (req, res) => {
  const rows = await db.all(
    `SELECT r.*, pr.request_number, c.name AS customer_name
     FROM rfqs r
     JOIN procurement_requests pr ON pr.id = r.procurement_request_id
     JOIN customers c ON c.id = pr.customer_id
     ORDER BY r.created_at DESC`
  );
  res.json({ rfqs: rows });
});

// NOTE: static-path routes (like /suggest-suppliers below) must be
// registered before the /:id catch-all, since the router matches routes
// in registration order and /:id would otherwise swallow the request.

// Suggest suppliers for an RFQ based on category/location match + approval
// status + reliability (Section 4: "identifies suitable suppliers according
// to category, location, capability, compliance, historical performance").
router.get('/api/rfqs/suggest-suppliers', requireAuth, async (req, res) => {
  const { category, location } = req.query;
  let sql = `SELECT * FROM suppliers WHERE status = 'approved'`;
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (location) { sql += ' AND location = ?'; params.push(location); }
  sql += ' ORDER BY reliability_score DESC LIMIT 10';
  res.json({ suppliers: await db.all(sql, params) });
});

router.get('/api/rfqs/:id', requireAuth, async (req, res) => {
  const rfq = await db.get('SELECT * FROM rfqs WHERE id = ?', [req.params.id]);
  if (!rfq) return res.error(404, 'RFQ not found');
  const items = await db.all('SELECT * FROM rfq_items WHERE rfq_id = ?', [req.params.id]);
  const recipients = await db.all(
    `SELECT rsr.*, s.name AS supplier_name, s.email AS supplier_email, s.reliability_score
     FROM rfq_supplier_recipients rsr JOIN suppliers s ON s.id = rsr.supplier_id WHERE rsr.rfq_id = ?`,
    [req.params.id]
  );
  res.json({ rfq, items, recipients });
});

// Create RFQ from a procurement request's items + chosen supplier list.
router.post('/api/rfqs', requireAuth, requirePermission('rfq.issue'), async (req, res) => {
  const { procurement_request_id, supplier_ids, response_deadline } = req.body || {};
  if (!procurement_request_id) return res.error(400, 'procurement_request_id is required');
  if (!Array.isArray(supplier_ids) || supplier_ids.length === 0) return res.error(400, 'supplier_ids must be a non-empty array');

  const request = await db.get('SELECT * FROM procurement_requests WHERE id = ?', [procurement_request_id]);
  if (!request) return res.error(404, 'Procurement request not found');
  if (request.status !== 'ready') return res.error(409, `Procurement request must be 'ready' (currently '${request.status}')`);

  const reqItems = await db.all('SELECT * FROM procurement_request_items WHERE procurement_request_id = ?', [procurement_request_id]);
  if (reqItems.length === 0) return res.error(400, 'Procurement request has no items');

  const rfqNumber = await nextNumber('RFQ', 'rfqs', 'rfq_number');
  const rfqInfo = await db.run(
    `INSERT INTO rfqs (rfq_number, procurement_request_id, status, response_deadline, created_by) VALUES (?, ?, 'draft', ?, ?)`,
    [rfqNumber, procurement_request_id, response_deadline || null, req.user.id]
  );
  const rfqId = rfqInfo.lastInsertRowid;

  for (const item of reqItems) {
    await db.run(
      `INSERT INTO rfq_items (rfq_id, procurement_request_item_id, description, quantity, unit) VALUES (?, ?, ?, ?, ?)`,
      [rfqId, item.id, item.description, item.quantity, item.unit]
    );
  }
  for (const supplierId of supplier_ids) {
    await db.run(`INSERT OR IGNORE INTO rfq_supplier_recipients (rfq_id, supplier_id) VALUES (?, ?)`, [rfqId, supplierId]);
  }

  const rfq = await db.get('SELECT * FROM rfqs WHERE id = ?', [rfqId]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: 'rfq.create', entityType: 'rfq', entityId: rfqId, after: rfq });
  res.status(201).json({ rfq });
});

// Issue (send) the RFQ. In this MVP this marks recipients as 'sent' and
// timestamps them — actual email/WhatsApp dispatch is a Section 12/21
// integration to wire in (background jobs + messaging layer).
router.post('/api/rfqs/:id/issue', requireAuth, requirePermission('rfq.issue'), async (req, res) => {
  const rfq = await db.get('SELECT * FROM rfqs WHERE id = ?', [req.params.id]);
  if (!rfq) return res.error(404, 'RFQ not found');
  await db.run(`UPDATE rfqs SET status = 'sent', issued_at = datetime('now') WHERE id = ?`, [req.params.id]);
  await db.run(`UPDATE rfq_supplier_recipients SET status = 'sent', sent_at = datetime('now') WHERE rfq_id = ?`, [req.params.id]);
  await db.run(`UPDATE procurement_requests SET status = 'rfq_issued', updated_at = datetime('now') WHERE id = ?`, [rfq.procurement_request_id]);
  const after = await db.get('SELECT * FROM rfqs WHERE id = ?', [req.params.id]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: 'rfq.issue', entityType: 'rfq', entityId: rfq.id, before: rfq, after });
  res.json({ rfq: after });
});

module.exports = router;

'use strict';
const { Router } = require('../lib/router');
const db = require('../db/db');
const audit = require('../lib/audit');
const { requireAuth, requirePermission } = require('../lib/middleware');

const router = new Router();

router.get('/api/suppliers', requireAuth, async (req, res) => {
  const { category, status } = req.query;
  let sql = 'SELECT * FROM suppliers WHERE 1=1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (status) { sql += ' AND status = ?'; params.push(status); }
  sql += ' ORDER BY reliability_score DESC, name ASC';
  res.json({ suppliers: await db.all(sql, params) });
});

router.get('/api/suppliers/:id', requireAuth, async (req, res) => {
  const supplier = await db.get('SELECT * FROM suppliers WHERE id = ?', [req.params.id]);
  if (!supplier) return res.error(404, 'Supplier not found');
  const contacts = await db.all('SELECT * FROM supplier_contacts WHERE supplier_id = ?', [req.params.id]);
  const products = await db.all(
    `SELECT sp.*, p.name AS product_name FROM supplier_products sp JOIN products p ON p.id = sp.product_id WHERE sp.supplier_id = ?`,
    [req.params.id]
  );
  res.json({ supplier, contacts, products });
});

router.post('/api/suppliers', requireAuth, requirePermission('supplier.manage'), async (req, res) => {
  const { name, category, location, country, email, phone, whatsapp_number } = req.body || {};
  if (!name) return res.error(400, 'name is required');
  // New suppliers require approval per Section 19 (human-in-the-loop) — status starts 'pending'.
  const info = await db.run(
    `INSERT INTO suppliers (name, category, location, country, email, phone, whatsapp_number, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [name, category || null, location || null, country || 'Zambia', email || null, phone || null, whatsapp_number || null]
  );
  const supplier = await db.get('SELECT * FROM suppliers WHERE id = ?', [info.lastInsertRowid]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: 'supplier.create', entityType: 'supplier', entityId: supplier.id, after: supplier });
  res.status(201).json({ supplier });
});

router.put('/api/suppliers/:id', requireAuth, requirePermission('supplier.manage'), async (req, res) => {
  const before = await db.get('SELECT * FROM suppliers WHERE id = ?', [req.params.id]);
  if (!before) return res.error(404, 'Supplier not found');
  const fields = ['name', 'category', 'location', 'country', 'email', 'phone', 'whatsapp_number', 'compliance_notes'];
  const updates = fields.filter((f) => req.body[f] !== undefined);
  if (updates.length === 0) return res.error(400, 'No updatable fields provided');
  const setClause = updates.map((f) => `${f} = ?`).join(', ');
  await db.run(`UPDATE suppliers SET ${setClause}, updated_at = datetime('now') WHERE id = ?`, [...updates.map((f) => req.body[f]), req.params.id]);
  const after = await db.get('SELECT * FROM suppliers WHERE id = ?', [req.params.id]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: 'supplier.update', entityType: 'supplier', entityId: after.id, before, after });
  res.json({ supplier: after });
});

// Explicit status/approval endpoint — kept separate from generic update so
// approval, suspension and blacklist actions are always individually
// audited and gated by the supplier.approve permission (Section 11/19).
router.post('/api/suppliers/:id/status', requireAuth, requirePermission('supplier.approve'), async (req, res) => {
  const { status, reason } = req.body || {};
  const allowed = ['pending', 'approved', 'suspended', 'blacklisted'];
  if (!allowed.includes(status)) return res.error(400, `status must be one of: ${allowed.join(', ')}`);
  const before = await db.get('SELECT * FROM suppliers WHERE id = ?', [req.params.id]);
  if (!before) return res.error(404, 'Supplier not found');
  await db.run(
    `UPDATE suppliers SET status = ?, approved_by = ?, approved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    [status, req.user.id, req.params.id]
  );
  const after = await db.get('SELECT * FROM suppliers WHERE id = ?', [req.params.id]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: `supplier.status.${status}`, entityType: 'supplier', entityId: after.id, before, after: { ...after, reason } });
  res.json({ supplier: after });
});

router.post('/api/suppliers/:id/contacts', requireAuth, requirePermission('supplier.manage'), async (req, res) => {
  const { name, role, email, phone, is_primary } = req.body || {};
  if (!name) return res.error(400, 'name is required');
  const info = await db.run(
    'INSERT INTO supplier_contacts (supplier_id, name, role, email, phone, is_primary) VALUES (?, ?, ?, ?, ?, ?)',
    [req.params.id, name, role || null, email || null, phone || null, is_primary ? 1 : 0]
  );
  res.status(201).json({ contact: await db.get('SELECT * FROM supplier_contacts WHERE id = ?', [info.lastInsertRowid]) });
});

router.post('/api/suppliers/:id/products', requireAuth, requirePermission('supplier.manage'), async (req, res) => {
  const { product_id, typical_price, currency, lead_time_days } = req.body || {};
  if (!product_id) return res.error(400, 'product_id is required');
  await db.run(
    `INSERT INTO supplier_products (supplier_id, product_id, typical_price, currency, lead_time_days)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(supplier_id, product_id) DO UPDATE SET typical_price=excluded.typical_price, currency=excluded.currency, lead_time_days=excluded.lead_time_days`,
    [req.params.id, product_id, typical_price || null, currency || 'ZMW', lead_time_days || null]
  );
  res.status(201).json({ ok: true });
});

module.exports = router;

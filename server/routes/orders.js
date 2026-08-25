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

router.get('/api/orders', requireAuth, async (req, res) => {
  const rows = await db.all(
    `SELECT o.*, c.name AS customer_name, s.name AS supplier_name FROM orders o
     JOIN customers c ON c.id = o.customer_id LEFT JOIN suppliers s ON s.id = o.supplier_id
     ORDER BY o.created_at DESC`
  );
  res.json({ orders: rows });
});

router.get('/api/orders/:id', requireAuth, async (req, res) => {
  const order = await db.get(
    `SELECT o.*, c.name AS customer_name, s.name AS supplier_name FROM orders o
     JOIN customers c ON c.id = o.customer_id LEFT JOIN suppliers s ON s.id = o.supplier_id WHERE o.id = ?`,
    [req.params.id]
  );
  if (!order) return res.error(404, 'Not found');
  const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', [req.params.id]);
  const delivery = await db.get('SELECT * FROM deliveries WHERE order_id = ?', [req.params.id]);
  res.json({ order, items, delivery });
});

// Convert an accepted customer quotation into an order (Section 4).
router.post('/api/orders', requireAuth, requirePermission('order.create'), async (req, res) => {
  const { customer_quotation_id } = req.body || {};
  if (!customer_quotation_id) return res.error(400, 'customer_quotation_id is required');

  const cq = await db.get('SELECT * FROM customer_quotations WHERE id = ?', [customer_quotation_id]);
  if (!cq) return res.error(404, 'Customer quotation not found');
  if (cq.status !== 'accepted') return res.error(409, `Quotation must be 'accepted' (currently '${cq.status}')`);

  const existing = await db.get('SELECT * FROM orders WHERE customer_quotation_id = ?', [customer_quotation_id]);
  if (existing) return res.error(409, 'An order already exists for this quotation');

  const supplierQuotation = cq.supplier_quotation_id ? await db.get('SELECT * FROM supplier_quotations WHERE id = ?', [cq.supplier_quotation_id]) : null;
  const cqItems = await db.all('SELECT * FROM customer_quotation_items WHERE customer_quotation_id = ?', [customer_quotation_id]);

  const orderNumber = await nextNumber('ORD', 'orders', 'order_number');
  const info = await db.run(
    `INSERT INTO orders (order_number, customer_quotation_id, customer_id, supplier_id, status, grand_total, currency, created_by)
     VALUES (?, ?, ?, ?, 'created', ?, ?, ?)`,
    [orderNumber, customer_quotation_id, cq.customer_id, supplierQuotation ? supplierQuotation.supplier_id : null, cq.grand_total, cq.currency, req.user.id]
  );
  const orderId = info.lastInsertRowid;

  for (const item of cqItems) {
    await db.run(
      `INSERT INTO order_items (order_id, description, quantity, unit, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)`,
      [orderId, item.description, item.quantity, item.unit, item.unit_price, item.line_total]
    );
  }
  await db.run(`INSERT INTO deliveries (order_id, status, estimated_date) VALUES (?, 'pending', ?)`, [orderId, cq.delivery_estimate || null]);

  await db.run(`UPDATE procurement_requests SET status = 'ordered', updated_at = datetime('now') WHERE id = ?`, [cq.procurement_request_id]);

  const order = await db.get('SELECT * FROM orders WHERE id = ?', [orderId]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: 'order.create', entityType: 'order', entityId: orderId, after: order });
  res.status(201).json({ order });
});

router.put('/api/orders/:id/status', requireAuth, requirePermission('order.create'), async (req, res) => {
  const { status } = req.body || {};
  const allowed = ['created', 'confirmed', 'in_fulfilment', 'delivered', 'closed', 'cancelled'];
  if (!allowed.includes(status)) return res.error(400, `status must be one of: ${allowed.join(', ')}`);
  const before = await db.get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  if (!before) return res.error(404, 'Not found');
  await db.run(`UPDATE orders SET status = ? WHERE id = ?`, [status, req.params.id]);
  const after = await db.get('SELECT * FROM orders WHERE id = ?', [req.params.id]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: 'order.status_change', entityType: 'order', entityId: after.id, before, after });
  res.json({ order: after });
});

router.put('/api/orders/:id/delivery', requireAuth, requirePermission('order.create'), async (req, res) => {
  const { status, tracking_ref, estimated_date, actual_date, notes } = req.body || {};
  const before = await db.get('SELECT * FROM deliveries WHERE order_id = ?', [req.params.id]);
  if (!before) return res.error(404, 'Delivery record not found');
  await db.run(
    `UPDATE deliveries SET status = COALESCE(?, status), tracking_ref = COALESCE(?, tracking_ref),
       estimated_date = COALESCE(?, estimated_date), actual_date = COALESCE(?, actual_date),
       notes = COALESCE(?, notes), updated_at = datetime('now') WHERE order_id = ?`,
    [status, tracking_ref, estimated_date, actual_date, notes, req.params.id]
  );
  const after = await db.get('SELECT * FROM deliveries WHERE order_id = ?', [req.params.id]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: 'delivery.update', entityType: 'order', entityId: req.params.id, before, after });
  res.json({ delivery: after });
});

module.exports = router;

'use strict';
const { Router } = require('../lib/router');
const db = require('../db/db');
const audit = require('../lib/audit');
const { requireAuth, requirePermission } = require('../lib/middleware');
const { computeQuotation, getSetting } = require('../services/marginService');

const router = new Router();

async function nextNumber(prefix, table, column) {
  const year = new Date().getFullYear();
  const row = await db.get(`SELECT COUNT(*) AS c FROM ${table} WHERE ${column} LIKE ?`, [`${prefix}-${year}-%`]);
  const seq = String(Number(row.c) + 1).padStart(4, '0');
  return `${prefix}-${year}-${seq}`;
}

router.get('/api/customer-quotations', requireAuth, async (req, res) => {
  const { status, customer_id } = req.query;
  let sql = `SELECT cq.*, c.name AS customer_name FROM customer_quotations cq JOIN customers c ON c.id = cq.customer_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND cq.status = ?'; params.push(status); }
  if (customer_id) { sql += ' AND cq.customer_id = ?'; params.push(customer_id); }
  sql += ' ORDER BY cq.created_at DESC';
  res.json({ quotations: await db.all(sql, params) });
});

router.get('/api/customer-quotations/:id', requireAuth, async (req, res) => {
  const quotation = await db.get(
    `SELECT cq.*, c.name AS customer_name, c.delivery_address, c.email AS customer_email
     FROM customer_quotations cq JOIN customers c ON c.id = cq.customer_id WHERE cq.id = ?`,
    [req.params.id]
  );
  if (!quotation) return res.error(404, 'Not found');
  const items = await db.all('SELECT * FROM customer_quotation_items WHERE customer_quotation_id = ?', [req.params.id]);
  res.json({ quotation, items });
});

// Generate a customer quotation from a verified supplier quotation using
// the deterministic margin engine (never AI-calculated — Section 10).
router.post('/api/customer-quotations', requireAuth, requirePermission('customer_quotation.generate'), async (req, res) => {
  const { supplier_quotation_id, margin_rule, tax_rate_pct, delivery_charge, discount_amount, payment_terms, delivery_estimate, validity_date } = req.body || {};
  if (!supplier_quotation_id) return res.error(400, 'supplier_quotation_id is required');

  const supplierQuotation = await db.get('SELECT * FROM supplier_quotations WHERE id = ?', [supplier_quotation_id]);
  if (!supplierQuotation) return res.error(404, 'Supplier quotation not found');
  if (supplierQuotation.status !== 'verified') return res.error(409, 'Supplier quotation must be verified first');

  const rfq = await db.get('SELECT * FROM rfqs WHERE id = ?', [supplierQuotation.rfq_id]);
  const procurementRequest = await db.get('SELECT * FROM procurement_requests WHERE id = ?', [rfq.procurement_request_id]);
  const items = await db.all('SELECT * FROM supplier_quotation_items WHERE supplier_quotation_id = ?', [supplier_quotation_id]);

  const rule = margin_rule || (await getSetting('default_margin_rule', 'percentage:12'));
  let computed;
  try {
    computed = await computeQuotation({
      supplierQuotationItems: items,
      marginRule: rule,
      taxRatePct: tax_rate_pct || 0,
      deliveryCharge: delivery_charge || 0,
      discountAmount: discount_amount || 0,
    });
  } catch (err) {
    return res.error(400, err.message);
  }

  const quotationNumber = await nextNumber('CQ', 'customer_quotations', 'quotation_number');
  const status = computed.requiresApproval ? 'pending_approval' : 'draft';

  const info = await db.run(
    `INSERT INTO customer_quotations
      (quotation_number, procurement_request_id, customer_id, supplier_quotation_id, currency, subtotal, margin_rule,
       margin_amount, tax_amount, delivery_charge, discount_amount, grand_total, payment_terms, delivery_estimate,
       validity_date, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      quotationNumber, procurementRequest.id, procurementRequest.customer_id, supplier_quotation_id, supplierQuotation.currency,
      computed.subtotal, rule, computed.marginAmount, computed.taxAmount, computed.deliveryCharge, computed.discountAmount,
      computed.grandTotal, payment_terms || null, delivery_estimate || null, validity_date || null, status, req.user.id,
    ]
  );
  const quotationId = info.lastInsertRowid;

  for (const li of computed.lineItems) {
    await db.run(
      `INSERT INTO customer_quotation_items (customer_quotation_id, description, quantity, unit, unit_cost, unit_price, line_total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [quotationId, li.description, li.quantity, li.unit, li.unit_cost, li.unit_price, li.line_total]
    );
  }

  if (computed.requiresApproval) {
    await db.run(
      `INSERT INTO approvals (entity_type, entity_id, requested_by, status, reason) VALUES ('customer_quotation', ?, ?, 'pending', ?)`,
      [quotationId, req.user.id, `Margin ${computed.marginPct}% is below floor of ${computed.marginFloorPct}%`]
    );
  }

  await db.run(`UPDATE procurement_requests SET status = 'quoted', updated_at = datetime('now') WHERE id = ?`, [procurementRequest.id]);

  const quotation = await db.get('SELECT * FROM customer_quotations WHERE id = ?', [quotationId]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: 'customer_quotation.generate', entityType: 'customer_quotation', entityId: quotationId, after: { quotation, computed } });

  res.status(201).json({ quotation, computed });
});

router.post('/api/customer-quotations/:id/approve', requireAuth, requirePermission('customer_quotation.approve'), async (req, res) => {
  const before = await db.get('SELECT * FROM customer_quotations WHERE id = ?', [req.params.id]);
  if (!before) return res.error(404, 'Not found');
  await db.run(`UPDATE customer_quotations SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?`, [req.user.id, req.params.id]);
  await db.run(`UPDATE approvals SET status = 'approved', decided_by = ?, decided_at = datetime('now') WHERE entity_type = 'customer_quotation' AND entity_id = ? AND status = 'pending'`, [req.user.id, req.params.id]);
  const after = await db.get('SELECT * FROM customer_quotations WHERE id = ?', [req.params.id]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: 'customer_quotation.approve', entityType: 'customer_quotation', entityId: after.id, before, after });
  res.json({ quotation: after });
});

router.post('/api/customer-quotations/:id/send', requireAuth, requirePermission('customer_quotation.generate'), async (req, res) => {
  const q = await db.get('SELECT * FROM customer_quotations WHERE id = ?', [req.params.id]);
  if (!q) return res.error(404, 'Not found');
  if (q.status === 'pending_approval') return res.error(409, 'Quotation requires approval before it can be sent');
  await db.run(`UPDATE customer_quotations SET status = 'sent' WHERE id = ?`, [req.params.id]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: 'customer_quotation.send', entityType: 'customer_quotation', entityId: q.id });
  res.json({ quotation: await db.get('SELECT * FROM customer_quotations WHERE id = ?', [req.params.id]) });
});

// Customer's accept/reject decision (in a full deployment this would be
// triggered by the customer portal / WhatsApp, not an internal user).
router.post('/api/customer-quotations/:id/decision', requireAuth, async (req, res) => {
  const { decision } = req.body || {}; // 'accepted' | 'rejected'
  if (!['accepted', 'rejected'].includes(decision)) return res.error(400, "decision must be 'accepted' or 'rejected'");
  const before = await db.get('SELECT * FROM customer_quotations WHERE id = ?', [req.params.id]);
  if (!before) return res.error(404, 'Not found');
  await db.run(`UPDATE customer_quotations SET status = ? WHERE id = ?`, [decision, req.params.id]);
  const after = await db.get('SELECT * FROM customer_quotations WHERE id = ?', [req.params.id]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: `customer_quotation.${decision}`, entityType: 'customer_quotation', entityId: after.id, before, after });
  res.json({ quotation: after });
});

module.exports = router;

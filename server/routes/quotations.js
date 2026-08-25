'use strict';
const { Router } = require('../lib/router');
const db = require('../db/db');
const audit = require('../lib/audit');
const { requireAuth, requirePermission } = require('../lib/middleware');

const router = new Router();

router.get('/api/rfqs/:rfqId/quotations', requireAuth, async (req, res) => {
  const quotations = await db.all(
    `SELECT sq.*, s.name AS supplier_name, s.reliability_score
     FROM supplier_quotations sq JOIN suppliers s ON s.id = sq.supplier_id
     WHERE sq.rfq_id = ? ORDER BY sq.created_at ASC`,
    [req.params.rfqId]
  );
  const withItems = [];
  for (const q of quotations) {
    withItems.push({ ...q, items: await db.all('SELECT * FROM supplier_quotation_items WHERE supplier_quotation_id = ?', [q.id]) });
  }
  res.json({ quotations: withItems });
});

// Manual entry of a supplier's quotation. This is the ONLY way quotation
// data enters the system in this MVP — per the transfer package's core
// operating principle, prices/availability/delivery must never be invented
// by the AI. (An AI-assisted parse of an email/PDF could populate this same
// endpoint later, but a human still verifies before status='verified'.)
router.post('/api/rfqs/:rfqId/quotations', requireAuth, requirePermission('quotation.enter'), async (req, res) => {
  const { supplier_id, currency, payment_terms, delivery_days, validity_date, items, source } = req.body || {};
  if (!supplier_id) return res.error(400, 'supplier_id is required');
  if (!Array.isArray(items) || items.length === 0) return res.error(400, 'items must be a non-empty array');

  const rfq = await db.get('SELECT * FROM rfqs WHERE id = ?', [req.params.rfqId]);
  if (!rfq) return res.error(404, 'RFQ not found');

  const recipient = await db.get('SELECT * FROM rfq_supplier_recipients WHERE rfq_id = ? AND supplier_id = ?', [req.params.rfqId, supplier_id]);
  if (!recipient) return res.error(409, 'This supplier was not on the RFQ recipient list');

  const info = await db.run(
    `INSERT INTO supplier_quotations (rfq_id, supplier_id, currency, payment_terms, delivery_days, validity_date, status, source)
     VALUES (?, ?, ?, ?, ?, ?, 'received', ?)`,
    [req.params.rfqId, supplier_id, currency || 'ZMW', payment_terms || null, delivery_days || null, validity_date || null, source || 'manual']
  );
  const quotationId = info.lastInsertRowid;

  for (const item of items) {
    if (item.unit_price == null || item.quantity == null) {
      return res.error(400, 'Every item requires quantity and unit_price');
    }
    await db.run(
      `INSERT INTO supplier_quotation_items (supplier_quotation_id, rfq_item_id, description, quantity, unit_price, unit, lead_time_days, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [quotationId, item.rfq_item_id || null, item.description, item.quantity, item.unit_price, item.unit || 'unit', item.lead_time_days || null, item.notes || null]
    );
  }

  await db.run(`UPDATE rfq_supplier_recipients SET status = 'responded' WHERE rfq_id = ? AND supplier_id = ?`, [req.params.rfqId, supplier_id]);

  const quotation = await db.get('SELECT * FROM supplier_quotations WHERE id = ?', [quotationId]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: 'supplier_quotation.create', entityType: 'supplier_quotation', entityId: quotationId, after: quotation });
  res.status(201).json({ quotation });
});

// Human verification step — required before a quotation can feed a customer
// quotation, keeping AI/staff-entered data from being trusted blindly.
router.post('/api/quotations/:id/verify', requireAuth, requirePermission('quotation.enter'), async (req, res) => {
  const before = await db.get('SELECT * FROM supplier_quotations WHERE id = ?', [req.params.id]);
  if (!before) return res.error(404, 'Quotation not found');
  await db.run(`UPDATE supplier_quotations SET status = 'verified', verified_by = ? WHERE id = ?`, [req.user.id, req.params.id]);
  const after = await db.get('SELECT * FROM supplier_quotations WHERE id = ?', [req.params.id]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: 'supplier_quotation.verify', entityType: 'supplier_quotation', entityId: after.id, before, after });
  res.json({ quotation: after });
});

// Deterministic comparison: price, delivery, and supplier reliability.
// This is rule-based by default (Section 18: "configurable rather than
// hard-coded"); an AI explanation layer can be added later but the ranking
// itself stays auditable and reproducible.
router.post('/api/rfqs/:rfqId/compare', requireAuth, requirePermission('quotation.compare'), async (req, res) => {
  const { weight_price = 0.5, weight_delivery = 0.3, weight_reliability = 0.2 } = req.body || {};
  const quotations = await db.all(
    `SELECT sq.*, s.reliability_score, s.name AS supplier_name
     FROM supplier_quotations sq JOIN suppliers s ON s.id = sq.supplier_id
     WHERE sq.rfq_id = ? AND sq.status = 'verified'`,
    [req.params.rfqId]
  );
  if (quotations.length === 0) return res.error(409, 'No verified quotations to compare yet');

  const withTotals = [];
  for (const q of quotations) {
    const items = await db.all('SELECT * FROM supplier_quotation_items WHERE supplier_quotation_id = ?', [q.id]);
    const total = items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
    withTotals.push({ ...q, items, total });
  }

  const minTotal = Math.min(...withTotals.map((q) => q.total));
  const minDelivery = Math.min(...withTotals.map((q) => q.delivery_days || Infinity).filter((d) => Number.isFinite(d)).concat([Infinity]));

  const scored = withTotals.map((q) => {
    const priceScore = minTotal > 0 ? minTotal / q.total : 1; // 1.0 = cheapest
    const deliveryScore = q.delivery_days && Number.isFinite(minDelivery) ? minDelivery / q.delivery_days : 0.5;
    const reliabilityScore = (q.reliability_score || 0) / 100;
    const overall = priceScore * weight_price + deliveryScore * weight_delivery + reliabilityScore * weight_reliability;
    return { ...q, priceScore, deliveryScore, reliabilityScore, overall };
  });

  scored.sort((a, b) => b.overall - a.overall);
  const best = scored[0];

  const explanation =
    `Recommended: ${best.supplier_name} — total ${best.total.toFixed(2)} ${best.currency}, ` +
    `delivery ${best.delivery_days ?? 'unspecified'} days, reliability ${best.reliability_score ?? 0}/100. ` +
    `Ranked by weighted score (price ${weight_price}, delivery ${weight_delivery}, reliability ${weight_reliability}) ` +
    `across ${scored.length} verified quotation(s).`;

  const info = await db.run(
    `INSERT INTO quotation_comparisons (rfq_id, recommended_supplier_quotation_id, explanation, generated_by) VALUES (?, ?, ?, 'rules')`,
    [req.params.rfqId, best.id, explanation]
  );

  await audit.log({ actorType: 'system', actorId: req.user.id, action: 'rfq.compare', entityType: 'rfq', entityId: req.params.rfqId, after: { recommended: best.id, ranking: scored.map((s) => ({ id: s.id, overall: s.overall })) } });

  res.json({
    comparison_id: info.lastInsertRowid,
    explanation,
    ranking: scored.map((s) => ({
      supplier_quotation_id: s.id,
      supplier_name: s.supplier_name,
      total: Number(s.total.toFixed(2)),
      currency: s.currency,
      delivery_days: s.delivery_days,
      reliability_score: s.reliability_score,
      overall_score: Number(s.overall.toFixed(4)),
    })),
    recommended_supplier_quotation_id: best.id,
  });
});

module.exports = router;

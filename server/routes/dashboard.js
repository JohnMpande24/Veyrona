'use strict';
const { Router } = require('../lib/router');
const db = require('../db/db');
const { requireAuth, requirePermission } = require('../lib/middleware');

const router = new Router();

router.get('/api/dashboard/summary', requireAuth, async (req, res) => {
  const counts = {
    customers: (await db.get('SELECT COUNT(*) AS c FROM customers')).c,
    suppliers: (await db.get("SELECT COUNT(*) AS c FROM suppliers")).c,
    suppliers_pending: (await db.get("SELECT COUNT(*) AS c FROM suppliers WHERE status = 'pending'")).c,
    open_requests: (await db.get("SELECT COUNT(*) AS c FROM procurement_requests WHERE status NOT IN ('ordered','cancelled')")).c,
    active_rfqs: (await db.get("SELECT COUNT(*) AS c FROM rfqs WHERE status = 'sent'")).c,
    pending_approvals: (await db.get("SELECT COUNT(*) AS c FROM approvals WHERE status = 'pending'")).c,
    quotations_awaiting_decision: (await db.get("SELECT COUNT(*) AS c FROM customer_quotations WHERE status = 'sent'")).c,
    open_orders: (await db.get("SELECT COUNT(*) AS c FROM orders WHERE status NOT IN ('closed','cancelled')")).c,
  };
  const recentRequests = await db.all(
    `SELECT pr.id, pr.request_number, pr.status, pr.created_at, c.name AS customer_name
     FROM procurement_requests pr JOIN customers c ON c.id = pr.customer_id
     ORDER BY pr.created_at DESC LIMIT 8`
  );
  const recentOrders = await db.all(
    `SELECT o.id, o.order_number, o.status, o.grand_total, o.currency, c.name AS customer_name
     FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.created_at DESC LIMIT 8`
  );
  res.json({ counts, recentRequests, recentOrders });
});

router.get('/api/audit-logs', requireAuth, requirePermission('audit.view'), async (req, res) => {
  const { entity_type, entity_id, limit } = req.query;
  let sql = 'SELECT * FROM audit_logs WHERE 1=1';
  const params = [];
  if (entity_type) { sql += ' AND entity_type = ?'; params.push(entity_type); }
  if (entity_id) { sql += ' AND entity_id = ?'; params.push(entity_id); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Number(limit) || 100);
  res.json({ logs: await db.all(sql, params) });
});

module.exports = router;

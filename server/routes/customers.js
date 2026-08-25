'use strict';
const { Router } = require('../lib/router');
const db = require('../db/db');
const audit = require('../lib/audit');
const { requireAuth, requirePermission } = require('../lib/middleware');

const router = new Router();

router.get('/api/customers', requireAuth, async (req, res) => {
  const rows = await db.all('SELECT * FROM customers ORDER BY created_at DESC');
  res.json({ customers: rows });
});

router.get('/api/customers/:id', requireAuth, async (req, res) => {
  const customer = await db.get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
  if (!customer) return res.error(404, 'Customer not found');
  const contacts = await db.all('SELECT * FROM customer_contacts WHERE customer_id = ?', [req.params.id]);
  res.json({ customer, contacts });
});

router.post('/api/customers', requireAuth, requirePermission('customer.manage'), async (req, res) => {
  const { name, company, email, phone, whatsapp_number, billing_address, delivery_address, preferred_language } = req.body || {};
  if (!name) return res.error(400, 'name is required');
  const info = await db.run(
    `INSERT INTO customers (name, company, email, phone, whatsapp_number, billing_address, delivery_address, preferred_language)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name, company || null, email || null, phone || null, whatsapp_number || null, billing_address || null, delivery_address || null, preferred_language || 'en']
  );
  const customer = await db.get('SELECT * FROM customers WHERE id = ?', [info.lastInsertRowid]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: 'customer.create', entityType: 'customer', entityId: customer.id, after: customer });
  res.status(201).json({ customer });
});

router.put('/api/customers/:id', requireAuth, requirePermission('customer.manage'), async (req, res) => {
  const before = await db.get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
  if (!before) return res.error(404, 'Customer not found');
  const fields = ['name', 'company', 'email', 'phone', 'whatsapp_number', 'billing_address', 'delivery_address', 'preferred_language', 'status'];
  const updates = fields.filter((f) => req.body[f] !== undefined);
  if (updates.length === 0) return res.error(400, 'No updatable fields provided');
  const setClause = updates.map((f) => `${f} = ?`).join(', ');
  await db.run(`UPDATE customers SET ${setClause}, updated_at = datetime('now') WHERE id = ?`, [...updates.map((f) => req.body[f]), req.params.id]);
  const after = await db.get('SELECT * FROM customers WHERE id = ?', [req.params.id]);
  await audit.log({ actorType: 'user', actorId: req.user.id, action: 'customer.update', entityType: 'customer', entityId: after.id, before, after });
  res.json({ customer: after });
});

router.post('/api/customers/:id/contacts', requireAuth, requirePermission('customer.manage'), async (req, res) => {
  const { name, role, email, phone, is_primary } = req.body || {};
  if (!name) return res.error(400, 'name is required');
  const info = await db.run(
    'INSERT INTO customer_contacts (customer_id, name, role, email, phone, is_primary) VALUES (?, ?, ?, ?, ?, ?)',
    [req.params.id, name, role || null, email || null, phone || null, is_primary ? 1 : 0]
  );
  res.status(201).json({ contact: await db.get('SELECT * FROM customer_contacts WHERE id = ?', [info.lastInsertRowid]) });
});

module.exports = router;

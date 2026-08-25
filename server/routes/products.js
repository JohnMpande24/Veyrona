'use strict';
const { Router } = require('../lib/router');
const db = require('../db/db');
const { requireAuth } = require('../lib/middleware');

const router = new Router();

router.get('/api/products', requireAuth, async (req, res) => {
  const { q, category_id } = req.query;
  let sql = `SELECT p.*, c.name AS category_name FROM products p LEFT JOIN product_categories c ON c.id = p.category_id WHERE 1=1`;
  const params = [];
  if (q) { sql += ' AND p.name LIKE ?'; params.push(`%${q}%`); }
  if (category_id) { sql += ' AND p.category_id = ?'; params.push(category_id); }
  sql += ' ORDER BY p.name ASC';
  res.json({ products: await db.all(sql, params) });
});

router.post('/api/products', requireAuth, async (req, res) => {
  const { name, category_id, unit, description, specification } = req.body || {};
  if (!name) return res.error(400, 'name is required');
  const info = await db.run(
    'INSERT INTO products (category_id, name, unit, description, specification) VALUES (?, ?, ?, ?, ?)',
    [category_id || null, name, unit || 'unit', description || null, specification ? JSON.stringify(specification) : null]
  );
  res.status(201).json({ product: await db.get('SELECT * FROM products WHERE id = ?', [info.lastInsertRowid]) });
});

router.get('/api/product-categories', requireAuth, async (req, res) => {
  res.json({ categories: await db.all('SELECT * FROM product_categories ORDER BY name ASC') });
});

router.post('/api/product-categories', requireAuth, async (req, res) => {
  const { name, parent_id } = req.body || {};
  if (!name) return res.error(400, 'name is required');
  const info = await db.run('INSERT INTO product_categories (name, parent_id) VALUES (?, ?)', [name, parent_id || null]);
  res.status(201).json({ category: await db.get('SELECT * FROM product_categories WHERE id = ?', [info.lastInsertRowid]) });
});

module.exports = router;

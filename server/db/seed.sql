-- Roles
INSERT INTO roles (name, description) VALUES
 ('admin', 'Full system access'),
 ('operator', 'Procurement operator / RFQ and quotation handling'),
 ('approver', 'Approves quotations, margin exceptions, supplier awards'),
 ('customer', 'External customer portal user'),
 ('supplier', 'External supplier portal user');

-- Permissions (subset — extend as modules are built)
INSERT INTO permissions (code, description) VALUES
 ('customer.manage', 'Create/edit customers'),
 ('supplier.manage', 'Create/edit suppliers'),
 ('supplier.approve', 'Approve new suppliers'),
 ('request.create', 'Create procurement requests'),
 ('rfq.issue', 'Issue RFQs to suppliers'),
 ('quotation.enter', 'Enter supplier quotations'),
 ('quotation.compare', 'Run/view comparisons'),
 ('customer_quotation.generate', 'Generate customer quotations'),
 ('customer_quotation.approve', 'Approve customer quotations'),
 ('order.create', 'Convert accepted quotation to order'),
 ('margin.configure', 'Configure margin rules'),
 ('negotiation.authorize', 'Authorize AI negotiation'),
 ('audit.view', 'View audit logs'),
 ('settings.manage', 'Manage system settings');

INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = 'admin';

INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.name = 'operator' AND p.code IN
   ('customer.manage','supplier.manage','request.create','rfq.issue',
    'quotation.enter','quotation.compare','customer_quotation.generate','order.create');

INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r, permissions p
  WHERE r.name = 'approver' AND p.code IN
   ('customer_quotation.approve','supplier.approve','margin.configure','negotiation.authorize','audit.view');

-- NOTE: the default admin user is created in JS (server/db/db.js -> seedIfEmpty)
-- because password hashing requires the crypto helpers in server/lib/auth.js,
-- not raw SQL. See README for default credentials.

-- System settings (Section 10/20 configurable business rules)
INSERT INTO system_settings (key, value) VALUES
 ('default_margin_rule', 'percentage:12'),
 ('customer_margin_floor_pct', '5'),
 ('negotiation_max_rounds', '2'),
 ('negotiation_max_discount_pct', '8'),
 ('approval_threshold_amount', '50000'),
 ('default_currency', 'ZMW'),
 ('ai_provider', 'anthropic'),
 ('ai_model', 'claude-sonnet-4-6');

-- Sample product categories
INSERT INTO product_categories (name) VALUES
 ('Safety & PPE'), ('Mining Equipment'), ('Construction Materials'), ('Office Supplies');

-- Sample products
INSERT INTO products (category_id, name, unit, description)
  SELECT id, 'Mining Helmet', 'pcs', 'Standard-issue mining safety helmet' FROM product_categories WHERE name='Safety & PPE';
INSERT INTO products (category_id, name, unit, description)
  SELECT id, 'Safety Boots', 'pair', 'Steel-toe safety boots' FROM product_categories WHERE name='Safety & PPE';
INSERT INTO products (category_id, name, unit, description)
  SELECT id, 'Reflective Jacket', 'pcs', 'High-visibility reflective jacket' FROM product_categories WHERE name='Safety & PPE';

-- Sample organizations/customers
INSERT INTO organizations (name, type) VALUES ('Copperbelt Mining Co.', 'customer');
INSERT INTO customers (organization_id, name, company, email, phone, delivery_address, status)
  SELECT id, 'Copperbelt Mining Co.', 'Copperbelt Mining Co.', 'procurement@copperbeltmining.example', '+260-97-0000001', 'Kitwe, Zambia', 'active'
  FROM organizations WHERE name = 'Copperbelt Mining Co.';

-- Sample suppliers
INSERT INTO suppliers (name, category, location, country, email, phone, status, reliability_score)
VALUES
 ('Lusaka Safety Supplies Ltd', 'Safety & PPE', 'Lusaka', 'Zambia', 'sales@lusakasafety.example', '+260-97-1111111', 'approved', 82),
 ('Kitwe Industrial Traders', 'Safety & PPE', 'Kitwe', 'Zambia', 'sales@kitweindustrial.example', '+260-97-2222222', 'approved', 74),
 ('Ndola PPE Distributors', 'Safety & PPE', 'Ndola', 'Zambia', 'sales@ndolappe.example', '+260-97-3333333', 'pending', 0);

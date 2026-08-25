-- ============================================================================
-- VEYRONA CORE SCHEMA
-- Target: SQLite for local dev/pilot (Section 7: "SQLite may remain for local
-- development/testing"). Designed so migration to Postgres/MySQL is a
-- near-direct port (no SQLite-only tricks beyond AUTOINCREMENT/TEXT dates).
-- ============================================================================



-- ---------------------------------------------------------------------------
-- AUTH / RBAC
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,          -- admin, operator, customer, supplier, approver
  description   TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  id            SERIAL PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,          -- e.g. 'quotation.approve', 'supplier.award'
  description   TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id       INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role_id       INTEGER NOT NULL REFERENCES roles(id),
  status        TEXT NOT NULL DEFAULT 'active', -- active, suspended
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token         TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- ORGANIZATIONS / CUSTOMERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organizations (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'customer', -- customer, internal
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
  id            SERIAL PRIMARY KEY,
  organization_id INTEGER REFERENCES organizations(id),
  name          TEXT NOT NULL,
  company       TEXT,
  email         TEXT,
  phone         TEXT,
  whatsapp_number TEXT,
  billing_address TEXT,
  delivery_address TEXT,
  preferred_language TEXT DEFAULT 'en',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_contacts (
  id            SERIAL PRIMARY KEY,
  customer_id   INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  role          TEXT,
  email         TEXT,
  phone         TEXT,
  is_primary    INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- SUPPLIERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT,                 -- primary category / industry
  location      TEXT,
  country       TEXT DEFAULT 'Zambia',
  email         TEXT,
  phone         TEXT,
  whatsapp_number TEXT,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending, approved, suspended, blacklisted
  approved_by   INTEGER REFERENCES users(id),
  approved_at   TEXT,
  compliance_notes TEXT,
  reliability_score DOUBLE PRECISION DEFAULT 0,     -- 0-100, computed by supplier scoring service
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id            SERIAL PRIMARY KEY,
  supplier_id   INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  role          TEXT,
  email         TEXT,
  phone         TEXT,
  is_primary    INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- PRODUCTS / CATALOG
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_categories (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  parent_id     INTEGER REFERENCES product_categories(id)
);

CREATE TABLE IF NOT EXISTS products (
  id            SERIAL PRIMARY KEY,
  category_id   INTEGER REFERENCES product_categories(id),
  name          TEXT NOT NULL,
  description   TEXT,
  unit          TEXT NOT NULL DEFAULT 'unit', -- pcs, kg, box, pair, etc.
  specification TEXT,                 -- canonical structured spec (JSON string)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_products (
  id            SERIAL PRIMARY KEY,
  supplier_id   INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  typical_price DOUBLE PRECISION,
  currency      TEXT DEFAULT 'ZMW',
  lead_time_days INTEGER,
  UNIQUE(supplier_id, product_id)
);

-- ---------------------------------------------------------------------------
-- PROCUREMENT REQUESTS (customer intent, AI-extracted or manual)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS procurement_requests (
  id            SERIAL PRIMARY KEY,
  request_number TEXT NOT NULL UNIQUE,
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  channel       TEXT NOT NULL DEFAULT 'web', -- web, whatsapp, manual
  raw_text      TEXT,                  -- original natural-language request, if any
  destination   TEXT,
  requested_delivery_date TEXT,
  status        TEXT NOT NULL DEFAULT 'draft', -- draft, clarifying, ready, rfq_issued, quoted, ordered, cancelled
  ai_confidence DOUBLE PRECISION,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS procurement_request_items (
  id            SERIAL PRIMARY KEY,
  procurement_request_id INTEGER NOT NULL REFERENCES procurement_requests(id) ON DELETE CASCADE,
  product_id    INTEGER REFERENCES products(id),
  description   TEXT NOT NULL,         -- free text if no catalog match yet
  quantity      DOUBLE PRECISION NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'unit',
  specification TEXT,
  is_ambiguous  INTEGER NOT NULL DEFAULT 0,
  clarification_notes TEXT
);

-- ---------------------------------------------------------------------------
-- RFQ
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rfqs (
  id            SERIAL PRIMARY KEY,
  rfq_number    TEXT NOT NULL UNIQUE,
  procurement_request_id INTEGER NOT NULL REFERENCES procurement_requests(id),
  status        TEXT NOT NULL DEFAULT 'draft', -- draft, sent, closed, cancelled
  issued_at     TEXT,
  response_deadline TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rfq_items (
  id            SERIAL PRIMARY KEY,
  rfq_id        INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  procurement_request_item_id INTEGER REFERENCES procurement_request_items(id),
  description   TEXT NOT NULL,
  quantity      DOUBLE PRECISION NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'unit'
);

CREATE TABLE IF NOT EXISTS rfq_supplier_recipients (
  id            SERIAL PRIMARY KEY,
  rfq_id        INTEGER NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id   INTEGER NOT NULL REFERENCES suppliers(id),
  sent_at       TEXT,
  channel       TEXT DEFAULT 'email',
  status        TEXT NOT NULL DEFAULT 'pending', -- pending, sent, responded, declined, no_response
  UNIQUE(rfq_id, supplier_id)
);

-- ---------------------------------------------------------------------------
-- SUPPLIER QUOTATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supplier_quotations (
  id            SERIAL PRIMARY KEY,
  rfq_id        INTEGER NOT NULL REFERENCES rfqs(id),
  supplier_id   INTEGER NOT NULL REFERENCES suppliers(id),
  currency      TEXT NOT NULL DEFAULT 'ZMW',
  payment_terms TEXT,
  delivery_days INTEGER,
  validity_date TEXT,
  status        TEXT NOT NULL DEFAULT 'received', -- received, verified, rejected, superseded
  source        TEXT DEFAULT 'manual',  -- manual, ai_parsed_email, ai_parsed_pdf, whatsapp
  raw_source_ref TEXT,                  -- pointer/notes on original doc, never fabricated
  verified_by   INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_quotation_items (
  id            SERIAL PRIMARY KEY,
  supplier_quotation_id INTEGER NOT NULL REFERENCES supplier_quotations(id) ON DELETE CASCADE,
  rfq_item_id   INTEGER REFERENCES rfq_items(id),
  description   TEXT NOT NULL,
  quantity      DOUBLE PRECISION NOT NULL,
  unit_price    DOUBLE PRECISION NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'unit',
  lead_time_days INTEGER,
  notes         TEXT
);

-- ---------------------------------------------------------------------------
-- COMPARISON / SCORING / NEGOTIATION
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quotation_comparisons (
  id            SERIAL PRIMARY KEY,
  rfq_id        INTEGER NOT NULL REFERENCES rfqs(id),
  recommended_supplier_quotation_id INTEGER REFERENCES supplier_quotations(id),
  explanation   TEXT,                 -- human-readable rationale (AI or rules generated)
  generated_by  TEXT DEFAULT 'rules', -- rules, ai
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS supplier_scores (
  id            SERIAL PRIMARY KEY,
  supplier_id   INTEGER NOT NULL REFERENCES suppliers(id),
  price_score   DOUBLE PRECISION, availability_score DOUBLE PRECISION, delivery_score DOUBLE PRECISION,
  quality_score DOUBLE PRECISION, response_score DOUBLE PRECISION, compliance_score DOUBLE PRECISION,
  overall_score DOUBLE PRECISION,
  computed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS negotiation_sessions (
  id            SERIAL PRIMARY KEY,
  supplier_quotation_id INTEGER NOT NULL REFERENCES supplier_quotations(id),
  status        TEXT NOT NULL DEFAULT 'open', -- open, closed, escalated
  max_rounds    INTEGER NOT NULL DEFAULT 2,
  rounds_used   INTEGER NOT NULL DEFAULT 0,
  target_price  DOUBLE PRECISION,
  min_price     DOUBLE PRECISION,
  authorized_by INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS negotiation_messages (
  id            SERIAL PRIMARY KEY,
  negotiation_session_id INTEGER NOT NULL REFERENCES negotiation_sessions(id) ON DELETE CASCADE,
  direction     TEXT NOT NULL, -- outbound, inbound
  message       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- CUSTOMER QUOTATIONS / MARGIN
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_quotations (
  id            SERIAL PRIMARY KEY,
  quotation_number TEXT NOT NULL UNIQUE,
  procurement_request_id INTEGER NOT NULL REFERENCES procurement_requests(id),
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  supplier_quotation_id INTEGER REFERENCES supplier_quotations(id),
  currency      TEXT NOT NULL DEFAULT 'ZMW',
  subtotal      DOUBLE PRECISION NOT NULL DEFAULT 0,
  margin_rule   TEXT,                  -- e.g. 'percentage:12' or 'fixed:500'
  margin_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  tax_amount    DOUBLE PRECISION NOT NULL DEFAULT 0,
  delivery_charge DOUBLE PRECISION NOT NULL DEFAULT 0,
  discount_amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  grand_total   DOUBLE PRECISION NOT NULL DEFAULT 0,
  payment_terms TEXT,
  delivery_estimate TEXT,
  validity_date TEXT,
  status        TEXT NOT NULL DEFAULT 'draft', -- draft, pending_approval, approved, sent, accepted, rejected, expired
  approved_by   INTEGER REFERENCES users(id),
  approved_at   TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_quotation_items (
  id            SERIAL PRIMARY KEY,
  customer_quotation_id INTEGER NOT NULL REFERENCES customer_quotations(id) ON DELETE CASCADE,
  description   TEXT NOT NULL,
  quantity      DOUBLE PRECISION NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'unit',
  unit_cost     DOUBLE PRECISION NOT NULL,          -- supplier cost basis
  unit_price    DOUBLE PRECISION NOT NULL,          -- customer-facing price (cost + margin)
  line_total    DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id            SERIAL PRIMARY KEY,
  entity_type   TEXT NOT NULL,          -- customer_quotation, supplier_award, negotiation, margin_exception
  entity_id     INTEGER NOT NULL,
  requested_by  INTEGER REFERENCES users(id),
  decided_by    INTEGER REFERENCES users(id),
  status        TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  reason        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at    TEXT
);

-- ---------------------------------------------------------------------------
-- ORDERS / FULFILMENT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id            SERIAL PRIMARY KEY,
  order_number  TEXT NOT NULL UNIQUE,
  customer_quotation_id INTEGER NOT NULL REFERENCES customer_quotations(id),
  customer_id   INTEGER NOT NULL REFERENCES customers(id),
  supplier_id   INTEGER REFERENCES suppliers(id),
  status        TEXT NOT NULL DEFAULT 'created', -- created, confirmed, in_fulfilment, delivered, closed, cancelled
  grand_total   DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency      TEXT NOT NULL DEFAULT 'ZMW',
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  description   TEXT NOT NULL,
  quantity      DOUBLE PRECISION NOT NULL,
  unit          TEXT NOT NULL DEFAULT 'unit',
  unit_price    DOUBLE PRECISION NOT NULL,
  line_total    DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending', -- pending, dispatched, in_transit, delivered, failed
  tracking_ref  TEXT,
  estimated_date TEXT,
  actual_date   TEXT,
  notes         TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- PAYMENTS (provider-neutral, Section 14)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id            SERIAL PRIMARY KEY,
  order_id      INTEGER NOT NULL REFERENCES orders(id),
  provider      TEXT,                  -- to be finalized per Section 14/26
  amount        DOUBLE PRECISION NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'ZMW',
  status        TEXT NOT NULL DEFAULT 'pending', -- pending, paid, failed, refunded, partial
  transaction_ref TEXT,
  webhook_verified INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- DOCUMENTS / NOTIFICATIONS / CONVERSATIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
  id            SERIAL PRIMARY KEY,
  entity_type   TEXT NOT NULL,          -- customer_quotation, rfq, order
  entity_id     INTEGER NOT NULL,
  doc_type      TEXT NOT NULL,          -- quotation_pdf, rfq_pdf, po_pdf
  file_path     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id            SERIAL PRIMARY KEY,
  recipient_type TEXT NOT NULL,         -- customer, supplier, user
  recipient_id  INTEGER NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'system', -- system, email, whatsapp, sms
  message       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS conversations (
  id            SERIAL PRIMARY KEY,
  customer_id   INTEGER REFERENCES customers(id),
  channel       TEXT NOT NULL DEFAULT 'web', -- web, whatsapp
  procurement_request_id INTEGER REFERENCES procurement_requests(id),
  language      TEXT DEFAULT 'en',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS messages (
  id            SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender        TEXT NOT NULL,          -- customer, veronica, agent
  original_text TEXT NOT NULL,
  original_language TEXT,
  translated_text TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- AI / AUDIT / SETTINGS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_runs (
  id            SERIAL PRIMARY KEY,
  purpose       TEXT NOT NULL,          -- extraction, comparison, negotiation, translation
  model         TEXT,
  input_ref     TEXT,
  output_ref    TEXT,
  confidence    DOUBLE PRECISION,
  status        TEXT NOT NULL DEFAULT 'ok', -- ok, error, escalated
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_extractions (
  id            SERIAL PRIMARY KEY,
  ai_run_id     INTEGER REFERENCES ai_runs(id),
  procurement_request_id INTEGER REFERENCES procurement_requests(id),
  extracted_json TEXT NOT NULL,         -- raw structured output, unmodified, for audit
  confidence    DOUBLE PRECISION,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            SERIAL PRIMARY KEY,
  actor_type    TEXT NOT NULL,          -- user, ai, system
  actor_id      TEXT,
  action        TEXT NOT NULL,          -- e.g. 'customer_quotation.approve'
  entity_type   TEXT,
  entity_id     INTEGER,
  before_json   TEXT,
  after_json    TEXT,
  ip_address    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS system_settings (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_pr_customer ON procurement_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_rfq_request ON rfqs(procurement_request_id);
CREATE INDEX IF NOT EXISTS idx_sq_rfq ON supplier_quotations(rfq_id);
CREATE INDEX IF NOT EXISTS idx_cq_request ON customer_quotations(procurement_request_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);

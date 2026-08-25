# Veyrona — Technical Audit & Architecture Map (v0.1 MVP)

This is the audit deliverable requested in Section 1 ("First task") and
Section 29 ("Immediate handover task") of the transfer package, produced
against the codebase actually built in this session — there was no prior
Veyrona/CAMIS source repository attached to this project, only the transfer
package itself. This audit therefore documents what was **built new** in
this session as the "current architecture," rather than auditing a
pre-existing prototype that wasn't provided.

## A. Current architecture map

```
veyrona/
├── server/
│   ├── index.js            # HTTP entrypoint: DB bootstrap, router wiring, static file serving
│   ├── db/
│   │   ├── schema.sql       # Full relational schema (see Section B)
│   │   ├── seed.sql         # Roles, permissions, settings, sample data
│   │   └── db.js            # node:sqlite wrapper (migrate/seed/query helpers)
│   ├── lib/
│   │   ├── auth.js          # Password hashing (scrypt), sessions, RBAC checks
│   │   ├── audit.js         # Audit log writer
│   │   ├── router.js        # Minimal dependency-free HTTP router (Express-like API)
│   │   └── middleware.js    # attachUser / requireAuth / requirePermission
│   ├── services/
│   │   ├── marginService.js # Deterministic commercial/margin engine (NOT AI)
│   │   └── aiGateway.js     # Provider-neutral Veronica extraction (Anthropic + offline fallback)
│   └── routes/
│       ├── auth.js, customers.js, suppliers.js, products.js,
│       │ requests.js, rfqs.js, quotations.js, customerQuotations.js,
│       │ orders.js, dashboard.js
├── public/                  # Vanilla-JS SPA (no build step): index.html, css/style.css, js/app.js
├── tests/                   # node:test unit tests (margin engine, RBAC, AI fallback)
├── data/                    # SQLite file lives here at runtime (gitignored)
├── .env.example
└── package.json             # Zero external runtime dependencies
```

**Stack decision and why:** Node.js 22 with the built-in `node:sqlite`
module, a hand-rolled ~90-line Express-like router, and a dependency-free
vanilla JS frontend. This was a deliberate choice for this build
environment specifically (no network access for `npm install`), not a
recommendation to avoid Express/React in your own environment. **Section 25
deployment note:** before going to production, most teams will want to
either (a) keep this structure and swap in Express purely for ecosystem
convenience (middleware, static-serving, etc.), since the route handler
signature `(req, res)` already matches Express's, or (b) rebuild the
frontend in React/Vite if the team wants component reuse and a build
pipeline. Neither is required for correctness — both are available options.

## B. Current database map

SQLite (file-based), full schema in `server/db/schema.sql`. All 33 core
entities from Section 8 of the transfer package are implemented as real
tables with foreign keys, not placeholders:

`roles, permissions, role_permissions, users, sessions, organizations,
customers, customer_contacts, suppliers, supplier_contacts,
product_categories, products, supplier_products, procurement_requests,
procurement_request_items, rfqs, rfq_items, rfq_supplier_recipients,
supplier_quotations, supplier_quotation_items, quotation_comparisons,
supplier_scores, negotiation_sessions, negotiation_messages,
customer_quotations, customer_quotation_items, approvals, orders,
order_items, deliveries, payments, documents, notifications, conversations,
messages, ai_runs, ai_extractions, audit_logs, system_settings`

Notes:
- `supplier_scores`, `negotiation_sessions/messages`, `payments`,
  `documents`, `notifications`, `conversations/messages` have tables and
  are referenced from the schema, but **do not yet have route handlers** —
  see Section D (missing capabilities) below. The reliability score used
  today lives directly on `suppliers.reliability_score`; the richer
  multi-factor `supplier_scores` history table is scaffolded but unused.
- Money columns are plain `REAL`. For a production ledger, consider integer
  minor-unit storage (ngwee, i.e. cents) to avoid floating-point drift —
  flagged here rather than silently changed, per the "do not silently
  change business rules" instruction.
- SQLite is explicitly acceptable for local/pilot use per Section 7. A
  Postgres migration is a schema port (few SQLite-only idioms used:
  `AUTOINCREMENT`, `datetime('now')`) plus swapping `server/db/db.js`'s
  driver.

## C. What is actually implemented vs. planned

**Implemented and tested end-to-end** (see `tests/` and the workflow this
was validated against — the exact worked example from Section 5 of the
transfer package: "50 mining helmets, 30 pairs of safety boots, 20
reflective jackets to Kitwe"):

1. Auth (scrypt password hashing, session tokens, RBAC by permission code)
2. Customer management (CRUD + contacts)
3. Supplier management (CRUD + contacts + approval/status workflow +
   blacklist/suspend controls — Section 11)
4. Product/category catalog + supplier-product price book
5. Procurement request intake — manual item entry **or** raw-text intake
   routed through Veronica's extraction (Section 4/9)
6. RFQ engine — supplier suggestion by category/location/approval/
   reliability, RFQ creation, issuing
7. Supplier quotation intake (manual entry only — see Section D) +
   mandatory human verification step before a quotation can be used
8. Deterministic rules-based comparison/ranking (price + delivery +
   reliability, configurable weights) with a stored explanation
9. Deterministic margin engine (`marginService.js`) — **not** AI-driven,
   per the transfer package's core operating principle — with automatic
   approval-required flagging when margin falls below the configured floor
10. Customer quotation generation, approval workflow, send, and
    accept/reject recording
11. Order creation from an accepted quotation, with order/delivery status
    tracking
12. Full audit logging on every mutating action (`audit_logs` table +
    `/api/audit-logs` viewer), with actor type distinguishing `user` vs
    `ai` vs `system`
13. Veronica's requirement extraction: calls the Anthropic API when
    `ANTHROPIC_API_KEY` is set, and **always** falls back to a clearly
    low-confidence, clearly-flagged rule-based parser otherwise — so the
    platform is fully testable without a live key, and no extraction is
    ever silently treated as more confident than it is.

**Explicitly NOT implemented yet** (planned, per Section 22 roadmap):
- WhatsApp integration (Section 12) — customer/supplier contact fields
  exist (`whatsapp_number`), but no Meta/WhatsApp Business API wiring
- Multilingual translation layer (Section 13) — `preferred_language` and
  `messages.translated_text` columns exist; no translation calls wired
- Payments (Section 14) — `payments` table exists; no provider integration
  (correctly left as "TBD" per Section 14/26 of the brief)
- AI-assisted negotiation (Section 10) — `negotiation_sessions/messages`
  tables exist; no negotiation logic or authority-limit enforcement yet
- AI-parsed supplier quotations from email/PDF/WhatsApp — quotation entry
  is manual-only right now (a human or ops team member types in what a
  supplier quoted). This is the safer default given "never invent supplier
  prices"; an AI-assisted parse could pre-fill the same manual-entry form
  as a future enhancement, with a human still required to hit "Verify."
- Background job queue (Section 21) — RFQ issuing/notifications are
  synchronous today. Fine for pilot volume; needs a queue before scale.
- Document generation as actual PDF files (Section 17) — the customer
  quotation view is print/browser-PDF-ready (`window.print()` with print
  CSS) but there's no server-side PDF file generation/storage yet.
- Multi-tenant isolation, MFA, supplier_scores history, conversations/
  messages UI — scaffolded in the schema, not yet built.

## D. Security risks / gaps to close before any real pilot

1. **Default admin password.** `ChangeMe123!` is created automatically if
   `VEYRONA_ADMIN_PASSWORD` isn't set. Must be rotated immediately in any
   non-local environment.
2. **No rate limiting** on `/api/auth/login` — add before internet-facing
   deployment (brute-force risk).
3. **No HTTPS/TLS termination** built in — this is a plain HTTP Node
   server; put it behind a reverse proxy (nginx/Caddy) or a platform LB
   that terminates TLS in any real deployment (Section 25).
4. **No CSRF protection** — low risk today since the frontend uses
   `Authorization: Bearer` tokens (not cookies) for API auth, but revisit
   if cookie-based auth is ever added.
5. **No input size limits beyond a 5MB body cap** in the router — fine for
   this workload, but add stricter per-field validation before opening the
   API to untrusted external submitters (e.g. a public customer portal).
6. **Session tokens are stored in `localStorage`** in the current frontend
   — acceptable for an internal ops console, but if a public customer/
   supplier portal is built later, reconsider (XSS exposure) in favor of
   httpOnly cookies.
7. **No secrets in this repo** — `.env.example` has empty values by
   design; confirm `.env` itself is gitignored before pushing to any
   remote.
8. **Prompt-injection defense is structural but not adversarially
   tested yet.** `aiGateway.js` fences customer text as data and
   instructs the model to ignore embedded instructions, per Section 16 —
   but this has not been red-teamed. Add adversarial test cases (Section
   24: "prompt-injection tests") before trusting AI-parsed supplier
   documents in production.

## E. Integration requirements (for the next phase)

- **WhatsApp Business API** (Meta) — access token, business account ID,
  webhook verify token (placeholders already in `.env.example`)
- **Anthropic API key** for live Veronica extraction (`ANTHROPIC_API_KEY`)
  — already wired, just needs a real key
- **Payment provider** — TBD per Section 14/26; `payments` table is
  provider-neutral and ready once a provider is chosen
- **Object storage** (S3-compatible or similar) for supplier certificates,
  quotation PDFs, and other `documents` once file upload is added
- **Postgres** (or equivalent) when moving beyond pilot scale — see
  Section B migration notes

## F. Prioritized next-milestone roadmap

Per Section 29's request for "first 3 implementation milestones":

1. **Milestone 1 — Harden what exists.** Rate limiting on auth, HTTPS via
   reverse proxy, admin password rotation flow, basic input validation
   pass, and prompt-injection adversarial tests. This is the fastest path
   to a safe internal pilot with real (non-demo) users.
2. **Milestone 2 — AI-assisted quotation intake.** Let Veronica parse a
   pasted supplier email or uploaded PDF into a pre-filled quotation entry
   form (still requiring human "Verify" before it's usable) — this is the
   single highest-leverage automation step per Section 4/9, and reuses the
   same `ai_runs`/`ai_extractions` audit pattern already built for request
   intake.
3. **Milestone 3 — WhatsApp intake channel.** Wire the Meta webhook so
   customers can start a procurement request from WhatsApp, using the
   existing `conversations`/`messages` tables and the same
   `extractProcurementRequest()` call already used by the web form.

Everything after that (negotiation engine, payments, multilingual,
multi-tenant) is lower-urgency per the transfer package's own MVP framing
(Section 23) and should wait for pilot feedback.

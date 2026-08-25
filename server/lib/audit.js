'use strict';
const db = require('../db/db');

/**
 * Record an audit log entry. Every mutating action in Veyrona should call
 * this — financial, supplier, contract, permission and AI-triggered changes
 * per Section 15 (Security & Governance) and Section 16 (AI safety).
 */
async function log({ actorType, actorId, action, entityType, entityId, before, after, ip }) {
  await db.run(
    `INSERT INTO audit_logs (actor_type, actor_id, action, entity_type, entity_id, before_json, after_json, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actorType,
      actorId != null ? String(actorId) : null,
      action,
      entityType || null,
      entityId || null,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify(after) : null,
      ip || null,
    ]
  );
}

module.exports = { log };

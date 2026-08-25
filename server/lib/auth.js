'use strict';
const crypto = require('node:crypto');
const db = require('../db/db');

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const check = crypto.scryptSync(password, salt, 64).toString('hex');
  // constant-time compare
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await db.run('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)', [token, userId, expiresAt]);
  return { token, expiresAt };
}

async function getSessionUser(token) {
  if (!token) return null;
  const session = await db.get('SELECT * FROM sessions WHERE token = ?', [token]);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    await db.run('DELETE FROM sessions WHERE token = ?', [token]);
    return null;
  }
  const user = await db.get(
    `SELECT u.id, u.name, u.email, u.status, r.name AS role
     FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
    [session.user_id]
  );
  return user || null;
}

async function userHasPermission(user, permissionCode) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const row = await db.get(
    `SELECT 1
       FROM role_permissions rp
       JOIN roles r ON r.id = rp.role_id
       JOIN permissions p ON p.id = rp.permission_id
      WHERE r.name = ? AND p.code = ?`,
    [user.role, permissionCode]
  );
  return !!row;
}

async function ensureDefaultAdmin() {
  const existing = await db.get('SELECT id FROM users WHERE email = ?', ['admin@veyrona.local']);
  if (existing) return;
  const adminPassword = process.env.VEYRONA_ADMIN_PASSWORD || 'ChangeMe123!';
  const { hash, salt } = hashPassword(adminPassword);
  const role = await db.get("SELECT id FROM roles WHERE name = 'admin'");
  await db.run(
    'INSERT INTO users (name, email, password_hash, password_salt, role_id, status) VALUES (?, ?, ?, ?, ?, ?)',
    ['Veyrona Admin', 'admin@veyrona.local', hash, salt, role.id, 'active']
  );
  if (!process.env.VEYRONA_ADMIN_PASSWORD) {
    console.log('\n[Veyrona] Created default admin: admin@veyrona.local / ChangeMe123!  (CHANGE THIS)\n');
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  getSessionUser,
  userHasPermission,
  ensureDefaultAdmin,
};

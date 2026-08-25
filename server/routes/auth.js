'use strict';
const { Router } = require('../lib/router');
const db = require('../db/db');
const { verifyPassword, createSession } = require('../lib/auth');
const audit = require('../lib/audit');

const router = new Router();

router.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.error(400, 'email and password are required');

  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || user.status !== 'active') return res.error(401, 'Invalid credentials');

  const ok = verifyPassword(password, user.password_hash, user.password_salt);
  if (!ok) {
    await audit.log({ actorType: 'user', actorId: user.id, action: 'auth.login_failed' });
    return res.error(401, 'Invalid credentials');
  }

  const { token, expiresAt } = await createSession(user.id);
  const role = await db.get('SELECT name FROM roles WHERE id = ?', [user.role_id]);
  await audit.log({ actorType: 'user', actorId: user.id, action: 'auth.login' });
  res.json({
    token,
    expiresAt,
    user: { id: user.id, name: user.name, email: user.email, role: role.name },
  });
});

router.post('/api/auth/logout', async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) await db.run('DELETE FROM sessions WHERE token = ?', [token]);
  res.json({ ok: true });
});

router.get('/api/auth/me', async (req, res) => {
  if (!req.user) return res.error(401, 'Not authenticated');
  res.json({ user: req.user });
});

module.exports = router;

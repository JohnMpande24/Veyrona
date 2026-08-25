'use strict';
const { getSessionUser, userHasPermission } = require('./auth');

async function attachUser(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : (req.headers['x-session-token'] || null);
  req.user = await getSessionUser(token);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.error(401, 'Authentication required');
  next();
}

function requirePermission(code) {
  return async (req, res, next) => {
    if (!req.user) return res.error(401, 'Authentication required');
    if (!(await userHasPermission(req.user, code))) {
      return res.error(403, `Missing permission: ${code}`);
    }
    next();
  };
}

module.exports = { attachUser, requireAuth, requirePermission };

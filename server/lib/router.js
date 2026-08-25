'use strict';

/**
 * Tiny Express-like router built on node:http only. No external
 * dependencies — this environment has no network access for npm install,
 * and Node 22's built-ins (http, sqlite, crypto) are enough to build this
 * cleanly. Swapping to Express later is a mechanical, low-risk change since
 * the handler signature (req, res) matches.
 */
class Router {
  constructor() {
    this.routes = []; // { method, pattern: RegExp, keys: string[], handlers: fn[] }
    this.middlewares = [];
  }

  use(fn) {
    this.middlewares.push(fn);
    return this;
  }

  _add(method, path, handlers) {
    const keys = [];
    const pattern = new RegExp(
      '^' +
        path
          .replace(/\/:([^/]+)/g, (_, key) => {
            keys.push(key);
            return '/([^/]+)';
          })
          .replace(/\//g, '\\/') +
        '$'
    );
    this.routes.push({ method, pattern, keys, handlers });
  }

  get(path, ...handlers) { this._add('GET', path, handlers); }
  post(path, ...handlers) { this._add('POST', path, handlers); }
  put(path, ...handlers) { this._add('PUT', path, handlers); }
  patch(path, ...handlers) { this._add('PATCH', path, handlers); }
  delete(path, ...handlers) { this._add('DELETE', path, handlers); }

  async handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    req.query = Object.fromEntries(url.searchParams.entries());
    req.path = url.pathname;

    const chain = [...this.middlewares];
    const match = this.routes.find((r) => r.method === req.method && r.pattern.test(req.path));

    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (obj) => {
      const body = JSON.stringify(obj, null, 2);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(body);
    };
    res.error = (code, message, extra) => {
      res.status(code).json({ error: message, ...(extra || {}) });
    };

    if (!match) {
      res.error(404, 'Not found');
      return;
    }
    const m = match.pattern.exec(req.path);
    req.params = {};
    match.keys.forEach((key, i) => { req.params[key] = decodeURIComponent(m[i + 1]); });

    const allHandlers = [...chain, ...match.handlers];
    let idx = 0;
    const next = async (err) => {
      if (err) {
        console.error(err);
        if (!res.writableEnded) res.error(500, 'Internal server error', { detail: err.message });
        return;
      }
      const handler = allHandlers[idx++];
      if (!handler) return;
      try {
        await handler(req, res, next);
      } catch (e) {
        next(e);
      }
    };
    await next();
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'DELETE') return resolve({});
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 5_000_000) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

module.exports = { Router, readJsonBody };

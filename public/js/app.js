'use strict';

/* =========================================================================
   API CLIENT
   ========================================================================= */
const API = {
  token: localStorage.getItem('veyrona_token') || null,
  user: JSON.parse(localStorage.getItem('veyrona_user') || 'null'),

  async call(method, path, body) {
    const res = await fetch('/api' + path, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(this.token ? { authorization: 'Bearer ' + this.token } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch (_) { /* no body */ }
    if (!res.ok) {
      if (res.status === 401) this.logout();
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return data;
  },
  get(path) { return this.call('GET', path); },
  post(path, body) { return this.call('POST', path, body); },
  put(path, body) { return this.call('PUT', path, body); },

  setSession(token, user) {
    this.token = token;
    this.user = user;
    localStorage.setItem('veyrona_token', token);
    localStorage.setItem('veyrona_user', JSON.stringify(user));
  },
  logout() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('veyrona_token');
    localStorage.removeItem('veyrona_user');
    location.hash = '#/login';
    render();
  },
};

/* =========================================================================
   TINY DOM / TOAST HELPERS
   ========================================================================= */
function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function money(n, currency) {
  const num = Number(n || 0);
  return `${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency || ''}`.trim();
}
function fmtDate(s) {
  if (!s) return '—';
  return s.replace('T', ' ').slice(0, 16);
}
function toast(message, type = '') {
  const el = h(`<div class="toast ${type}">${esc(message)}</div>`);
  document.getElementById('toast-wrap').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}
async function guarded(fn) {
  try { return await fn(); }
  catch (err) { toast(err.message, 'error'); throw err; }
}

const STATUS_TONE = {
  active: 'patina', approved: 'patina', verified: 'patina', accepted: 'patina', delivered: 'patina', ready: 'patina',
  pending: 'amber', pending_approval: 'amber', draft: '', clarifying: 'amber', sent: 'copper', responded: 'copper',
  rfq_issued: 'copper', quoted: 'copper', ordered: 'patina', created: 'copper', confirmed: 'copper', in_fulfilment: 'copper',
  rejected: 'danger', cancelled: 'danger', blacklisted: 'danger', suspended: 'danger', expired: 'danger', declined: 'danger', no_response: '',
};
function statusBadge(status) {
  const tone = STATUS_TONE[status] ?? '';
  return `<span class="badge ${tone}">${esc((status || '').replace(/_/g, ' '))}</span>`;
}

/* =========================================================================
   ROUTER
   ========================================================================= */
const routes = [];
function route(pattern, handler) {
  const keys = [];
  const regex = new RegExp('^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$');
  routes.push({ regex, keys, handler });
}
async function render() {
  const app = document.getElementById('app');
  const hash = location.hash.replace(/^#/, '') || '/dashboard';

  if (!API.token && hash !== '/login') { location.hash = '#/login'; return; }
  if (API.token && hash === '/login') { location.hash = '#/dashboard'; return; }

  for (const r of routes) {
    const m = r.regex.exec(hash);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      app.innerHTML = '';
      try {
        await r.handler(params, app);
      } catch (err) {
        app.appendChild(h(`<div class="content"><div class="card">Failed to load: ${esc(err.message)}</div></div>`));
      }
      return;
    }
  }
  app.innerHTML = '<div class="content"><div class="card">Not found.</div></div>';
}
window.addEventListener('hashchange', render);
window.addEventListener('DOMContentLoaded', render);

/* =========================================================================
   SHELL (sidebar + topbar) — wraps every authenticated view
   ========================================================================= */
const NAV = [
  { group: 'Overview', items: [{ href: '#/dashboard', label: 'Dashboard', icon: '◧' }] },
  { group: 'Pipeline', items: [
    { href: '#/requests', label: 'Procurement Requests', icon: '☰' },
    { href: '#/rfqs', label: 'RFQs & Quotations', icon: '⇄' },
    { href: '#/quotations', label: 'Customer Quotations', icon: '▤' },
    { href: '#/orders', label: 'Orders', icon: '▣' },
  ]},
  { group: 'Network', items: [
    { href: '#/customers', label: 'Customers', icon: '◔' },
    { href: '#/suppliers', label: 'Suppliers', icon: '◑' },
  ]},
  { group: 'Governance', items: [{ href: '#/audit', label: 'Audit Log', icon: '≣' }] },
];

async function shell(app, { title, crumb, badges = {} }) {
  const currentHash = location.hash.replace(/^#/, '');
  const sidebar = h(`
    <div class="sidebar">
      <div class="brand">
        <div>
          <div class="brand-mark">VEY<span>RONA</span></div>
          <div class="brand-sub">Procurement OS</div>
        </div>
      </div>
      ${NAV.map((g) => `
        <div class="nav-group">
          <div class="nav-label">${esc(g.group)}</div>
          ${g.items.map((item) => `
            <a class="nav-link ${currentHash.startsWith(item.href.slice(1)) ? 'active' : ''}" href="${item.href}">
              <span>${item.icon} &nbsp;${esc(item.label)}</span>
              ${badges[item.href] ? `<span class="nav-badge">${badges[item.href]}</span>` : ''}
            </a>`).join('')}
        </div>`).join('')}
      <div class="sidebar-footer">
        <div class="who">${esc(API.user?.name || '')}</div>
        <span class="role-pill">${esc(API.user?.role || '')}</span>
        <div><span class="logout-link" id="logout-btn">Sign out</span></div>
      </div>
    </div>
  `);
  const main = h(`
    <div class="main">
      <div class="topbar">
        <div>
          ${crumb ? `<div class="crumb">${esc(crumb)}</div>` : ''}
          <h1>${esc(title)}</h1>
        </div>
        <button class="menu-toggle" id="menu-toggle">☰</button>
      </div>
      <div class="content" id="view-content"></div>
    </div>
  `);
  const wrap = h(`<div class="shell"></div>`);
  wrap.appendChild(sidebar);
  wrap.appendChild(main);
  app.appendChild(wrap);
  sidebar.querySelector('#logout-btn').addEventListener('click', () => API.logout());
  main.querySelector('#menu-toggle').addEventListener('click', () => wrap.classList.toggle('nav-open'));
  return main.querySelector('#view-content');
}

function pipelineRail(activeStep) {
  const steps = ['Request', 'RFQ', 'Supplier Quotes', 'Comparison', 'Customer Quotation', 'Order'];
  const idx = steps.indexOf(activeStep);
  return `
    <div class="pipeline">
      ${steps.map((s, i) => `
        ${i > 0 ? `<div class="pipeline-wire ${i <= idx ? 'done' : ''}"></div>` : ''}
        <div class="pipeline-step ${i < idx ? 'done' : i === idx ? 'active' : ''}">${esc(s)}</div>
      `).join('')}
    </div>`;
}

/* =========================================================================
   LOGIN
   ========================================================================= */
route('/login', async (params, app) => {
  const wrap = h(`
    <div class="login-screen">
      <div class="login-card">
        <div class="login-brand">
          <div class="brand-mark">VEY<span>RONA</span></div>
          <span class="brand-sub">AI Procurement Console</span>
        </div>
        <form id="login-form" class="stack">
          <div class="field">
            <label>Email</label>
            <input type="email" name="email" value="admin@veyrona.local" required />
          </div>
          <div class="field">
            <label>Password</label>
            <input type="password" name="password" value="ChangeMe123!" required />
          </div>
          <button class="btn btn-primary" type="submit" style="width:100%">Sign in</button>
        </form>
        <div class="login-hint">
          Default admin — change this password after first login.<br/>
          <span class="mono">admin@veyrona.local</span>
        </div>
      </div>
    </div>
  `);
  app.appendChild(wrap);
  wrap.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await guarded(async () => {
      const data = await API.post('/auth/login', { email: fd.get('email'), password: fd.get('password') });
      API.setSession(data.token, data.user);
      toast(`Welcome back, ${data.user.name.split(' ')[0]}`, 'success');
      location.hash = '#/dashboard';
    });
  });
});

/* =========================================================================
   DASHBOARD
   ========================================================================= */
route('/dashboard', async (params, app) => {
  const data = await guarded(() => API.get('/dashboard/summary'));
  const badges = {
    '#/requests': data.counts.open_requests || '',
    '#/rfqs': data.counts.active_rfqs || '',
    '#/quotations': data.counts.quotations_awaiting_decision || '',
    '#/orders': data.counts.open_orders || '',
    '#/suppliers': data.counts.suppliers_pending || '',
  };
  const view = await shell(app, { title: 'Dashboard', crumb: 'Overview', badges });

  view.appendChild(h(`
    <div class="grid grid-4" style="margin-bottom:20px">
      ${statCard('Open requests', data.counts.open_requests)}
      ${statCard('Active RFQs', data.counts.active_rfqs)}
      ${statCard('Pending approvals', data.counts.pending_approvals)}
      ${statCard('Open orders', data.counts.open_orders)}
    </div>
  `));

  const grid = h(`<div class="grid grid-2"></div>`);
  grid.appendChild(h(`
    <div class="card">
      <h3>Recent procurement requests</h3>
      ${data.recentRequests.length ? `
        <table>
          <thead><tr><th>Number</th><th>Customer</th><th>Status</th></tr></thead>
          <tbody>
            ${data.recentRequests.map((r) => `
              <tr class="clickable" data-href="#/requests/${r.id}">
                <td class="mono">${esc(r.request_number)}</td><td>${esc(r.customer_name)}</td><td>${statusBadge(r.status)}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : emptyState('No procurement requests yet.')}
    </div>
  `));
  grid.appendChild(h(`
    <div class="card">
      <h3>Recent orders</h3>
      ${data.recentOrders.length ? `
        <table>
          <thead><tr><th>Number</th><th>Customer</th><th>Status</th><th>Total</th></tr></thead>
          <tbody>
            ${data.recentOrders.map((o) => `
              <tr class="clickable" data-href="#/orders/${o.id}">
                <td class="mono">${esc(o.order_number)}</td><td>${esc(o.customer_name)}</td><td>${statusBadge(o.status)}</td><td class="num">${money(o.grand_total, o.currency)}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : emptyState('No orders yet.')}
    </div>
  `));
  view.appendChild(grid);
  wireRowClicks(view);
});

function statCard(label, value) {
  return `<div class="card stat-card"><div class="stat-num">${value ?? 0}</div><div class="stat-label">${esc(label)}</div></div>`;
}
function emptyState(msg, ctaHtml = '') {
  return `<div class="empty">${esc(msg)}${ctaHtml}</div>`;
}
function wireRowClicks(container) {
  container.querySelectorAll('[data-href]').forEach((el) => {
    el.addEventListener('click', () => { location.hash = el.getAttribute('data-href'); });
  });
}

/* =========================================================================
   CUSTOMERS
   ========================================================================= */
route('/customers', async (params, app) => {
  const view = await shell(app, { title: 'Customers', crumb: 'Network' });
  const { customers } = await guarded(() => API.get('/customers'));

  view.appendChild(h(`
    <div class="flex-between" style="margin-bottom:16px">
      <div class="helper-text">${customers.length} customer${customers.length === 1 ? '' : 's'}</div>
      <button class="btn btn-primary" id="new-customer">+ New customer</button>
    </div>
  `));

  const card = h(`<div class="card"></div>`);
  card.innerHTML = customers.length ? `
    <table>
      <thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Phone</th><th>Status</th></tr></thead>
      <tbody>
        ${customers.map((c) => `
          <tr class="clickable" data-href="#/customers/${c.id}">
            <td>${esc(c.name)}</td><td>${esc(c.company || '—')}</td><td>${esc(c.email || '—')}</td>
            <td class="mono">${esc(c.phone || '—')}</td><td>${statusBadge(c.status)}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : emptyState('No customers yet. Add the first one to start taking procurement requests.');
  view.appendChild(card);
  wireRowClicks(view);

  view.querySelector('#new-customer').addEventListener('click', () => openCustomerModal());
});

function openCustomerModal() {
  const backdrop = h(`
    <div class="modal-backdrop">
      <div class="modal">
        <h3>New customer</h3>
        <form id="customer-form">
          <div class="form-grid">
            <div class="field"><label>Name *</label><input name="name" required /></div>
            <div class="field"><label>Company</label><input name="company" /></div>
            <div class="field"><label>Email</label><input name="email" type="email" /></div>
            <div class="field"><label>Phone</label><input name="phone" /></div>
            <div class="field"><label>WhatsApp number</label><input name="whatsapp_number" /></div>
            <div class="field"><label>Preferred language</label>
              <select name="preferred_language">
                <option value="en">English</option><option value="ny">Nyanja</option><option value="bem">Bemba</option>
              </select>
            </div>
          </div>
          <div class="field"><label>Delivery address</label><textarea name="delivery_address"></textarea></div>
          <div class="btn-row">
            <button type="submit" class="btn btn-primary">Create customer</button>
            <button type="button" class="btn btn-ghost" id="cancel">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  backdrop.querySelector('#cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#customer-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    await guarded(async () => {
      const { customer } = await API.post('/customers', fd);
      toast('Customer created', 'success');
      backdrop.remove();
      location.hash = `#/customers/${customer.id}`;
    });
  });
}

route('/customers/:id', async ({ id }, app) => {
  const view = await shell(app, { title: 'Customer', crumb: 'Network' });
  const { customer, contacts } = await guarded(() => API.get(`/customers/${id}`));
  const { requests } = await guarded(() => API.get(`/requests?customer_id=${id}`));

  view.appendChild(h(`
    <div class="grid grid-2">
      <div class="card">
        <h3>${esc(customer.name)} ${statusBadge(customer.status)}</h3>
        <ul class="subtle-list">
          <li>Company — ${esc(customer.company || '—')}</li>
          <li>Email — ${esc(customer.email || '—')}</li>
          <li>Phone — ${esc(customer.phone || '—')}</li>
          <li>WhatsApp — ${esc(customer.whatsapp_number || '—')}</li>
          <li>Delivery address — ${esc(customer.delivery_address || '—')}</li>
          <li>Language — ${esc(customer.preferred_language)}</li>
        </ul>
      </div>
      <div class="card">
        <h3>Contacts</h3>
        ${contacts.length ? `<ul class="subtle-list">${contacts.map((c) => `<li>${esc(c.name)} — ${esc(c.role || 'contact')} ${c.email ? '· ' + esc(c.email) : ''}</li>`).join('')}</ul>` : emptyState('No additional contacts recorded.')}
      </div>
    </div>
    <div class="section-title">Procurement requests</div>
    <div class="card">
      ${requests.length ? `
        <table>
          <thead><tr><th>Number</th><th>Status</th><th>Destination</th><th>Created</th></tr></thead>
          <tbody>
            ${requests.map((r) => `
              <tr class="clickable" data-href="#/requests/${r.id}">
                <td class="mono">${esc(r.request_number)}</td><td>${statusBadge(r.status)}</td><td>${esc(r.destination || '—')}</td><td class="mono">${fmtDate(r.created_at)}</td>
              </tr>`).join('')}
          </tbody>
        </table>` : emptyState('No procurement requests from this customer yet.')}
    </div>
  `));
  wireRowClicks(view);
});

/* =========================================================================
   SUPPLIERS
   ========================================================================= */
route('/suppliers', async (params, app) => {
  const view = await shell(app, { title: 'Suppliers', crumb: 'Network' });
  const { suppliers } = await guarded(() => API.get('/suppliers'));

  view.appendChild(h(`
    <div class="flex-between" style="margin-bottom:16px">
      <div class="helper-text">${suppliers.length} supplier${suppliers.length === 1 ? '' : 's'} · new suppliers require approval before RFQs can be sent to them</div>
      <button class="btn btn-primary" id="new-supplier">+ New supplier</button>
    </div>
  `));

  const card = h(`<div class="card"></div>`);
  card.innerHTML = suppliers.length ? `
    <table>
      <thead><tr><th>Name</th><th>Category</th><th>Location</th><th>Reliability</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${suppliers.map((s) => `
          <tr>
            <td class="clickable" data-href="#/suppliers/${s.id}">${esc(s.name)}</td>
            <td>${esc(s.category || '—')}</td><td>${esc(s.location || '—')}</td>
            <td class="mono">${s.reliability_score ?? 0}/100</td>
            <td>${statusBadge(s.status)}</td>
            <td>${s.status === 'pending' ? `<button class="btn btn-sm btn-primary" data-approve="${s.id}">Approve</button>` : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : emptyState('No suppliers yet.');
  view.appendChild(card);

  view.querySelectorAll('[data-href]').forEach((el) => el.addEventListener('click', () => { location.hash = el.getAttribute('data-href'); }));
  view.querySelectorAll('[data-approve]').forEach((el) => el.addEventListener('click', async (e) => {
    e.stopPropagation();
    await guarded(async () => {
      await API.post(`/suppliers/${el.dataset.approve}/status`, { status: 'approved' });
      toast('Supplier approved', 'success');
      render();
    });
  }));
  view.querySelector('#new-supplier').addEventListener('click', () => openSupplierModal());
});

function openSupplierModal() {
  const backdrop = h(`
    <div class="modal-backdrop">
      <div class="modal">
        <h3>New supplier</h3>
        <form id="supplier-form">
          <div class="form-grid">
            <div class="field"><label>Name *</label><input name="name" required /></div>
            <div class="field"><label>Category</label><input name="category" placeholder="e.g. Safety & PPE" /></div>
            <div class="field"><label>Location</label><input name="location" placeholder="e.g. Kitwe" /></div>
            <div class="field"><label>Country</label><input name="country" value="Zambia" /></div>
            <div class="field"><label>Email</label><input name="email" type="email" /></div>
            <div class="field"><label>Phone</label><input name="phone" /></div>
          </div>
          <div class="helper-text" style="margin-bottom:14px">New suppliers are created with status "pending" and must be approved before receiving RFQs.</div>
          <div class="btn-row">
            <button type="submit" class="btn btn-primary">Add supplier</button>
            <button type="button" class="btn btn-ghost" id="cancel">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  backdrop.querySelector('#cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#supplier-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    await guarded(async () => {
      const { supplier } = await API.post('/suppliers', fd);
      toast('Supplier added (pending approval)', 'success');
      backdrop.remove();
      location.hash = `#/suppliers/${supplier.id}`;
    });
  });
}

route('/suppliers/:id', async ({ id }, app) => {
  const view = await shell(app, { title: 'Supplier', crumb: 'Network' });
  const { supplier, contacts, products } = await guarded(() => API.get(`/suppliers/${id}`));

  view.appendChild(h(`
    <div class="grid grid-2">
      <div class="card">
        <h3>${esc(supplier.name)} ${statusBadge(supplier.status)}</h3>
        <ul class="subtle-list">
          <li>Category — ${esc(supplier.category || '—')}</li>
          <li>Location — ${esc(supplier.location || '—')}, ${esc(supplier.country)}</li>
          <li>Email — ${esc(supplier.email || '—')}</li>
          <li>Phone — ${esc(supplier.phone || '—')}</li>
          <li>Reliability score — ${supplier.reliability_score ?? 0}/100</li>
        </ul>
        <div class="btn-row" style="margin-top:14px">
          ${supplier.status !== 'approved' ? `<button class="btn btn-primary btn-sm" data-status="approved">Approve</button>` : ''}
          ${supplier.status !== 'suspended' ? `<button class="btn btn-sm" data-status="suspended">Suspend</button>` : ''}
          ${supplier.status !== 'blacklisted' ? `<button class="btn btn-danger btn-sm" data-status="blacklisted">Blacklist</button>` : ''}
        </div>
      </div>
      <div class="card">
        <h3>Catalog items supplied</h3>
        ${products.length ? `<ul class="subtle-list">${products.map((p) => `<li>${esc(p.product_name)} — ${p.typical_price ? money(p.typical_price, p.currency) : 'price not on file'} · ${p.lead_time_days ?? '—'}d lead time</li>`).join('')}</ul>` : emptyState('No catalog items linked yet.')}
      </div>
    </div>
  `));
  view.querySelectorAll('[data-status]').forEach((btn) => btn.addEventListener('click', async () => {
    await guarded(async () => {
      await API.post(`/suppliers/${id}/status`, { status: btn.dataset.status });
      toast(`Supplier marked ${btn.dataset.status}`, 'success');
      render();
    });
  }));
});

/* =========================================================================
   PROCUREMENT REQUESTS
   ========================================================================= */
route('/requests', async (params, app) => {
  const view = await shell(app, { title: 'Procurement Requests', crumb: 'Pipeline' });
  const { requests } = await guarded(() => API.get('/requests'));

  view.appendChild(h(`
    <div class="flex-between" style="margin-bottom:16px">
      <div class="helper-text">${requests.length} request${requests.length === 1 ? '' : 's'}</div>
      <button class="btn btn-primary" id="new-request">+ New request</button>
    </div>
  `));

  const card = h(`<div class="card"></div>`);
  card.innerHTML = requests.length ? `
    <table>
      <thead><tr><th>Number</th><th>Customer</th><th>Channel</th><th>Destination</th><th>Status</th><th>Created</th></tr></thead>
      <tbody>
        ${requests.map((r) => `
          <tr class="clickable" data-href="#/requests/${r.id}">
            <td class="mono">${esc(r.request_number)}</td><td>${esc(r.customer_name)}</td><td>${esc(r.channel)}</td>
            <td>${esc(r.destination || '—')}</td><td>${statusBadge(r.status)}</td><td class="mono">${fmtDate(r.created_at)}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : emptyState('No procurement requests yet. Create one to let Veronica extract the requirements.');
  view.appendChild(card);
  wireRowClicks(view);

  view.querySelector('#new-request').addEventListener('click', () => openRequestModal());
});

async function openRequestModal() {
  const { customers } = await guarded(() => API.get('/customers'));
  const backdrop = h(`
    <div class="modal-backdrop">
      <div class="modal">
        <h3>New procurement request</h3>
        <form id="request-form">
          <div class="field">
            <label>Customer *</label>
            <select name="customer_id" required>
              ${customers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>Channel</label>
            <select name="channel"><option value="web">Web</option><option value="whatsapp">WhatsApp</option><option value="manual">Manual / phone</option></select>
          </div>
          <div class="field">
            <label>Customer's request, in their own words</label>
            <textarea name="raw_text" placeholder="e.g. I need 50 mining helmets, 30 pairs of safety boots and 20 reflective jackets delivered to Kitwe next week."></textarea>
            <div class="helper-text">Veronica will extract line items, quantities and destination automatically. Anything ambiguous will be flagged for you to confirm before an RFQ can be issued.</div>
          </div>
          <div class="btn-row">
            <button type="submit" class="btn btn-primary">Create &amp; extract</button>
            <button type="button" class="btn btn-ghost" id="cancel">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  backdrop.querySelector('#cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#request-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    if (!fd.raw_text) { toast('Describe what the customer needs, or add items manually after creating the request.', 'error'); return; }
    await guarded(async () => {
      const { request } = await API.post('/requests', fd);
      toast('Request created — reviewing extraction', 'success');
      backdrop.remove();
      location.hash = `#/requests/${request.id}`;
    });
  });
}

route('/requests/:id', async ({ id }, app) => {
  const view = await shell(app, { title: 'Procurement Request', crumb: 'Pipeline' });
  const { request, items, extractions } = await guarded(() => API.get(`/requests/${id}`));
  const stepMap = { draft: 'Request', clarifying: 'Request', ready: 'Request', rfq_issued: 'RFQ', quoted: 'Customer Quotation', ordered: 'Order', cancelled: 'Request' };

  view.appendChild(h(pipelineRail(stepMap[request.status] || 'Request')));

  const latestExtraction = extractions[0] ? JSON.parse(extractions[0].extracted_json) : null;

  view.appendChild(h(`
    <div class="flex-between" style="margin-bottom:16px">
      <div>
        <div class="crumb">${esc(request.request_number)}</div>
        ${statusBadge(request.status)}
      </div>
      <div class="btn-row">
        ${request.status === 'ready' ? `<button class="btn btn-primary" id="create-rfq">Create RFQ →</button>` : ''}
      </div>
    </div>
  `));

  if (request.raw_text) {
    view.appendChild(h(`
      <div class="card" style="margin-bottom:16px">
        <h3>Original request</h3>
        <p style="color:var(--text-dim); font-style:italic">"${esc(request.raw_text)}"</p>
        <div class="helper-text">Customer: ${esc(request.customer_name)} · Channel: ${esc(request.channel)} · Destination: ${esc(request.destination || 'not specified')} · Requested delivery: ${esc(request.requested_delivery_date || 'not specified')}</div>
        ${request.ai_confidence != null ? `<div class="ai-note">Veronica extraction confidence: ${(request.ai_confidence * 100).toFixed(0)}%. ${request.ai_confidence < 0.6 ? 'Low confidence — please verify every item below before issuing an RFQ.' : ''}</div>` : ''}
      </div>
    `));
  }

  const itemsCard = h(`<div class="card"><h3>Line items</h3></div>`);
  itemsCard.appendChild(h(`
    ${items.length ? `
      <table>
        <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Status</th></tr></thead>
        <tbody>
          ${items.map((i) => `
            <tr>
              <td>${esc(i.description)}</td><td class="mono">${i.quantity}</td><td>${esc(i.unit)}</td>
              <td>${i.is_ambiguous ? `<span class="badge amber">needs review</span><div class="helper-text">${esc(i.clarification_notes || '')}</div>` : `<span class="badge patina">confirmed</span>`}</td>
            </tr>`).join('')}
        </tbody>
      </table>` : emptyState('No line items extracted.')}
  `));
  view.appendChild(itemsCard);

  if (request.status === 'clarifying') {
    view.appendChild(h(`<div class="helper-text" style="margin-top:10px">This request has ambiguous items and can't move to RFQ yet. Edit each flagged item to confirm quantity/description, or edit the item directly via the API — a full inline editor can be wired in next.</div>`));
  }

  if (request.status === 'ready') {
    view.querySelector('#create-rfq').addEventListener('click', () => openRfqModal(request));
  }
});

async function openRfqModal(request) {
  const category = ''; // left blank so all approved suppliers are suggested by default
  const { suppliers } = await guarded(() => API.get(`/rfqs/suggest-suppliers${category ? `?category=${encodeURIComponent(category)}` : ''}`));
  const backdrop = h(`
    <div class="modal-backdrop">
      <div class="modal">
        <h3>Create RFQ — ${esc(request.request_number)}</h3>
        <div class="field">
          <label>Select suppliers to invite</label>
          <div class="chip-row" id="supplier-chips">
            ${suppliers.map((s) => `<span class="chip" data-id="${s.id}">${esc(s.name)} <span class="mono" style="opacity:.6">(${s.reliability_score}/100)</span></span>`).join('') || '<span class="helper-text">No approved suppliers found — approve suppliers first.</span>'}
          </div>
        </div>
        <div class="field"><label>Response deadline</label><input type="date" id="deadline" /></div>
        <div class="btn-row">
          <button class="btn btn-primary" id="submit-rfq">Create RFQ</button>
          <button class="btn btn-ghost" id="cancel">Cancel</button>
        </div>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  const selected = new Set();
  backdrop.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => {
    const id = Number(chip.dataset.id);
    if (selected.has(id)) { selected.delete(id); chip.classList.remove('selected'); }
    else { selected.add(id); chip.classList.add('selected'); }
  }));
  backdrop.querySelector('#cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#submit-rfq').addEventListener('click', async () => {
    if (selected.size === 0) { toast('Select at least one supplier', 'error'); return; }
    await guarded(async () => {
      const deadline = backdrop.querySelector('#deadline').value;
      const { rfq } = await API.post('/rfqs', {
        procurement_request_id: request.id,
        supplier_ids: [...selected],
        response_deadline: deadline || null,
      });
      toast('RFQ created', 'success');
      backdrop.remove();
      location.hash = `#/rfqs/${rfq.id}`;
    });
  });
}

/* =========================================================================
   RFQs — list, detail with quotations + comparison
   ========================================================================= */
route('/rfqs', async (params, app) => {
  const view = await shell(app, { title: 'RFQs & Quotations', crumb: 'Pipeline' });
  const { rfqs } = await guarded(() => API.get('/rfqs'));

  const card = h(`<div class="card"></div>`);
  card.innerHTML = rfqs.length ? `
    <table>
      <thead><tr><th>RFQ #</th><th>Request</th><th>Customer</th><th>Status</th><th>Created</th></tr></thead>
      <tbody>
        ${rfqs.map((r) => `
          <tr class="clickable" data-href="#/rfqs/${r.id}">
            <td class="mono">${esc(r.rfq_number)}</td><td class="mono">${esc(r.request_number)}</td>
            <td>${esc(r.customer_name)}</td><td>${statusBadge(r.status)}</td><td class="mono">${fmtDate(r.created_at)}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : emptyState('No RFQs yet. Create one from a ready procurement request.');
  view.appendChild(card);
  wireRowClicks(view);
});

route('/rfqs/:id', async ({ id }, app) => {
  const view = await shell(app, { title: 'RFQ Detail', crumb: 'Pipeline' });
  const { rfq, items, recipients } = await guarded(() => API.get(`/rfqs/${id}`));
  const { quotations } = await guarded(() => API.get(`/rfqs/${id}/quotations`));

  const stepMap = { draft: 'RFQ', sent: 'Supplier Quotes', closed: 'Comparison', cancelled: 'RFQ' };
  view.appendChild(h(pipelineRail(quotations.some((q) => q.status === 'verified') ? 'Comparison' : (stepMap[rfq.status] || 'RFQ'))));

  view.appendChild(h(`
    <div class="flex-between" style="margin-bottom:16px">
      <div><div class="crumb">${esc(rfq.rfq_number)}</div>${statusBadge(rfq.status)}</div>
      <div class="btn-row">
        ${rfq.status === 'draft' ? `<button class="btn btn-primary" id="issue-rfq">Issue RFQ →</button>` : ''}
        ${rfq.status === 'sent' ? `<button class="btn btn-primary" id="add-quote">+ Enter supplier quotation</button>` : ''}
        ${quotations.filter((q) => q.status === 'verified').length >= 1 ? `<button class="btn" id="run-compare">Run comparison</button>` : ''}
      </div>
    </div>
  `));

  view.appendChild(h(`
    <div class="card" style="margin-bottom:16px">
      <h3>Requested items</h3>
      <table>
        <thead><tr><th>Description</th><th>Qty</th><th>Unit</th></tr></thead>
        <tbody>${items.map((i) => `<tr><td>${esc(i.description)}</td><td class="mono">${i.quantity}</td><td>${esc(i.unit)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  `));

  view.appendChild(h(`
    <div class="card" style="margin-bottom:16px">
      <h3>Recipients</h3>
      ${recipients.length ? `
        <table>
          <thead><tr><th>Supplier</th><th>Reliability</th><th>Status</th></tr></thead>
          <tbody>${recipients.map((r) => `<tr><td>${esc(r.supplier_name)}</td><td class="mono">${r.reliability_score}/100</td><td>${statusBadge(r.status)}</td></tr>`).join('')}</tbody>
        </table>` : emptyState('No recipients.')}
    </div>
  `));

  const quotesCard = h(`<div class="card"><h3>Supplier quotations</h3></div>`);
  quotesCard.appendChild(h(quotations.length ? `
    <table>
      <thead><tr><th>Supplier</th><th>Total</th><th>Delivery</th><th>Terms</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${quotations.map((q) => {
          const total = q.items.reduce((s, i) => s + i.unit_price * i.quantity, 0);
          return `<tr>
            <td>${esc(q.supplier_name)}</td><td class="num">${money(total, q.currency)}</td>
            <td class="mono">${q.delivery_days ?? '—'}d</td><td>${esc(q.payment_terms || '—')}</td>
            <td>${statusBadge(q.status)}</td>
            <td>${q.status === 'received' ? `<button class="btn btn-sm btn-primary" data-verify="${q.id}">Verify</button>` : ''}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>` : emptyState('No supplier quotations entered yet.')));
  view.appendChild(quotesCard);

  const compareResultHolder = h(`<div id="compare-result"></div>`);
  view.appendChild(compareResultHolder);

  if (rfq.status === 'draft') {
    view.querySelector('#issue-rfq').addEventListener('click', async () => {
      await guarded(async () => { await API.post(`/rfqs/${id}/issue`); toast('RFQ issued to suppliers', 'success'); render(); });
    });
  }
  if (rfq.status === 'sent') {
    view.querySelector('#add-quote')?.addEventListener('click', () => openQuotationModal(rfq, items, recipients));
  }
  view.querySelectorAll('[data-verify]').forEach((btn) => btn.addEventListener('click', async () => {
    await guarded(async () => { await API.post(`/quotations/${btn.dataset.verify}/verify`); toast('Quotation verified', 'success'); render(); });
  }));
  view.querySelector('#run-compare')?.addEventListener('click', async () => {
    await guarded(async () => {
      const result = await API.post(`/rfqs/${id}/compare`, {});
      renderComparison(compareResultHolder, result);
    });
  });
});

function renderComparison(holder, result) {
  holder.innerHTML = `
    <div class="card" style="margin-top:16px; border-color: var(--copper)">
      <h3>Comparison result</h3>
      <p style="color:var(--text-dim)">${esc(result.explanation)}</p>
      <table>
        <thead><tr><th>Supplier</th><th>Total</th><th>Delivery</th><th>Reliability</th><th>Score</th><th></th></tr></thead>
        <tbody>
          ${result.ranking.map((r) => `
            <tr>
              <td>${esc(r.supplier_name)} ${r.supplier_quotation_id === result.recommended_supplier_quotation_id ? '<span class="badge copper">recommended</span>' : ''}</td>
              <td class="num">${money(r.total, r.currency)}</td><td class="mono">${r.delivery_days ?? '—'}d</td>
              <td class="mono">${r.reliability_score}/100</td><td class="mono">${r.overall_score}</td>
              <td>${r.supplier_quotation_id === result.recommended_supplier_quotation_id ? `<button class="btn btn-sm btn-primary" id="gen-cq" data-sqid="${r.supplier_quotation_id}">Generate customer quotation →</button>` : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
  holder.querySelector('#gen-cq')?.addEventListener('click', (e) => openCustomerQuotationModal(e.target.dataset.sqid));
}

function openQuotationModal(rfq, rfqItems, recipients) {
  const backdrop = h(`
    <div class="modal-backdrop">
      <div class="modal">
        <h3>Enter supplier quotation</h3>
        <form id="quote-form">
          <div class="field">
            <label>Supplier *</label>
            <select name="supplier_id" required>${recipients.map((r) => `<option value="${r.supplier_id}">${esc(r.supplier_name)}</option>`).join('')}</select>
          </div>
          <div class="form-grid">
            <div class="field"><label>Currency</label><input name="currency" value="ZMW" /></div>
            <div class="field"><label>Delivery (days)</label><input name="delivery_days" type="number" min="0" /></div>
            <div class="field"><label>Payment terms</label><input name="payment_terms" placeholder="e.g. 30 days" /></div>
            <div class="field"><label>Validity date</label><input name="validity_date" type="date" /></div>
          </div>
          <div class="section-title">Line item prices</div>
          <div class="stack" id="quote-items">
            ${rfqItems.map((i) => `
              <div class="form-grid" data-item-id="${i.id}">
                <div class="field" style="grid-column:1/3"><label>${esc(i.description)} — qty ${i.quantity} ${esc(i.unit)}</label>
                  <input type="number" step="0.01" min="0" name="price_${i.id}" placeholder="Unit price *" required /></div>
              </div>`).join('')}
          </div>
          <div class="btn-row" style="margin-top:6px">
            <button type="submit" class="btn btn-primary">Save quotation</button>
            <button type="button" class="btn btn-ghost" id="cancel">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  backdrop.querySelector('#cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#quote-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const items = rfqItems.map((i) => ({
      rfq_item_id: i.id, description: i.description, quantity: i.quantity, unit: i.unit,
      unit_price: Number(fd.get(`price_${i.id}`)),
    }));
    await guarded(async () => {
      await API.post(`/rfqs/${rfq.id}/quotations`, {
        supplier_id: Number(fd.get('supplier_id')), currency: fd.get('currency'),
        delivery_days: fd.get('delivery_days') ? Number(fd.get('delivery_days')) : null,
        payment_terms: fd.get('payment_terms') || null, validity_date: fd.get('validity_date') || null,
        items,
      });
      toast('Supplier quotation recorded', 'success');
      backdrop.remove();
      render();
    });
  });
}

async function openCustomerQuotationModal(supplierQuotationId) {
  const backdrop = h(`
    <div class="modal-backdrop">
      <div class="modal">
        <h3>Generate customer quotation</h3>
        <p class="helper-text">Margin is applied automatically from the configured rule. If it falls below the commercial floor, this quotation will require approval before it can be sent.</p>
        <form id="cq-form">
          <div class="form-grid">
            <div class="field"><label>Margin rule</label><input name="margin_rule" placeholder="percentage:12 (leave blank for default)" /></div>
            <div class="field"><label>Tax rate (%)</label><input name="tax_rate_pct" type="number" step="0.1" value="0" /></div>
            <div class="field"><label>Delivery charge</label><input name="delivery_charge" type="number" step="0.01" value="0" /></div>
            <div class="field"><label>Discount amount</label><input name="discount_amount" type="number" step="0.01" value="0" /></div>
            <div class="field"><label>Payment terms</label><input name="payment_terms" placeholder="e.g. 50% deposit, balance on delivery" /></div>
            <div class="field"><label>Delivery estimate</label><input name="delivery_estimate" placeholder="e.g. 10 business days" /></div>
          </div>
          <div class="btn-row">
            <button type="submit" class="btn btn-primary">Generate</button>
            <button type="button" class="btn btn-ghost" id="cancel">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  `);
  document.body.appendChild(backdrop);
  backdrop.querySelector('#cancel').addEventListener('click', () => backdrop.remove());
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('#cq-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const payload = {
      supplier_quotation_id: Number(supplierQuotationId),
      margin_rule: fd.margin_rule || undefined,
      tax_rate_pct: Number(fd.tax_rate_pct || 0),
      delivery_charge: Number(fd.delivery_charge || 0),
      discount_amount: Number(fd.discount_amount || 0),
      payment_terms: fd.payment_terms || undefined,
      delivery_estimate: fd.delivery_estimate || undefined,
    };
    await guarded(async () => {
      const { quotation } = await API.post('/customer-quotations', payload);
      toast('Customer quotation generated', 'success');
      backdrop.remove();
      location.hash = `#/quotations/${quotation.id}`;
    });
  });
}

/* =========================================================================
   CUSTOMER QUOTATIONS
   ========================================================================= */
route('/quotations', async (params, app) => {
  const view = await shell(app, { title: 'Customer Quotations', crumb: 'Pipeline' });
  const { quotations } = await guarded(() => API.get('/customer-quotations'));

  const card = h(`<div class="card"></div>`);
  card.innerHTML = quotations.length ? `
    <table>
      <thead><tr><th>Number</th><th>Customer</th><th>Total</th><th>Status</th><th>Created</th></tr></thead>
      <tbody>
        ${quotations.map((q) => `
          <tr class="clickable" data-href="#/quotations/${q.id}">
            <td class="mono">${esc(q.quotation_number)}</td><td>${esc(q.customer_name)}</td>
            <td class="num">${money(q.grand_total, q.currency)}</td><td>${statusBadge(q.status)}</td><td class="mono">${fmtDate(q.created_at)}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : emptyState('No customer quotations generated yet — these come from comparing supplier quotations on an RFQ.');
  view.appendChild(card);
  wireRowClicks(view);
});

route('/quotations/:id', async ({ id }, app) => {
  const view = await shell(app, { title: 'Customer Quotation', crumb: 'Pipeline' });
  const { quotation, items } = await guarded(() => API.get(`/customer-quotations/${id}`));

  const stepMap = { draft: 'Customer Quotation', pending_approval: 'Customer Quotation', approved: 'Customer Quotation', sent: 'Customer Quotation', accepted: 'Order', rejected: 'Customer Quotation' };
  view.appendChild(h(pipelineRail(stepMap[quotation.status] || 'Customer Quotation')));

  view.appendChild(h(`
    <div class="flex-between" style="margin-bottom:16px">
      <div><div class="crumb">${esc(quotation.quotation_number)}</div>${statusBadge(quotation.status)}</div>
      <div class="btn-row">
        ${quotation.status === 'pending_approval' ? `<button class="btn btn-primary" id="approve-cq">Approve</button>` : ''}
        ${quotation.status === 'draft' ? `<button class="btn btn-primary" id="send-cq">Mark sent to customer</button>` : ''}
        ${quotation.status === 'sent' ? `<button class="btn btn-primary" id="accept-cq">Record: accepted</button><button class="btn btn-danger" id="reject-cq">Record: rejected</button>` : ''}
        ${quotation.status === 'accepted' ? `<button class="btn btn-primary" id="create-order">Create order →</button>` : ''}
        <button class="btn" onclick="window.print()">Print / Save PDF</button>
      </div>
    </div>
  `));

  view.appendChild(h(`
    <div class="doc">
      <div class="doc-head">
        <div><h2>Veyrona</h2><div style="color:#666">Quotation ${esc(quotation.quotation_number)}</div></div>
        <div style="text-align:right; color:#444; font-size:13px">
          <div><strong>${esc(quotation.customer_name)}</strong></div>
          <div>${esc(quotation.delivery_address || '')}</div>
          <div>${esc(quotation.customer_email || '')}</div>
        </div>
      </div>
      <table>
        <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Unit price</th><th>Line total</th></tr></thead>
        <tbody>
          ${items.map((i) => `<tr><td>${esc(i.description)}</td><td>${i.quantity}</td><td>${esc(i.unit)}</td><td>${money(i.unit_price, quotation.currency)}</td><td>${money(i.line_total, quotation.currency)}</td></tr>`).join('')}
        </tbody>
      </table>
      <div class="totals">
        <div><span>Subtotal (incl. margin)</span><span>${money(quotation.subtotal, quotation.currency)}</span></div>
        <div><span>Tax</span><span>${money(quotation.tax_amount, quotation.currency)}</span></div>
        <div><span>Delivery</span><span>${money(quotation.delivery_charge, quotation.currency)}</span></div>
        <div><span>Discount</span><span>-${money(quotation.discount_amount, quotation.currency)}</span></div>
        <div class="grand"><span>Grand total</span><span>${money(quotation.grand_total, quotation.currency)}</span></div>
      </div>
      <div style="margin-top:24px; font-size:12.5px; color:#555">
        <div><strong>Payment terms:</strong> ${esc(quotation.payment_terms || 'To be confirmed')}</div>
        <div><strong>Delivery estimate:</strong> ${esc(quotation.delivery_estimate || 'To be confirmed')}</div>
        <div><strong>Valid until:</strong> ${esc(quotation.validity_date || 'To be confirmed')}</div>
      </div>
    </div>
  `));

  view.querySelector('#approve-cq')?.addEventListener('click', async () => {
    await guarded(async () => { await API.post(`/customer-quotations/${id}/approve`); toast('Quotation approved', 'success'); render(); });
  });
  view.querySelector('#send-cq')?.addEventListener('click', async () => {
    await guarded(async () => { await API.post(`/customer-quotations/${id}/send`); toast('Marked as sent', 'success'); render(); });
  });
  view.querySelector('#accept-cq')?.addEventListener('click', async () => {
    await guarded(async () => { await API.post(`/customer-quotations/${id}/decision`, { decision: 'accepted' }); toast('Customer decision recorded: accepted', 'success'); render(); });
  });
  view.querySelector('#reject-cq')?.addEventListener('click', async () => {
    await guarded(async () => { await API.post(`/customer-quotations/${id}/decision`, { decision: 'rejected' }); toast('Customer decision recorded: rejected', 'success'); render(); });
  });
  view.querySelector('#create-order')?.addEventListener('click', async () => {
    await guarded(async () => {
      const { order } = await API.post('/orders', { customer_quotation_id: Number(id) });
      toast('Order created', 'success');
      location.hash = `#/orders/${order.id}`;
    });
  });
});

/* =========================================================================
   ORDERS
   ========================================================================= */
route('/orders', async (params, app) => {
  const view = await shell(app, { title: 'Orders', crumb: 'Pipeline' });
  const { orders } = await guarded(() => API.get('/orders'));

  const card = h(`<div class="card"></div>`);
  card.innerHTML = orders.length ? `
    <table>
      <thead><tr><th>Order #</th><th>Customer</th><th>Supplier</th><th>Total</th><th>Status</th></tr></thead>
      <tbody>
        ${orders.map((o) => `
          <tr class="clickable" data-href="#/orders/${o.id}">
            <td class="mono">${esc(o.order_number)}</td><td>${esc(o.customer_name)}</td><td>${esc(o.supplier_name || '—')}</td>
            <td class="num">${money(o.grand_total, o.currency)}</td><td>${statusBadge(o.status)}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : emptyState('No orders yet.');
  view.appendChild(card);
  wireRowClicks(view);
});

route('/orders/:id', async ({ id }, app) => {
  const view = await shell(app, { title: 'Order', crumb: 'Pipeline' });
  const { order, items, delivery } = await guarded(() => API.get(`/orders/${id}`));

  view.appendChild(h(pipelineRail('Order')));

  const ORDER_STATUSES = ['created', 'confirmed', 'in_fulfilment', 'delivered', 'closed', 'cancelled'];
  view.appendChild(h(`
    <div class="flex-between" style="margin-bottom:16px">
      <div><div class="crumb">${esc(order.order_number)}</div>${statusBadge(order.status)}</div>
      <div class="btn-row">
        <select id="status-select">${ORDER_STATUSES.map((s) => `<option value="${s}" ${s === order.status ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select>
        <button class="btn btn-primary" id="update-status">Update status</button>
      </div>
    </div>
  `));

  view.appendChild(h(`
    <div class="grid grid-2">
      <div class="card">
        <h3>Items</h3>
        <table><thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead>
          <tbody>${items.map((i) => `<tr><td>${esc(i.description)}</td><td class="mono">${i.quantity} ${esc(i.unit)}</td><td class="num">${money(i.unit_price, order.currency)}</td><td class="num">${money(i.line_total, order.currency)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
      <div class="card">
        <h3>Delivery</h3>
        ${delivery ? `
          <ul class="subtle-list">
            <li>Status — ${statusBadge(delivery.status)}</li>
            <li>Estimated date — ${esc(delivery.estimated_date || '—')}</li>
            <li>Actual date — ${esc(delivery.actual_date || '—')}</li>
            <li>Tracking ref — ${esc(delivery.tracking_ref || '—')}</li>
          </ul>` : emptyState('No delivery record.')}
      </div>
    </div>
  `));

  view.querySelector('#update-status').addEventListener('click', async () => {
    const status = view.querySelector('#status-select').value;
    await guarded(async () => { await API.put(`/orders/${id}/status`, { status }); toast('Order status updated', 'success'); render(); });
  });
});

/* =========================================================================
   AUDIT LOG
   ========================================================================= */
route('/audit', async (params, app) => {
  const view = await shell(app, { title: 'Audit Log', crumb: 'Governance' });
  const { logs } = await guarded(() => API.get('/audit-logs?limit=150'));

  view.appendChild(h(`<div class="helper-text" style="margin-bottom:14px">Every financial, supplier, permission and AI-triggered action is recorded here for traceability.</div>`));
  const card = h(`<div class="card"></div>`);
  card.innerHTML = logs.length ? `
    <table>
      <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th></tr></thead>
      <tbody>
        ${logs.map((l) => `
          <tr>
            <td class="mono">${fmtDate(l.created_at)}</td>
            <td><span class="badge ${l.actor_type === 'ai' ? 'amber' : ''}">${esc(l.actor_type)}${l.actor_id ? ' #' + esc(l.actor_id) : ''}</span></td>
            <td class="mono">${esc(l.action)}</td>
            <td>${esc(l.entity_type || '—')} ${l.entity_id ? '#' + l.entity_id : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table>` : emptyState('No audit entries yet.');
  view.appendChild(card);
});

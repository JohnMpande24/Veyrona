'use strict';

async function loadCustomerPortal(app) {
  const view = await shell(app, { title: 'Customer Portal', crumb: 'Customer' });
  const data = await guarded(() => API.get('/customers/me'));
  const c = data.customer;

  view.innerHTML = `
    <div class="grid-3">
      <div class="card"><div class="eyebrow">Company</div><h2>${esc(c.company || c.name)}</h2><p>${esc(c.email || '')}</p></div>
      <div class="card"><div class="eyebrow">Status</div><h2>${statusBadge(c.status)}</h2><p>Customer account</p></div>
      <div class="card"><div class="eyebrow">Language</div><h2>${esc(c.preferred_language === 'fr' ? 'Français' : 'English')}</h2><p>Preferred language</p></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="eyebrow">Your account</div><h2>Customer profile</h2>
      <div class="table-wrap"><table><tbody>
        <tr><th>Name</th><td>${esc(c.name)}</td></tr>
        <tr><th>Email</th><td>${esc(c.email || '—')}</td></tr>
        <tr><th>Phone</th><td>${esc(c.phone || '—')}</td></tr>
        <tr><th>WhatsApp</th><td>${esc(c.whatsapp_number || '—')}</td></tr>
        <tr><th>Delivery address</th><td>${esc(c.delivery_address || '—')}</td></tr>
      </tbody></table></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="eyebrow">Procurement workspace</div>
      <h2>Connected to your database account</h2>
      <p>RFQs, quotations and orders can now be scoped to this customer as those workflows are connected.</p>
    </div>`;
}

async function loadSupplierPortal(app) {
  const view = await shell(app, { title: 'Supplier Portal', crumb: 'Supplier' });
  const data = await guarded(() => API.get('/suppliers/me'));
  const s = data.supplier;

  view.innerHTML = `
    <div class="grid-3">
      <div class="card"><div class="eyebrow">Supplier</div><h2>${esc(s.name)}</h2><p>${esc(s.category || 'Supplier')}</p></div>
      <div class="card"><div class="eyebrow">Approval</div><h2>${statusBadge(s.status)}</h2><p>Account status</p></div>
      <div class="card"><div class="eyebrow">Reliability</div><h2>${Number(s.reliability_score || 0).toFixed(0)}%</h2><p>Current score</p></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="eyebrow">Your account</div><h2>Supplier profile</h2>
      <div class="table-wrap"><table><tbody>
        <tr><th>Name</th><td>${esc(s.name)}</td></tr>
        <tr><th>Email</th><td>${esc(s.email || '—')}</td></tr>
        <tr><th>Phone</th><td>${esc(s.phone || '—')}</td></tr>
        <tr><th>WhatsApp</th><td>${esc(s.whatsapp_number || '—')}</td></tr>
        <tr><th>Location</th><td>${esc(s.location || '—')}</td></tr>
        <tr><th>Country</th><td>${esc(s.country || '—')}</td></tr>
      </tbody></table></div>
    </div>
    <div class="card" style="margin-top:16px">
      <div class="eyebrow">Products</div><h2>${data.products.length} product${data.products.length === 1 ? '' : 's'} linked</h2>
      ${data.products.length ? `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Typical price</th><th>Lead time</th></tr></thead><tbody>
      ${data.products.map(p => `<tr><td>${esc(p.product_name)}</td><td>${money(p.typical_price, p.currency)}</td><td>${p.lead_time_days == null ? '—' : esc(p.lead_time_days + ' days')}</td></tr>`).join('')}
      </tbody></table></div>` : '<p>No products are linked to this supplier yet.</p>'}
    </div>`;
}

route('/customer-portal', async (params, app) => {
  if (API.user?.role !== 'customer') { location.hash = '#/dashboard'; return; }
  await loadCustomerPortal(app);
});

route('/supplier-portal', async (params, app) => {
  if (API.user?.role !== 'supplier') { location.hash = '#/dashboard'; return; }
  await loadSupplierPortal(app);
});

function redirectPortalUser() {
  if (!API.token || !API.user || location.hash !== '#/dashboard') return;
  if (API.user.role === 'customer') location.hash = '#/customer-portal';
  if (API.user.role === 'supplier') location.hash = '#/supplier-portal';
}
window.addEventListener('hashchange', redirectPortalUser);
window.addEventListener('DOMContentLoaded', redirectPortalUser);
setTimeout(redirectPortalUser, 0);

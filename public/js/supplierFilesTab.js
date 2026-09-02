// public/js/supplierFilesTab.js
//
// Renders the "Documents & Catalogue" tab in the supplier dashboard.
// No build step, no frameworks — matches the rest of Veyrona's frontend.
//
// Usage: call renderSupplierFilesTab(container, supplierId) after the
// tab is selected. Depends on a global `apiFetch` helper if you have
// one; falls back to plain fetch() with credentials included.

const FILE_CATEGORIES = [
  { value: 'catalogue', label: 'Product Catalogue' },
  { value: 'company_registration', label: 'Company Registration' },
  { value: 'certification', label: 'Certifications' },
  { value: 'tax_clearance', label: 'Tax Clearance' },
  { value: 'bank_details', label: 'Bank Details' },
  { value: 'other', label: 'Other' },
];

const STATUS_LABELS = {
  pending_review: { text: 'Pending Review', className: 'badge-pending' },
  approved: { text: 'Approved', className: 'badge-approved' },
  rejected: { text: 'Rejected', className: 'badge-rejected' },
};

async function apiCall(url, options = {}) {
  const res = await fetch(url, { credentials: 'include', ...options });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

function formatBytes(bytes) {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-ZM', { year: 'numeric', month: 'short', day: 'numeric' });
}

export async function renderSupplierFilesTab(container, supplierId) {
  container.innerHTML = `
    <div class="supplier-files-tab">
      <style>
        .supplier-files-tab { font-family: inherit; color: #2b2b2b; }
        .sft-upload-card {
          background: #f4f1ec;
          border: 1px solid #c98a4b33;
          border-left: 4px solid #b5651d;
          border-radius: 6px;
          padding: 20px;
          margin-bottom: 24px;
        }
        .sft-upload-card h3 { margin: 0 0 12px; color: #3a3a3a; font-size: 16px; }
        .sft-form-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 10px; }
        .sft-form-row select, .sft-form-row input[type="file"] {
          padding: 8px 10px; border: 1px solid #ccc; border-radius: 4px; background: #fff;
        }
        .sft-btn {
          background: #b5651d; color: #fff; border: none; border-radius: 4px;
          padding: 9px 18px; font-weight: 600; cursor: pointer;
        }
        .sft-btn:disabled { background: #999; cursor: not-allowed; }
        .sft-btn:hover:not(:disabled) { background: #954f14; }
        .sft-progress { font-size: 13px; color: #555; margin-top: 6px; }
        .sft-error { color: #b3261e; font-size: 13px; margin-top: 6px; }
        .sft-section-title { font-size: 15px; font-weight: 700; color: #3a3a3a; margin: 20px 0 10px; }
        table.sft-table { width: 100%; border-collapse: collapse; background: #fff; }
        table.sft-table th, table.sft-table td {
          text-align: left; padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 14px;
        }
        table.sft-table th { color: #777; font-weight: 600; font-size: 12px; text-transform: uppercase; }
        .sft-link { color: #b5651d; text-decoration: none; font-weight: 600; cursor: pointer; }
        .sft-link:hover { text-decoration: underline; }
        .sft-delete { color: #b3261e; cursor: pointer; font-weight: 600; margin-left: 12px; }
        .sft-badge {
          display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;
        }
        .badge-pending { background: #fff3cd; color: #8a6516; }
        .badge-approved { background: #d9f2df; color: #1e7b34; }
        .badge-rejected { background: #fbdada; color: #a3241a; }
        .sft-empty { color: #888; font-size: 14px; padding: 16px 0; }
      </style>

      <div class="sft-upload-card">
        <h3>Upload a file</h3>
        <div class="sft-form-row">
          <select id="sft-category">
            ${FILE_CATEGORIES.map((c) => `<option value="${c.value}">${c.label}</option>`).join('')}
          </select>
          <input type="file" id="sft-file-input"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg" />
          <button class="sft-btn" id="sft-upload-btn">Upload</button>
        </div>
        <div class="sft-progress" id="sft-progress"></div>
        <div class="sft-error" id="sft-error"></div>
      </div>

      <div class="sft-section-title">Product Catalogue</div>
      <div id="sft-catalogue-list"></div>

      <div class="sft-section-title">Company Documents</div>
      <div id="sft-documents-list"></div>
    </div>
  `;

  const catalogueListEl = container.querySelector('#sft-catalogue-list');
  const documentsListEl = container.querySelector('#sft-documents-list');
  const errorEl = container.querySelector('#sft-error');
  const progressEl = container.querySelector('#sft-progress');
  const uploadBtn = container.querySelector('#sft-upload-btn');

  function renderTable(el, files) {
    if (!files.length) {
      el.innerHTML = `<div class="sft-empty">No files uploaded yet.</div>`;
      return;
    }
    el.innerHTML = `
      <table class="sft-table">
        <thead>
          <tr><th>File</th><th>Category</th><th>Size</th><th>Uploaded</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          ${files
            .map((f) => {
              const status = STATUS_LABELS[f.status] || STATUS_LABELS.pending_review;
              const catLabel = FILE_CATEGORIES.find((c) => c.value === f.file_category)?.label || f.file_category;
              return `
                <tr data-id="${f.id}">
                  <td><span class="sft-link" data-action="download" data-id="${f.id}">${f.original_filename}</span></td>
                  <td>${catLabel}</td>
                  <td>${formatBytes(f.file_size_bytes)}</td>
                  <td>${formatDate(f.created_at)}</td>
                  <td><span class="sft-badge ${status.className}">${status.text}</span></td>
                  <td><span class="sft-delete" data-action="delete" data-id="${f.id}">Remove</span></td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    `;
  }

  async function loadFiles() {
    try {
      const all = await apiCall(`/api/suppliers/${supplierId}/files`);
      renderTable(
        catalogueListEl,
        all.filter((f) => f.file_category === 'catalogue')
      );
      renderTable(
        documentsListEl,
        all.filter((f) => f.file_category !== 'catalogue')
      );
    } catch (err) {
      errorEl.textContent = err.message;
    }
  }

  async function handleUpload() {
    errorEl.textContent = '';
    const fileInput = container.querySelector('#sft-file-input');
    const category = container.querySelector('#sft-category').value;
    const file = fileInput.files[0];
    if (!file) {
      errorEl.textContent = 'Choose a file first.';
      return;
    }
    uploadBtn.disabled = true;
    progressEl.textContent = 'Requesting upload link…';

    try {
      const { uploadUrl, objectKey } = await apiCall(`/api/suppliers/${supplierId}/files/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          fileSizeBytes: file.size,
          category,
        }),
      });

      progressEl.textContent = 'Uploading…';
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error('Upload to storage failed');

      progressEl.textContent = 'Saving record…';
      await apiCall(`/api/suppliers/${supplierId}/files/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          objectKey,
          filename: file.name,
          contentType: file.type,
          fileSizeBytes: file.size,
          category,
        }),
      });

      progressEl.textContent = 'Uploaded successfully.';
      fileInput.value = '';
      await loadFiles();
    } catch (err) {
      errorEl.textContent = err.message;
      progressEl.textContent = '';
    } finally {
      uploadBtn.disabled = false;
      setTimeout(() => (progressEl.textContent = ''), 3000);
    }
  }

  async function handleTableClick(e) {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const fileId = target.dataset.id;

    if (target.dataset.action === 'download') {
      try {
        const { downloadUrl } = await apiCall(`/api/suppliers/${supplierId}/files/${fileId}/download`);
        window.open(downloadUrl, '_blank');
      } catch (err) {
        errorEl.textContent = err.message;
      }
    }

    if (target.dataset.action === 'delete') {
      if (!confirm('Remove this file?')) return;
      try {
        await apiCall(`/api/suppliers/${supplierId}/files/${fileId}`, { method: 'DELETE' });
        await loadFiles();
      } catch (err) {
        errorEl.textContent = err.message;
      }
    }
  }

  uploadBtn.addEventListener('click', handleUpload);
  catalogueListEl.addEventListener('click', handleTableClick);
  documentsListEl.addEventListener('click', handleTableClick);

  await loadFiles();
}

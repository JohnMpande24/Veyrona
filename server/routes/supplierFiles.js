// server/routes/supplierFiles.js
//
// Endpoints for supplier company files + catalogue uploads.
// Adjust the top three lines to match how your project wires up
// the db facade, session/auth middleware, and router — this file
// assumes the patterns already used elsewhere in Veyrona
// (server/db/db.js facade, req.user set by auth middleware).

const express = require('express');
const router = express.Router();
const db = require('../db/db'); // existing db facade (SQLite local / Postgres on Vercel)
const storage = require('../services/storage');

const ALLOWED_CATEGORIES = [
  'company_registration',
  'certification',
  'tax_clearance',
  'bank_details',
  'catalogue',
  'other',
];

const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png',
  'image/jpeg',
];

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

// Middleware: only the supplier themself (or an admin) can touch these files.
// Assumes req.user = { id, role, supplierId } set by your auth middleware.
function requireSupplierOrAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const { role, supplierId } = req.user;
  const targetSupplierId = Number(req.params.supplierId);
  if (role === 'admin' || (role === 'supplier' && supplierId === targetSupplierId)) {
    return next();
  }
  return res.status(403).json({ error: 'Not authorized for this supplier' });
}

/**
 * STEP 1 of upload: client asks for a presigned upload URL.
 * POST /api/suppliers/:supplierId/files/presign
 * body: { filename, contentType, fileSizeBytes, category }
 */
router.post('/:supplierId/files/presign', requireSupplierOrAdmin, async (req, res) => {
  try {
    const { filename, contentType, fileSizeBytes, category } = req.body;
    const supplierId = Number(req.params.supplierId);

    if (!filename || !contentType || !category) {
      return res.status(400).json({ error: 'filename, contentType and category are required' });
    }
    if (!ALLOWED_CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `category must be one of: ${ALLOWED_CATEGORIES.join(', ')}` });
    }
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      return res.status(400).json({ error: 'Unsupported file type. Use PDF, Word, Excel, or an image.' });
    }
    if (fileSizeBytes && fileSizeBytes > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({ error: 'File exceeds 25 MB limit' });
    }

    const objectKey = storage.buildObjectKey(supplierId, category, filename);
    const uploadUrl = await storage.getUploadUrl(objectKey, contentType);

    res.json({ uploadUrl, objectKey });
  } catch (err) {
    console.error('presign error', err);
    res.status(500).json({ error: 'Could not create upload URL' });
  }
});

/**
 * STEP 2 of upload: after the browser PUTs the file directly to storage,
 * it calls this to record the upload in the database.
 * POST /api/suppliers/:supplierId/files/confirm
 * body: { objectKey, filename, contentType, fileSizeBytes, category }
 */
router.post('/:supplierId/files/confirm', requireSupplierOrAdmin, async (req, res) => {
  try {
    const supplierId = Number(req.params.supplierId);
    const { objectKey, filename, contentType, fileSizeBytes, category } = req.body;

    if (!objectKey || !filename || !category) {
      return res.status(400).json({ error: 'objectKey, filename and category are required' });
    }

    const row = await db.run(
      `INSERT INTO supplier_files
        (supplier_id, file_category, original_filename, storage_key, content_type, file_size_bytes, uploaded_by, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_review', ?)
       RETURNING *`,
      [supplierId, category, filename, objectKey, contentType || null, fileSizeBytes || null, req.user.id, new Date().toISOString()]
    );

    // Audit log — reuse existing audit_logs table/pattern
    await db.run(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, 'supplier_file_uploaded', 'supplier_files', ?, ?, ?)`,
      [req.user.id, row.id, JSON.stringify({ supplierId, category, filename }), new Date().toISOString()]
    );

    res.status(201).json(row);
  } catch (err) {
    console.error('confirm upload error', err);
    res.status(500).json({ error: 'Could not save file record' });
  }
});

/**
 * List a supplier's files, optionally filtered by category.
 * GET /api/suppliers/:supplierId/files?category=catalogue
 */
router.get('/:supplierId/files', requireSupplierOrAdmin, async (req, res) => {
  try {
    const supplierId = Number(req.params.supplierId);
    const { category } = req.query;

    const files = category
      ? await db.all(`SELECT * FROM supplier_files WHERE supplier_id = ? AND file_category = ? ORDER BY created_at DESC`, [supplierId, category])
      : await db.all(`SELECT * FROM supplier_files WHERE supplier_id = ? ORDER BY created_at DESC`, [supplierId]);

    res.json(files);
  } catch (err) {
    console.error('list files error', err);
    res.status(500).json({ error: 'Could not list files' });
  }
});

/**
 * Get a short-lived download URL for a specific file.
 * GET /api/suppliers/:supplierId/files/:fileId/download
 */
router.get('/:supplierId/files/:fileId/download', requireSupplierOrAdmin, async (req, res) => {
  try {
    const { fileId, supplierId } = req.params;
    const file = await db.get(`SELECT * FROM supplier_files WHERE id = ? AND supplier_id = ?`, [fileId, supplierId]);
    if (!file) return res.status(404).json({ error: 'File not found' });

    const url = await storage.getDownloadUrl(file.storage_key);
    res.json({ downloadUrl: url, filename: file.original_filename });
  } catch (err) {
    console.error('download url error', err);
    res.status(500).json({ error: 'Could not generate download link' });
  }
});

/**
 * Delete a file (supplier can delete their own pending uploads; admin can delete any).
 * DELETE /api/suppliers/:supplierId/files/:fileId
 */
router.delete('/:supplierId/files/:fileId', requireSupplierOrAdmin, async (req, res) => {
  try {
    const { fileId, supplierId } = req.params;
    const file = await db.get(`SELECT * FROM supplier_files WHERE id = ? AND supplier_id = ?`, [fileId, supplierId]);
    if (!file) return res.status(404).json({ error: 'File not found' });

    if (req.user.role === 'supplier' && file.status === 'approved') {
      return res.status(403).json({ error: 'Cannot delete an approved file. Contact an administrator.' });
    }

    await storage.deleteObject(file.storage_key);
    await db.run(`DELETE FROM supplier_files WHERE id = ?`, [fileId]);

    await db.run(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, 'supplier_file_deleted', 'supplier_files', ?, ?, ?)`,
      [req.user.id, fileId, JSON.stringify({ supplierId, filename: file.original_filename }), new Date().toISOString()]
    );

    res.status(204).end();
  } catch (err) {
    console.error('delete file error', err);
    res.status(500).json({ error: 'Could not delete file' });
  }
});

/**
 * Admin-only: approve or reject an uploaded file.
 * PATCH /api/suppliers/:supplierId/files/:fileId/review
 * body: { status: 'approved' | 'rejected', notes? }
 */
router.patch('/:supplierId/files/:fileId/review', async (req, res) => {
  try {
    if (!req.user || req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    const { fileId } = req.params;
    const { status, notes } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: "status must be 'approved' or 'rejected'" });
    }

    const row = await db.run(
      `UPDATE supplier_files SET status = ?, notes = ? WHERE id = ? RETURNING *`,
      [status, notes || null, fileId]
    );

    await db.run(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details, created_at)
       VALUES (?, 'supplier_file_reviewed', 'supplier_files', ?, ?, ?)`,
      [req.user.id, fileId, JSON.stringify({ status, notes }), new Date().toISOString()]
    );

    res.json(row);
  } catch (err) {
    console.error('review file error', err);
    res.status(500).json({ error: 'Could not update review status' });
  }
});

module.exports = router;

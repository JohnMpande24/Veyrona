// server/services/storage.js
//
// Thin wrapper around Neon Object Storage (S3-compatible).
// Neon Object Storage docs: https://neon.com/docs/storage/overview
//
// Required env vars (get these from `neon env pull --file .env.local`,
// or create a scoped credential via the Neon API/Console — see
// https://neon.com/docs/storage/authentication):
//
//   AWS_ENDPOINT_URL_S3   e.g. https://br-xxxx.storage.c-1.us-east-2.aws.neon.tech
//   AWS_ACCESS_KEY_ID     token_id from the storage credential
//   AWS_SECRET_ACCESS_KEY s3_secret_access_key from the storage credential
//   AWS_REGION            e.g. us-east-2
//   SUPPLIER_FILES_BUCKET defaults to 'supplier-files' (already created)
//
// Requires: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const BUCKET = process.env.SUPPLIER_FILES_BUCKET || 'supplier-files';

const s3 = new S3Client({
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true, // required for Neon's custom S3 endpoint
});

/**
 * Generate a presigned URL the browser can PUT the file bytes to directly.
 * The server never touches the file contents — only the URL.
 */
async function getUploadUrl(objectKey, contentType, expiresInSeconds = 900) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: objectKey,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

/**
 * Generate a presigned URL to download/view a stored file.
 */
async function getDownloadUrl(objectKey, expiresInSeconds = 900) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: objectKey,
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

async function deleteObject(objectKey) {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: objectKey,
  });
  return s3.send(command);
}

/**
 * Build a consistent, collision-resistant object key.
 * e.g. suppliers/4/catalogue/1725270000000-price-list.pdf
 */
function buildObjectKey(supplierId, category, originalFilename) {
  const safeName = originalFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `suppliers/${supplierId}/${category}/${Date.now()}-${safeName}`;
}

module.exports = {
  BUCKET,
  getUploadUrl,
  getDownloadUrl,
  deleteObject,
  buildObjectKey,
};

// Central configuration for the paths the app writes to at runtime.
//
// Why this file exists: on Render (and most PaaS platforms) the local
// filesystem is ephemeral - the SQLite database and the uploaded images are
// wiped on every redeploy and on every free-tier spin-down. Point DATA_DIR at
// a mounted Persistent Disk (Render's convention is /var/data) and both the
// database and the uploads survive restarts.
//
// Precedence for each path:
//   1. The dedicated env var (DB_PATH / UPLOAD_DIR). The test suite uses this
//      to stay isolated from the real data.
//   2. DATA_DIR (the mounted-disk convention, e.g. /var/data).
//   3. The local folder next to the project (the default for local dev).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname);
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null;

// Everything that must survive a restart lives under the data directory so a
// single mount point keeps the database and the uploads together.
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : (dataDir ? path.join(dataDir, 'photovault.sqlite') : path.join(root, 'database', 'photovault.sqlite'));

const uploadDir = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : (dataDir ? path.join(dataDir, 'uploads') : path.join(root, 'uploads'));

// The uploads folder must exist before multer writes to it.
fs.mkdirSync(uploadDir, { recursive: true });
if (dataDir) fs.mkdirSync(dataDir, { recursive: true });

module.exports = { root, dataDir, dbPath, uploadDir };

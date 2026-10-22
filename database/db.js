// sqlite3 is a native (N-API) module, so the prebuilt binary has to match the
// platform it runs on. The version is pinned to 5.1.7 on purpose: its Linux
// x64 prebuild only needs glibc 2.4 / libstdc++ 3.4.21, so it loads on Render's
// runtime image. The 6.x prebuilds were rebuilt against a newer glibc
// (GLIBC_2.38) and fail to load there with ERR_DLOPEN_FAILED.
// See README.md -> "Native module pin" before changing this version.
let sqlite3;
try {
  sqlite3 = require('sqlite3').verbose();
} catch (err) {
  if (err.code === 'ERR_DLOPEN_FAILED') {
    console.error(
      'Failed to load the native sqlite3 binary.\n' +
      '  ' + err.message + '\n' +
      '  This usually means the prebuilt binary needs a newer glibc than the\n' +
      '  host provides. Run "npm install" to fetch the prebuild again, or\n' +
      '  check that the sqlite3 version in package.json is still 5.1.7.'
    );
  }
  throw err;
}

const { dbPath } = require('../config');

// dbPath can be overridden (the automated tests use an isolated file, and
// Render deployments point it at a mounted Persistent Disk via DATA_DIR).
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) console.error('Database connection failed:', err.message);
  else if (process.env.NODE_ENV !== 'test') console.log('Connected to SQLite database at', dbPath);
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      mimetype TEXT NOT NULL,
      size INTEGER NOT NULL,
      album TEXT DEFAULT 'General',
      tags TEXT DEFAULT '',
      is_favorite INTEGER DEFAULT 0,
      is_trashed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
});

module.exports = db;

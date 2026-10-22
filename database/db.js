const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// DB_PATH can be overridden (the automated tests use an isolated file)
const dbPath = process.env.DB_PATH || path.resolve(__dirname, 'photovault.sqlite');
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

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database/db');
const { uploadDir } = require('../config');

const ALLOWED = { 'image/jpeg': ['.jpg', '.jpeg'], 'image/png': ['.png'], 'image/webp': ['.webp'], 'image/gif': ['.gif'] };

// Query strings and multipart bodies may repeat a key (?album=a&album=b), which
// Express turns into an array. Normalise to one usable string so that calling
// .trim() on user input can never blow up with a 500.
const firstValue = (value) => (Array.isArray(value) ? value[0] : value);

// Coerce any incoming value to a safe, trimmed, length-capped string.
const asText = (value, fallback = '', maxLength = 500) => {
  const raw = firstValue(value);
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw).slice(0, maxLength);
  if (typeof raw !== 'string') return fallback;
  return raw.trim().slice(0, maxLength);
};

// Escape LIKE wildcards so a search for "100%" is treated as literal text.
const escapeLike = (text) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `photo_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
  }
});

// First line of defence: declared MIME type AND file extension must agree
const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED[file.mimetype] && ALLOWED[file.mimetype].includes(ext)) return cb(null, true);
  const error = new Error('Invalid file type. Only JPEG, PNG, WEBP, and GIF are allowed.');
  error.statusCode = 400;
  cb(error, false);
};

const upload = multer({
  storage, fileFilter,
  limits: { fileSize: (Number(process.env.MAX_FILE_SIZE_MB) || 10) * 1024 * 1024 }
});

// Second line of defence: inspect the real file signature (magic bytes)
function hasValidSignature(file) {
  const buf = Buffer.alloc(12);
  const fd = fs.openSync(file.path, 'r');
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  if (file.mimetype === 'image/jpeg') return buf[0] === 0xff && buf[1] === 0xd8;
  if (file.mimetype === 'image/png') return buf.slice(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (file.mimetype === 'image/gif') return buf.slice(0, 3).toString() === 'GIF';
  if (file.mimetype === 'image/webp') return buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
  return false;
}

const notFound = (res) => res.status(404).json({ success: false, error: 'Photo not found' });
const validId = (req, res, next) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid photo id' });
  next();
};

// GET /api/photos?view=&album=&search=
router.get('/', (req, res, next) => {
  const { view = 'all', album = '', search = '' } = req.query;
  const viewParam = asText(view, 'all');
  const albumParam = asText(album);
  const searchParam = asText(search);
  let sql = 'SELECT * FROM photos WHERE ';
  const params = [];
  sql += viewParam === 'trash' ? 'is_trashed = 1' : 'is_trashed = 0';
  if (viewParam === 'favorites') sql += ' AND is_favorite = 1';
  if (albumParam) { sql += ' AND LOWER(album) = LOWER(?)'; params.push(albumParam); }
  if (searchParam) {
    sql += ` AND (LOWER(title) LIKE LOWER(?) ESCAPE '\\' OR LOWER(tags) LIKE LOWER(?) ESCAPE '\\' OR LOWER(album) LIKE LOWER(?) ESCAPE '\\')`;
    const w = `%${escapeLike(searchParam)}%`;
    params.push(w, w, w);
  }
  sql += ' ORDER BY datetime(created_at) DESC, id DESC';
  db.all(sql, params, (err, rows) => (err ? next(err) : res.json({ success: true, count: rows.length, data: rows })));
});

// GET /api/photos/stats
router.get('/stats', (req, res, next) => {
  const sql = `SELECT COALESCE(SUM(CASE WHEN is_trashed=0 THEN 1 ELSE 0 END),0) AS totalPhotos, COALESCE(SUM(CASE WHEN is_trashed=0 THEN size ELSE 0 END),0) AS totalBytes,
    COALESCE(SUM(CASE WHEN is_favorite=1 AND is_trashed=0 THEN 1 ELSE 0 END),0) AS favoritesCount,
    COALESCE(SUM(CASE WHEN is_trashed=1 THEN 1 ELSE 0 END),0) AS trashCount FROM photos`;
  db.get(sql, [], (err, stats) => {
    if (err) return next(err);
    db.all('SELECT album, COUNT(*) AS count FROM photos WHERE is_trashed = 0 GROUP BY album ORDER BY count DESC', [],
      (e2, albums) => (e2 ? next(e2) : res.json({ success: true, stats, albums })));
  });
});

// POST /api/photos
router.post('/', upload.single('image'), (req, res, next) => {
  if (!req.file) {
    const err = new Error('Please select an image file to upload.');
    err.statusCode = 400;
    return next(err);
  }
  if (!hasValidSignature(req.file)) {
    fs.unlinkSync(req.file.path);
    const err = new Error('File content does not match its image type.');
    err.statusCode = 400;
    return next(err);
  }
  const fallbackTitle = path.basename(req.file.originalname, path.extname(req.file.originalname));
  const title = asText(req.body.title) || fallbackTitle;
  const description = asText(req.body.description);
  const album = asText(req.body.album, 'General') || 'General';
  const tags = asText(req.body.tags);
  const sql = `INSERT INTO photos (title, description, filename, filepath, mimetype, size, album, tags)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(sql, [title, description, req.file.filename, `/uploads/${req.file.filename}`, req.file.mimetype, req.file.size, album, tags],
    function (err) {
      if (err) return next(err);
      db.get('SELECT * FROM photos WHERE id = ?', [this.lastID], (e2, row) =>
        e2 ? next(e2) : res.status(201).json({ success: true, message: 'Photo uploaded successfully', data: row }));
    });
});

// PATCH /api/photos/:id/favorite  (toggle)
router.patch('/:id/favorite', validId, (req, res, next) => {
  db.get('SELECT * FROM photos WHERE id = ?', [req.params.id], (err, photo) => {
    if (err) return next(err);
    if (!photo) return notFound(res);
    const v = photo.is_favorite ? 0 : 1;
    db.run('UPDATE photos SET is_favorite = ? WHERE id = ?', [v, photo.id], (e2) =>
      e2 ? next(e2) : res.json({ success: true, message: v ? 'Added to Favorites' : 'Removed from Favorites', is_favorite: v }));
  });
});

// PATCH /api/photos/:id/trash  (soft delete / restore)
router.patch('/:id/trash', validId, (req, res, next) => {
  db.get('SELECT * FROM photos WHERE id = ?', [req.params.id], (err, photo) => {
    if (err) return next(err);
    if (!photo) return notFound(res);
    const v = photo.is_trashed ? 0 : 1;
    db.run('UPDATE photos SET is_trashed = ? WHERE id = ?', [v, photo.id], (e2) =>
      e2 ? next(e2) : res.json({ success: true, message: v ? 'Moved to Trash' : 'Restored from Trash', is_trashed: v }));
  });
});

// PUT /api/photos/:id  (edit metadata)
// Only the fields present in the request body are updated, so a partial edit
// never wipes the album, tags or description that were not sent.
router.put('/:id', validId, (req, res, next) => {
  const body = req.body || {};
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key);
  const title = asText(body.title);
  if (has('title') && !title) return res.status(400).json({ success: false, error: 'Photo title is required' });

  const fields = [];
  const params = [];
  if (has('title')) { fields.push('title = ?'); params.push(title); }
  if (has('album')) { fields.push('album = ?'); params.push(asText(body.album, 'General') || 'General'); }
  if (has('tags')) { fields.push('tags = ?'); params.push(asText(body.tags)); }
  if (has('description')) { fields.push('description = ?'); params.push(asText(body.description)); }
  if (fields.length === 0) return res.status(400).json({ success: false, error: 'No editable fields provided' });

  params.push(req.params.id);
  db.run(`UPDATE photos SET ${fields.join(', ')} WHERE id = ?`, params, function (err) {
    if (err) return next(err);
    // NOTE: SQLite reports changes=0 when the new values equal the old ones, so
    // "no rows matched" cannot be detected here. Confirm existence separately.
    if (this.changes === 0) {
      return db.get('SELECT id FROM photos WHERE id = ?', [req.params.id], (e2, row) =>
        e2 ? next(e2) : (row
          ? res.json({ success: true, message: 'Photo details updated' })
          : notFound(res)));
    }
    res.json({ success: true, message: 'Photo details updated' });
  });
});

// DELETE /api/photos/:id  (permanent; only allowed for photos already in Trash)
router.delete('/:id', validId, (req, res, next) => {
  db.get('SELECT * FROM photos WHERE id = ?', [req.params.id], (err, photo) => {
    if (err) return next(err);
    if (!photo) return notFound(res);
    if (!photo.is_trashed) {
      return res.status(409).json({ success: false, error: 'Move the photo to Trash before deleting it permanently' });
    }
    db.run('DELETE FROM photos WHERE id = ?', [photo.id], (e2) => {
      if (e2) return next(e2);
      fs.unlink(path.join(uploadDir, photo.filename), () => res.json({ success: true, message: 'Photo permanently deleted' }));
    });
  });
});

module.exports = router;

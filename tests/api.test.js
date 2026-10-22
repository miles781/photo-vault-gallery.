process.env.NODE_ENV = 'test';
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-'));
process.env.DB_PATH = path.join(tmp, 'test.sqlite');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.MAX_FILE_SIZE_MB = '1';

const { test, before } = require('node:test');
const assert = require('node:assert');
const request = require('supertest');
const app = require('../app');

// Smallest valid 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
let id;

const up = (buf = PNG, name = 'pic.png', type = 'image/png', fields = {}) => {
  let r = request(app).post('/api/photos').attach('image', buf, { filename: name, contentType: type });
  Object.entries(fields).forEach(([k, v]) => (r = r.field(k, v)));
  return r;
};

test('T01 health endpoint responds ok', async () => {
  const r = await request(app).get('/api/health');
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.status, 'ok');
});
test('T02 upload valid PNG returns 201 and metadata', async () => {
  const r = await up(PNG, 'pic.png', 'image/png', { title: 'First', album: 'Projects', tags: 'a,b' });
  assert.strictEqual(r.status, 201); assert.strictEqual(r.body.data.album, 'Projects');
  assert.ok(fs.existsSync(path.join(process.env.UPLOAD_DIR, r.body.data.filename)));
  id = r.body.data.id;
});
test('T03 upload without file is rejected (400)', async () => {
  const r = await request(app).post('/api/photos'); assert.strictEqual(r.status, 400);
});
test('T04 non-image MIME type is rejected', async () => {
  const r = await up(Buffer.from('hello'), 'x.txt', 'text/plain'); assert.strictEqual(r.status, 400);
});
test('T05 disguised file (PHP content named .png) fails signature check', async () => {
  const r = await up(Buffer.from('<?php echo 1; ?>......'), 'evil.png', 'image/png');
  assert.strictEqual(r.status, 400); assert.match(r.body.error, /does not match/);
});
test('T06 file above size limit is rejected', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(1.2 * 1024 * 1024)]);
  const r = await up(big); assert.strictEqual(r.status, 400); assert.match(r.body.error, /too large/i);
});
test('T07 list returns uploaded photo', async () => {
  const r = await request(app).get('/api/photos'); assert.strictEqual(r.body.count, 1);
});
test('T08 search by title and tag', async () => {
  assert.strictEqual((await request(app).get('/api/photos?search=first')).body.count, 1);
  assert.strictEqual((await request(app).get('/api/photos?search=zzz')).body.count, 0);
});
test('T09 album filter works (case-insensitive)', async () => {
  assert.strictEqual((await request(app).get('/api/photos?album=projects')).body.count, 1);
});
test('T10 favorite toggle and favorites view', async () => {
  const r = await request(app).patch(`/api/photos/${id}/favorite`); assert.strictEqual(r.body.is_favorite, 1);
  assert.strictEqual((await request(app).get('/api/photos?view=favorites')).body.count, 1);
});
test('T11 metadata update, and empty title rejected', async () => {
  assert.strictEqual((await request(app).put(`/api/photos/${id}`).send({ title: 'Renamed', album: 'Camera' })).status, 200);
  assert.strictEqual((await request(app).put(`/api/photos/${id}`).send({ title: '  ' })).status, 400);
});
test('T12 permanent delete blocked while photo is not in Trash (409)', async () => {
  assert.strictEqual((await request(app).delete(`/api/photos/${id}`)).status, 409);
});
test('T13 soft delete moves photo to Trash view only', async () => {
  await request(app).patch(`/api/photos/${id}/trash`);
  assert.strictEqual((await request(app).get('/api/photos')).body.count, 0);
  assert.strictEqual((await request(app).get('/api/photos?view=trash')).body.count, 1);
});
test('T14 stats report trash count', async () => {
  const r = await request(app).get('/api/photos/stats'); assert.strictEqual(r.body.stats.trashCount, 1);
});
test('T15 restore brings photo back', async () => {
  await request(app).patch(`/api/photos/${id}/trash`);
  assert.strictEqual((await request(app).get('/api/photos')).body.count, 1);
});
test('T16 unknown id returns 404; bad id returns 400', async () => {
  assert.strictEqual((await request(app).patch('/api/photos/9999/favorite')).status, 404);
  assert.strictEqual((await request(app).patch('/api/photos/abc/trash')).status, 400);
});
test('T17 SQL injection string in search is treated as plain text', async () => {
  const r = await request(app).get('/api/photos').query({ search: "' OR 1=1 --" });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.body.count, 0);
});
test('T18 permanent delete removes DB row and file from disk', async () => {
  const photo = (await request(app).get('/api/photos')).body.data[0];
  await request(app).patch(`/api/photos/${id}/trash`);
  assert.strictEqual((await request(app).delete(`/api/photos/${id}`)).status, 200);
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!fs.existsSync(path.join(process.env.UPLOAD_DIR, photo.filename)));
  assert.strictEqual((await request(app).get('/api/photos?view=trash')).body.count, 0);
});

// ---- Regression tests for the crashes and data-loss bugs that were fixed ----

test('T19 repeated query params are handled instead of crashing (500)', async () => {
  assert.strictEqual((await request(app).get('/api/photos?album=General&album=Other')).status, 200);
  assert.strictEqual((await request(app).get('/api/photos?search=a&search=b')).status, 200);
  assert.strictEqual((await request(app).get('/api/photos?view=all&view=trash')).status, 200);
});

test('T20 repeated multipart fields do not crash the upload (500)', async () => {
  const r = await request(app).post('/api/photos')
    .attach('image', PNG, { filename: 'dup.png', contentType: 'image/png' })
    .field('title', 'first').field('title', 'second');
  assert.strictEqual(r.status, 201);
});

test('T21 non-string metadata values are coerced, not crashed on', async () => {
  const photo = (await request(app).get('/api/photos')).body.data[0];
  const r = await request(app).put(`/api/photos/${photo.id}`).send({ title: 123, album: 456 });
  assert.strictEqual(r.status, 200);
  const updated = (await request(app).get('/api/photos')).body.data.find((p) => p.id === photo.id);
  assert.strictEqual(updated.title, '123');
  assert.strictEqual(updated.album, '456');
});

test('T22 partial metadata update keeps the fields that were not sent', async () => {
  const photo = (await request(app).get('/api/photos')).body.data[0];
  await request(app).put(`/api/photos/${photo.id}`).send({ album: 'Keepers', tags: 'keep' });
  await request(app).put(`/api/photos/${photo.id}`).send({ title: 'OnlyTitle' });
  const updated = (await request(app).get('/api/photos')).body.data.find((p) => p.id === photo.id);
  assert.strictEqual(updated.title, 'OnlyTitle');
  assert.strictEqual(updated.album, 'Keepers');   // must NOT be reset to General
  assert.strictEqual(updated.tags, 'keep');        // must NOT be wiped
});

test('T23 blank title falls back to the original filename', async () => {
  const r = await request(app).post('/api/photos')
    .attach('image', PNG, { filename: 'holiday-snap.png', contentType: 'image/png' })
    .field('title', '   ');
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.data.title, 'holiday-snap');
});

test('T24 LIKE wildcards in search are treated as literal text', async () => {
  const r = await request(app).post('/api/photos')
    .attach('image', PNG, { filename: 'pct.png', contentType: 'image/png' })
    .field('title', '100% done');
  assert.strictEqual(r.status, 201);
  const hits = await request(app).get('/api/photos').query({ search: '%' });
  assert.strictEqual(hits.body.count, 1);          // only the literal "%" photo
  const none = await request(app).get('/api/photos').query({ search: '%%%%' });
  assert.strictEqual(none.body.count, 0);
});

test('T25 stats totalPhotos excludes photos sitting in Trash', async () => {
  const photo = (await request(app).get('/api/photos')).body.data[0];
  const before = (await request(app).get('/api/photos/stats')).body.stats.totalPhotos;
  await request(app).patch(`/api/photos/${photo.id}/trash`);
  const after = (await request(app).get('/api/photos/stats')).body.stats.totalPhotos;
  assert.strictEqual(after, before - 1);
  await request(app).patch(`/api/photos/${photo.id}/trash`);
});

test('T26 malformed JSON body returns 400, not 500', async () => {
  const r = await request(app).put('/api/photos/1').set('Content-Type', 'application/json').send('{bad json');
  assert.strictEqual(r.status, 400);
});

test('T27 re-submitting identical metadata still returns 200 (not a false 404)', async () => {
  const photo = (await request(app).get('/api/photos')).body.data[0];
  const first = await request(app).put(`/api/photos/${photo.id}`).send({ title: 'SameTitle' });
  assert.strictEqual(first.status, 200);
  const second = await request(app).put(`/api/photos/${photo.id}`).send({ title: 'SameTitle' });
  assert.strictEqual(second.status, 200);
});

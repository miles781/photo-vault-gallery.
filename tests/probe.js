process.env.NODE_ENV = 'test';
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-probe-'));
process.env.DB_PATH = path.join(tmp, 'probe.sqlite');
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.MAX_FILE_SIZE_MB = '1';

const request = require('supertest');
const app = require('../app');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const out = [];
  const log = (...a) => out.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));

  // 1. PUT with non-string title (JSON number)
  const up = await request(app).post('/api/photos').attach('image', PNG, { filename: 'a.png', contentType: 'image/png' });
  const id = up.body.data.id;
  log('1 PUT numeric title ->', (await request(app).put(`/api/photos/${id}`).send({ title: 123 })).status);

  // 2. POST upload with array-valued multipart field (duplicate field names)
  let r = request(app).post('/api/photos').attach('image', PNG, { filename: 'b.png', contentType: 'image/png' });
  r = r.field('title', 'x').field('title', 'y');
  log('2 POST duplicate title field ->', (await r).status);

  // 3. GET list with weird view value
  log('3 GET view=bogus ->', (await request(app).get('/api/photos?view=bogus')).body.count);

  // 4. GET with huge id
  log('4 PATCH huge id ->', (await request(app).patch('/api/photos/999999999999999999999/favorite')).status);

  // 5. GET search with LIKE wildcard %
  log('5 GET search=%% ->', (await request(app).get('/api/photos?search=%25')).body.count);

  // 6. DELETE a trashed photo twice
  await request(app).patch(`/api/photos/${id}/trash`);
  log('6 DELETE#1 ->', (await request(app).delete(`/api/photos/${id}`)).status);
  log('6 DELETE#2 ->', (await request(app).delete(`/api/photos/${id}`)).status);

  // 7. POST upload with no extension but valid png mime
  log('7 POST no-extension ->', (await request(app).post('/api/photos').attach('image', PNG, { filename: 'noext', contentType: 'image/png' })).status);

  // 8. PUT with non-string album
  log('8 PUT numeric album ->', (await request(app).put(`/api/photos/999`).send({ title: 't', album: 5 })).status);

  // 9. GET /api/photos/stats count semantics vs list
  const stats = (await request(app).get('/api/photos/stats')).body.stats;
  const list = (await request(app).get('/api/photos')).body.count;
  log('9 stats.totalPhotos=', stats.totalPhotos, 'list count=', list);

  // 10. POST with a title containing only whitespace
  log('10 POST whitespace title ->', (await request(app).post('/api/photos').attach('image', PNG, { filename: 'c.png', contentType: 'image/png' }).field('title', '   ')).status);

  // 11. GET with album param containing quotes
  log('11 GET album=quote ->', (await request(app).get('/api/photos?album=a%27b')).status);

  // 12. Content-Type json on POST /api/photos (no multipart)
  log('12 POST json body ->', (await request(app).post('/api/photos').send({ title: 'x' })).status);

  // 13. HEAD/OPTIONS
  log('13 OPTIONS ->', (await request(app).options('/api/photos')).status);

  // 14. PUT missing title entirely (undefined)
  log('14 PUT no title ->', (await request(app).put(`/api/photos/${id}`).send({ album: 'z' })).status);

  console.log(out.join('\n'));
  process.exit(0);
})();

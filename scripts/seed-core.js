// Shared gallery seeding logic.
//
// Used by scripts/seed.js (CLI, against an already running server) and by the
// automatic first-boot seeding in server.js (needed on Render, where every new
// instance starts with an empty database).
//
// Re-running is safe: a photo whose album + title already exists is skipped,
// so the script never duplicates rows. The demo state (which photos are starred
// and which ones sit in Trash) is fixed by the lists below, which keeps the
// screenshots in /screenshots reproducible.
const fs = require('fs');
const path = require('path');

const SAMPLE_DIR = path.join(__dirname, '..', 'sample-images');

// Demo state, matched on the album + title that the sample file names produce.
// (Uploaded files are renamed to photo_<timestamp>_<rand>.<ext>, so the original
// file name is not recoverable from the stored row - the metadata is.)
const FAVORITES = [['Camera', 'river view'], ['Projects', 'api diagram'], ['University', 'graduation day']];
const TRASHED = [['University', 'lab session'], ['University', 'library desk']];

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

const keyOf = (album, title) => `${album.toLowerCase()}|${title.toLowerCase()}`;
const FAVORITE_KEYS = FAVORITES.map(([a, t]) => keyOf(a, t));
const TRASH_KEYS = TRASHED.map(([a, t]) => keyOf(a, t));

async function json(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!data || !data.success) throw new Error(data && data.error ? data.error : `HTTP ${res.status}`);
  return data;
}

// view=all hides trashed photos, so both views are needed for a full picture.
async function allPhotos(base) {
  const [live, trashed] = await Promise.all([
    json(`${base}/api/photos?view=all`),
    json(`${base}/api/photos?view=trash`)
  ]);
  return [...live.data, ...trashed.data];
}

// The set of sample photos, derived from the file names in sample-images/.
// A gallery that contains nothing but these photos is an incomplete seed and
// is safe to complete; a gallery that also holds user uploads must be left
// alone.
function sampleKeys(sampleDir = SAMPLE_DIR) {
  if (!fs.existsSync(sampleDir)) return new Set();
  const keys = new Set();
  for (const file of fs.readdirSync(sampleDir)) {
    const ext = path.extname(file).toLowerCase();
    if (!MIME[ext]) continue;
    const [album, rest] = file.replace(ext, '').split('__');
    if (!album || !rest) continue;
    const title = rest.replace(/_/g, ' ');
    keys.add(keyOf(album[0].toUpperCase() + album.slice(1), title));
  }
  return keys;
}

// Decide whether the gallery should be seeded on boot.
//
//   - empty gallery            -> seed (fresh instance, e.g. on Render)
//   - only sample photos       -> seed (finishes an interrupted seed and
//                                 re-applies the demo state)
//   - user-uploaded photos     -> do not touch it
async function shouldSeed(base, sampleDir = SAMPLE_DIR) {
  const photos = await allPhotos(base);
  if (photos.length === 0) return true;
  const keys = sampleKeys(sampleDir);
  if (keys.size === 0) return false;
  return photos.every((p) => keys.has(keyOf(p.album, p.title)));
}

// Upload every sample image that is not in the gallery yet.
async function uploadSamplePhotos(base, log, sampleDir = SAMPLE_DIR) {
  const seen = new Set((await allPhotos(base)).map((p) => keyOf(p.album, p.title)));

  if (!fs.existsSync(sampleDir)) {
    log(`skip seeding - sample folder not found at ${sampleDir}`);
    return 0;
  }

  let uploaded = 0;
  for (const file of fs.readdirSync(sampleDir).sort()) {
    const ext = path.extname(file).toLowerCase();
    const mime = MIME[ext];
    if (!mime) {
      log(`skip ${file} - unsupported extension`);
      continue;
    }

    const [album, rest] = file.replace(ext, '').split('__');
    if (!album || !rest) {
      log(`skip ${file} - unexpected file name format`);
      continue;
    }
    const title = rest.replace(/_/g, ' ');
    const albumName = album[0].toUpperCase() + album.slice(1);

    if (seen.has(keyOf(albumName, title))) {
      log(`skip ${file}`);
      continue;
    }

    const form = new FormData();
    form.append('image', new Blob([fs.readFileSync(path.join(sampleDir, file))], { type: mime }), file);
    form.append('title', title);
    form.append('album', albumName);
    form.append('tags', `${album}, sample, 2026`);
    const res = await fetch(`${base}/api/photos`, { method: 'POST', body: form });
    log(res.status, file);
    // Only mark as seen on success, so a failed upload is retried on the next run.
    if (res.ok) {
      seen.add(keyOf(albumName, title));
      uploaded += 1;
    }
  }
  return uploaded;
}

// Apply the fixed demo state on top of everything now in the gallery.
async function applyDemoState(base, log) {
  for (const photo of await allPhotos(base)) {
    const key = keyOf(photo.album, photo.title);

    const shouldFavorite = FAVORITE_KEYS.includes(key);
    if (shouldFavorite !== Boolean(photo.is_favorite)) {
      const r = await json(`${base}/api/photos/${photo.id}/favorite`, { method: 'PATCH' });
      log(`fav  ${photo.album}/${photo.title} -> ${r.is_favorite}`);
    }

    const shouldTrash = TRASH_KEYS.includes(key);
    if (shouldTrash !== Boolean(photo.is_trashed)) {
      const r = await json(`${base}/api/photos/${photo.id}/trash`, { method: 'PATCH' });
      log(`trash ${photo.album}/${photo.title} -> ${r.is_trashed}`);
    }
  }
}

// Full seed: upload the samples, then set the demo state.
async function seedGallery(base, log = () => {}, sampleDir = SAMPLE_DIR) {
  const uploaded = await uploadSamplePhotos(base, log, sampleDir);
  await applyDemoState(base, log);
  return uploaded;
}

module.exports = { seedGallery, uploadSamplePhotos, applyDemoState, allPhotos, shouldSeed, sampleKeys, SAMPLE_DIR };

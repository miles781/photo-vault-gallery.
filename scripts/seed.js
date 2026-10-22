// Uploads the synthetic sample images through the real API (server must be running).
//
// Re-running is safe: a photo whose album + title already exists is skipped, so
// the script never duplicates rows. The demo state (which photos are starred and
// which ones sit in Trash) is fixed by the lists below, which keeps the
// screenshots in /screenshots reproducible.
const fs = require('fs');
const path = require('path');
const base = process.env.BASE_URL || 'http://localhost:4000';
const dir = path.join(__dirname, '../sample-images');
const mime = { '.jpg': 'image/jpeg', '.png': 'image/png' };
const logFile = process.env.SEED_LOG || path.join(__dirname, '../outputs/seed_log.txt');

// Log to stdout and to outputs/seed_log.txt (UTF-8) so the artifact stays in
// sync with the run without depending on shell redirection.
const logLines = [];
const log = (...parts) => {
  const line = parts.join(' ');
  logLines.push(line);
  console.log(line);
};
const flushLog = () => {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, `${logLines.join('\n')}\n`, 'utf8');
};

// Demo state, matched on the album + title that the sample file names produce.
// (Uploaded files are renamed to photo_<timestamp>_<rand>.<ext>, so the original
// file name is not recoverable from the stored row - the metadata is.)
const FAVORITES = [['Camera', 'river view'], ['Projects', 'api diagram'], ['University', 'graduation day']];
const TRASHED = [['University', 'lab session'], ['University', 'library desk']];

const keyOf = (album, title) => `${album.toLowerCase()}|${title.toLowerCase()}`;
const FAVORITE_KEYS = FAVORITES.map(([a, t]) => keyOf(a, t));
const TRASH_KEYS = TRASHED.map(([a, t]) => keyOf(a, t));

async function json(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!data || !data.success) throw new Error(data && data.error ? data.error : `HTTP ${res.status}`);
  return data;
}

(async () => {
  // view=all hides trashed photos, so both views are needed for a full picture.
  const allPhotos = async () => {
    const [live, trashed] = await Promise.all([
      json(`${base}/api/photos?view=all`),
      json(`${base}/api/photos?view=trash`)
    ]);
    return [...live.data, ...trashed.data];
  };

  const seen = new Set((await allPhotos()).map((p) => keyOf(p.album, p.title)));

  for (const file of fs.readdirSync(dir).sort()) {
    const ext = path.extname(file);
    const [album, rest] = file.replace(ext, '').split('__');
    const title = rest.replace(/_/g, ' ');
    const albumName = album[0].toUpperCase() + album.slice(1);

    if (seen.has(keyOf(albumName, title))) {
      log(`skip ${file}`);
      continue;
    }

    const form = new FormData();
    form.append('image', new Blob([fs.readFileSync(path.join(dir, file))], { type: mime[ext] }), file);
    form.append('title', title);
    form.append('album', albumName);
    form.append('tags', `${album}, sample, 2026`);
    const res = await fetch(`${base}/api/photos`, { method: 'POST', body: form });
    log(res.status, file);
    // Only mark as seen on success, so a failed upload is retried on the next run.
    if (res.ok) seen.add(keyOf(albumName, title));
  }

  // Apply the fixed demo state on top of everything now in the gallery.
  for (const photo of await allPhotos()) {
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

  flushLog();
})().catch((err) => {
  flushLog();
  console.error('Seed failed:', err.message);
  process.exit(1);
});

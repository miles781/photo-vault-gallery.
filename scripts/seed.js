// Uploads the synthetic sample images through the real API (server must be running).
//
// The seeding logic itself lives in scripts/seed-core.js so that server.js can
// reuse it for automatic first-boot seeding (needed on Render, where every new
// instance starts with an empty database).
//
// Re-running is safe: a photo whose album + title already exists is skipped, so
// the script never duplicates rows. The demo state (which photos are starred and
// which ones sit in Trash) is fixed by the lists in seed-core.js, which keeps
// the screenshots in /screenshots reproducible.
const fs = require('fs');
const path = require('path');
const { seedGallery } = require('./seed-core');

const base = process.env.BASE_URL || 'http://localhost:4000';
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

(async () => {
  await seedGallery(base, log);
  flushLog();
})().catch((err) => {
  flushLog();
  console.error('Seed failed:', err.message);
  process.exit(1);
});

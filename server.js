require('dotenv').config();
const app = require('./app');
const { dbPath, uploadDir, dataDir } = require('./config');

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';

// On PaaS platforms such as Render the local filesystem is ephemeral, so a
// fresh instance always starts with an empty database. Seeding the sample
// gallery on boot keeps the deployed app usable instead of showing an empty
// grid. Set AUTO_SEED=false to disable it.
const AUTO_SEED = process.env.AUTO_SEED !== 'false' && process.env.NODE_ENV !== 'test';

const server = app.listen(PORT, HOST, async () => {
  console.log(`PhotoVault running at http://localhost:${PORT}`);
  console.log(`Data directory: ${dataDir || 'project folder (ephemeral)'}`);
  console.log(`Database: ${dbPath}`);
  console.log(`Uploads:  ${uploadDir}`);

  if (!AUTO_SEED) return;

  const base = `http://127.0.0.1:${PORT}`;
  try {
    const { shouldSeed, seedGallery } = require('./scripts/seed-core');
    if (!(await shouldSeed(base))) {
      console.log('Gallery already holds photos - skipping auto-seed.');
      return;
    }
    console.log('Seeding the sample images...');
    const uploaded = await seedGallery(base, (...args) => console.log('[seed]', ...args));
    console.log(`Auto-seed complete (${uploaded} photos uploaded).`);
  } catch (err) {
    // A failed seed must never take the server down; the gallery simply stays
    // empty and the user can upload their own photos.
    console.error('Auto-seed failed:', err.message);
  }
});

// Render sends SIGTERM on redeploys - close the server so the instance can
// shut down cleanly.
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down.');
  server.close(() => process.exit(0));
});

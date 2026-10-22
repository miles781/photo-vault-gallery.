// Simulates a fresh Render instance:
//   - empty data directory (no database, no uploads)
//   - server boots and auto-seeds itself
//   - verifies the gallery is populated and the static files are served
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const dataDir = path.join(root, '_rendertest');
const port = process.env.PORT || '4123';
const base = `http://127.0.0.1:${port}`;

fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

const child = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, DATA_DIR: dataDir, PORT: port, NODE_ENV: 'production', AUTO_SEED: 'true' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let log = '';
child.stdout.on('data', (d) => { log += d.toString(); });
child.stderr.on('data', (d) => { log += d.toString(); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Wait until the server is up AND the auto-seed has finished. The seed runs
// after the listener is ready, so the health check alone is not enough.
async function waitForSeed(base, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await wait(500);
    try {
      const r = await fetch(`${base}/api/health`);
      if (!r.ok) continue;
      const stats = await (await fetch(`${base}/api/photos/stats`)).json();
      const total = stats.stats.totalPhotos + stats.stats.trashCount;
      // The full demo state is 12 photos (10 visible + 2 in Trash) with
      // 3 favourites.
      if (total >= 12 && stats.stats.favoritesCount === 3) return stats.stats;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error('Timed out waiting for the auto-seed to finish');
  }
}

(async () => {
  // Give the server time to boot and seed.
  await waitForSeed(base);

  console.log('=== server log ===');
  console.log(log.trim());

  console.log('\n=== GET /api/health ===');
  console.log((await (await fetch(`${base}/api/health`)).json()).status);

  console.log('\n=== GET /api/photos/stats ===');
  const stats = await (await fetch(`${base}/api/photos/stats`)).json();
  console.log(JSON.stringify(stats.stats));

  console.log('\n=== GET /api/photos?view=all (count) ===');
  const all = await (await fetch(`${base}/api/photos?view=all`)).json();
  console.log('count =', all.count);
  console.log('albums =', [...new Set(all.data.map((p) => p.album))].join(', '));

  console.log('\n=== GET /api/photos?view=favorites (count) ===');
  const fav = await (await fetch(`${base}/api/photos?view=favorites`)).json();
  console.log('count =', fav.count);

  console.log('\n=== GET /api/photos?view=trash (count) ===');
  const trash = await (await fetch(`${base}/api/photos?view=trash`)).json();
  console.log('count =', trash.count);

  console.log('\n=== GET / (index.html) ===');
  const index = await fetch(`${base}/`);
  console.log('status =', index.status, '| content-type =', index.headers.get('content-type'));

  console.log('\n=== GET an uploaded image ===');
  const first = all.data[0];
  const img = await fetch(`${base}${first.filepath}`);
  console.log('status =', img.status, '| type =', img.headers.get('content-type'), '| bytes =', (await img.arrayBuffer()).byteLength);

  console.log('\n=== data dir contents ===');
  console.log(fs.readdirSync(dataDir).join(', '));
  console.log('uploads:', fs.readdirSync(path.join(dataDir, 'uploads')).length, 'files');

  // Restart the server against the SAME data dir: the data must survive and
  // the auto-seed must not duplicate anything.
  console.log('\n=== restart against the same data dir (persistence check) ===');
  child.kill('SIGTERM');
  await wait(3000);

  const child2 = spawn(process.execPath, ['server.js'], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, PORT: port, NODE_ENV: 'production', AUTO_SEED: 'true' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log2 = '';
  child2.stdout.on('data', (d) => { log2 += d.toString(); });
  child2.stderr.on('data', (d) => { log2 += d.toString(); });

  for (let i = 0; i < 40; i += 1) {
    await wait(500);
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) break;
    } catch { /* not up yet */ }
  }
  await wait(3000);

  console.log(log2.trim().split('\n').filter((l) => /seed|already|skipping/i.test(l)).join('\n'));
  const all2 = await (await fetch(`${base}/api/photos?view=all`)).json();
  const trash2 = await (await fetch(`${base}/api/photos?view=trash`)).json();
  const fav2 = await (await fetch(`${base}/api/photos?view=favorites`)).json();
  console.log('after restart -> all =', all2.count, '| trash =', trash2.count, '| favorites =', fav2.count);

  child2.kill('SIGTERM');
  await wait(1500);
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('\nDONE');
  process.exit(0);
})().catch((err) => {
  console.error('RENDER SIM FAILED:', err.message);
  child.kill();
  process.exit(1);
});

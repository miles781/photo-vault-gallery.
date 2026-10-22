// Verifies the CLI scripts that talk to a running server:
//   npm run seed      - uploads the samples and re-applies the demo state
//   npm run snapshot  - refreshes outputs/stats.json and outputs/test_results.txt
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const dataDir = path.join(root, '_clidertest');
const port = '4124';
const base = `http://127.0.0.1:${port}`;

fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, DATA_DIR: dataDir, PORT: port, NODE_ENV: 'production', AUTO_SEED: 'false' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d.toString(); });
server.stderr.on('data', (d) => { serverLog += d.toString(); });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // Wait for the server (auto-seed is off, so it is empty on purpose).
  for (let i = 0; i < 40; i += 1) {
    await wait(500);
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) break;
    } catch { /* not up yet */ }
  }
  console.log('=== server up ===');

  // --- npm run seed ---
  console.log('\n=== npm run seed (first run) ===');
  const seed1 = spawnSync(process.execPath, [path.join(root, 'scripts', 'seed.js')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, BASE_URL: base }
  });
  console.log(seed1.stdout.trim());
  console.log('exit code:', seed1.status);
  console.log('seed_log.txt written:', fs.existsSync(path.join(root, 'outputs', 'seed_log.txt')));

  // --- npm run seed again (idempotency) ---
  console.log('\n=== npm run seed (second run - must not duplicate) ===');
  const seed2 = spawnSync(process.execPath, [path.join(root, 'scripts', 'seed.js')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, BASE_URL: base }
  });
  console.log(seed2.stdout.trim());
  console.log('exit code:', seed2.status);

  const stats = await (await fetch(`${base}/api/photos/stats`)).json();
  console.log('\nstats after seeding:', JSON.stringify(stats.stats));

  // --- npm run snapshot ---
  console.log('\n=== npm run snapshot ===');
  const snap = spawnSync(process.execPath, [path.join(root, 'scripts', 'snapshot.js')], {
    cwd: root, encoding: 'utf8', env: { ...process.env, BASE_URL: base }
  });
  console.log(snap.stdout.trim());
  console.log('exit code:', snap.status);

  console.log('\n=== outputs/stats.json ===');
  console.log(fs.readFileSync(path.join(root, 'outputs', 'stats.json'), 'utf8').trim());
  console.log('\n=== outputs/test_results.txt (tail) ===');
  console.log(fs.readFileSync(path.join(root, 'outputs', 'test_results.txt'), 'utf8').trim().split('\n').slice(-6).join('\n'));

  server.kill('SIGTERM');
  await wait(1500);
  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('\nDONE');
  process.exit(0);
})().catch((err) => {
  console.error('CLI VERIFY FAILED:', err.message);
  server.kill();
  process.exit(1);
});

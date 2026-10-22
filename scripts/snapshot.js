// Writes the demo-state artifacts used by the project documentation:
//   outputs/stats.json       - a snapshot of GET /api/photos/stats
//   outputs/test_results.txt - the output of the automated test suite
//
// The server must be running (BASE_URL, default http://localhost:4000).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const base = process.env.BASE_URL || 'http://localhost:4000';
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'outputs');

(async () => {
  fs.mkdirSync(outDir, { recursive: true });

  // 1. stats snapshot
  const res = await fetch(`${base}/api/photos/stats`);
  const stats = await res.json();
  if (!stats.success) throw new Error(stats.error || `HTTP ${res.status}`);
  fs.writeFileSync(path.join(outDir, 'stats.json'), `${JSON.stringify(stats)}\n`, 'utf8');
  console.log('wrote outputs/stats.json ->', JSON.stringify(stats.stats));

  // 2. test suite output
  const test = spawnSync(process.execPath, ['--test', 'tests/api.test.js'], {
    cwd: root,
    encoding: 'utf8'
  });
  const output = `${test.stdout || ''}${test.stderr || ''}`;
  fs.writeFileSync(path.join(outDir, 'test_results.txt'), output, 'utf8');
  const pass = (output.match(/^# pass (\d+)$/m) || [])[1];
  const fail = (output.match(/^# fail (\d+)$/m) || [])[1];
  console.log(`wrote outputs/test_results.txt -> pass=${pass} fail=${fail}`);
  if (test.status !== 0) process.exit(test.status || 1);
})().catch((err) => {
  console.error('Snapshot failed:', err.message);
  process.exit(1);
});
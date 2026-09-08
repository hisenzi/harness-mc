import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const programs = [
  'verify-workbook-requirement-binding.mjs',
  'verify-workbook-session-context.mjs',
  'verify-workbook-preflight-adapter.mjs',
  'verify-workbook-anchor.mjs',
  'verify-workbook-coordination.mjs',
  'verify-workbook-workers.mjs',
  'verify-local-task-handoff.mjs',
  'verify-workbook-visibility.mjs',
  'verify-workbook-portable-paths.mjs',
  'verify-workbook-intake-adapter.mjs',
  'verify-workbook-acceptance-coverage.mjs',
];
const results = programs.map(program => {
  const started = Date.now();
  const run = spawnSync(process.execPath, [path.join(root, 'scripts', program)], {
    cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
  });
  if (run.stdout) process.stdout.write(run.stdout);
  if (run.stderr) process.stderr.write(run.stderr);
  return { program, status: run.status === 0 ? 'passed' : 'failed', elapsed_ms: Date.now() - started };
});
console.log(JSON.stringify({ version: 1, boundary: 'isolated fixtures only; not the real P8 pilot', results }, null, 2));
if (results.some(result => result.status !== 'passed')) process.exitCode = 1;

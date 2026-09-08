#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(ROOT, 'out');
const target = path.join(ROOT, '.tmp/morrowise-docs/site');
const nextBin = path.join(ROOT, 'node_modules/next/dist/bin/next');

function pathExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

if (pathExists(outPath)) {
  throw new Error('local_export_path_occupied');
}

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.rmSync(target, { recursive: true, force: true });
const result = spawnSync(process.execPath, [nextBin, 'build'], {
  cwd: ROOT,
  env: { ...process.env, MORROWISE_DOCS_LOCAL_PREVIEW: '1' },
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) {
  fs.rmSync(target, { recursive: true, force: true });
  if (pathExists(outPath)) {
    fs.rmSync(outPath, { recursive: true, force: true });
    throw new Error('local_export_path_created_on_failed_build');
  }
  process.exit(result.status ?? 1);
}

if (pathExists(outPath)) {
  fs.rmSync(outPath, { recursive: true, force: true });
  throw new Error('local_export_path_leaked');
}
if (!pathExists(target) || fs.readdirSync(target).length === 0) {
  throw new Error('local_export_missing');
}

console.log(`MorroWise local export written only under: ${target}`);

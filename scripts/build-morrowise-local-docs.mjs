#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
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

// A preceding public build may own out/. Never delete or overwrite it.
// Hash the full tree (including modes and symlinks without following them).
function publicSnapshot() {
  if (!pathExists(outPath)) return null;
  const entries = [];
  function visit(file, relative) {
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink()) entries.push([relative, stat.mode, 'link', fs.readlinkSync(file)]);
    else if (stat.isDirectory()) {
      entries.push([relative, stat.mode, 'directory']);
      for (const name of fs.readdirSync(file).sort()) visit(path.join(file, name), `${relative}/${name}`);
    } else if (stat.isFile()) entries.push([relative, stat.mode, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]);
    else throw new Error('local_export_unsafe_public_path');
  }
  visit(outPath, 'out');
  return JSON.stringify(entries);
}
const publicBefore = publicSnapshot();

fs.mkdirSync(path.dirname(target), { recursive: true });
fs.rmSync(target, { recursive: true, force: true });
const result = spawnSync(process.execPath, [nextBin, 'build'], {
  cwd: ROOT,
  env: { ...process.env, MORROWISE_DOCS_LOCAL_PREVIEW: '1' },
  stdio: 'inherit',
});

const publicAfter = publicSnapshot();
if (publicAfter !== publicBefore) {
  // Keep unexpected output as evidence. This wrapper does not own public out/.
  throw new Error(publicBefore === null ? 'local_export_path_leaked' : 'local_export_path_changed');
}
if (result.error) throw result.error;
if (result.status !== 0) {
  fs.rmSync(target, { recursive: true, force: true });
  process.exit(result.status ?? 1);
}

if (!pathExists(target) || fs.readdirSync(target).length === 0) {
  throw new Error('local_export_missing');
}

console.log(`MorroWise local export written only under: ${target}`);

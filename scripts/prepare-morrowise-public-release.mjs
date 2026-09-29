#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPublicRelease, validatePublicRelease} from './lib/morrowise-public-release.mjs';
import {evaluateDocumentationImpact} from './lib/morrowise-documentation-impact.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.slice(2).some(arg => !['--candidate', '--check'].includes(arg)) || !process.argv.includes('--candidate')) {
  throw new Error('explicit_candidate_mode_required; committed release sealing is not authorized by this command');
}
function read(relative) {
  let file = root;
  for (const part of relative.split('/')) {
    file = path.join(file, part);
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('release_symlink_rejected');
  }
  if (!fs.statSync(file).isFile()) throw new Error('release_regular_file_required');
  return fs.readFileSync(file, 'utf8');
}
const registry = JSON.parse(read('system-workflow/registries/morrowise-document-sources.json'));
const body = read('docs/morrowise/OPERATOR-GUIDE.md');
const impact = evaluateDocumentationImpact({registry, collabRoot: path.dirname(root), inspectGit: true});
if (impact.decision !== 'allow') throw new Error(`documentation_impact_blocked:${impact.findings.join(',')}`);
const release = createPublicRelease({registry, body});
if (process.argv.includes('--check')) {
  const actual = Object.fromEntries(['manifest', 'bundle'].map(name => [name, JSON.parse(read(`release/morrowise-docs/${name}.json`))]));
  validatePublicRelease(actual, {registry, body, allowCandidate: true});
  console.log('Public candidate parity verified; not committed or deployed.');
} else {
  const destination = path.join(root, 'release/morrowise-docs');
  for (const relative of ['release', 'release/morrowise-docs']) {
    const dir = path.join(root, relative);
    if (fs.existsSync(dir) && (fs.lstatSync(dir).isSymbolicLink() || !fs.statSync(dir).isDirectory())) throw new Error('unsafe_release_destination');
    fs.mkdirSync(dir, {recursive: true});
  }
  // Manifest is written last. A partial/interrupted pair fails reconstruction validation.
  for (const name of ['bundle', 'manifest']) {
    const target = path.join(destination, `${name}.json`);
    if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new Error('release_symlink_rejected');
    const temporary = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(release[name], null, 2) + '\n', {flag: 'wx', mode: 0o644});
    fs.renameSync(temporary, target);
  }
  console.log('Public candidate generated; source_commit=null; not authorized for deployment.');
}

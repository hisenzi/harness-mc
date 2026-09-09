#!/usr/bin/env node
// Fast boundary tests; full Next builds and rendered artifact checks are separate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const {createValidFileMatcher} = require('next/dist/server/lib/find-page-file.js');
const {PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD} = require('next/constants');
let failures = 0, passed = 0;
function check(name, run) {
  try { run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
}
function configFor(phase, preview) {
  const env = {...process.env, NODE_ENV: phase === PHASE_DEVELOPMENT_SERVER ? 'development' : 'production'};
  delete env.MORROWISE_DOCS_LOCAL_PREVIEW;
  if (preview !== undefined) env.MORROWISE_DOCS_LOCAL_PREVIEW = preview;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import config from './next.config.mjs'; console.log(JSON.stringify(typeof config === 'function' ? await config(${JSON.stringify(phase)}) : config));`],
  {cwd: ROOT, env, encoding: 'utf8'});
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
for (const [name, phase, preview, include] of [
  ['public build', PHASE_PRODUCTION_BUILD, undefined, false],
  ['invalid preview flag', PHASE_PRODUCTION_BUILD, 'true', false],
  ['local dev', PHASE_DEVELOPMENT_SERVER, undefined, true],
  ['local static preview', PHASE_PRODUCTION_BUILD, '1', true],
]) check(`${name}: real route discovery preserves MC and gates both docs entries`, () => {
  const config = configFor(phase, preview);
  const matcher = createValidFileMatcher(config.pageExtensions ?? ['tsx', 'ts', 'jsx', 'js']);
  const page = fs.existsSync(path.join(ROOT, 'app/docs/[[...slug]]/page.local.tsx'))
    ? 'app/docs/[[...slug]]/page.local.tsx' : 'app/docs/[[...slug]]/page.tsx';
  const layout = fs.existsSync(path.join(ROOT, 'app/docs/layout.local.tsx'))
    ? 'app/docs/layout.local.tsx' : 'app/docs/layout.tsx';
  assert.equal(matcher.isAppRouterPage('app/page.tsx'), true);
  assert.equal(matcher.isAppLayoutPage('app/layout.tsx'), true);
  assert.equal(matcher.isAppRouterPage(page), include, 'docs page route inclusion');
  assert.equal(matcher.isAppLayoutPage(layout), include, 'docs layout inclusion');
  assert.equal(config.distDir, preview === '1' ? '.tmp/morrowise-docs/site' : '.next');
});

// Only the Next subprocess is replaced here. The actual wrapper owns/checks
// real fixture directories; this tests preservation, not Next rendering.
function wrapperCase({existingOut, failBuild, leakOut = false}) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'morrowise-build-wrapper-'));
  try {
    fs.mkdirSync(path.join(fixture, 'scripts'));
    fs.copyFileSync(path.join(ROOT, 'scripts/build-morrowise-local-docs.mjs'), path.join(fixture, 'scripts/build-morrowise-local-docs.mjs'));
    const bin = path.join(fixture, 'node_modules/next/dist/bin');
    fs.mkdirSync(bin, {recursive: true});
    fs.writeFileSync(path.join(bin, 'next'), `const fs=require('node:fs');
      fs.writeFileSync('build-attempted','yes');
      fs.mkdirSync('.tmp/morrowise-docs/site',{recursive:true});
      fs.writeFileSync('.tmp/morrowise-docs/site/docs.html','local preview');
      ${leakOut ? "fs.mkdirSync('out',{recursive:true});fs.writeFileSync('out/leak.html','unexpected output');" : ''}
      process.exit(${failBuild ? 1 : 0});`);
    if (existingOut) {
      fs.mkdirSync(path.join(fixture, 'out'));
      fs.writeFileSync(path.join(fixture, 'out/index.html'), 'existing public output');
    }
    const result = spawnSync(process.execPath, ['scripts/build-morrowise-local-docs.mjs'], {cwd: fixture, encoding: 'utf8'});
    assert.equal(fs.existsSync(path.join(fixture, 'build-attempted')), true, 'must reach the build subprocess');
    if (existingOut) assert.equal(fs.readFileSync(path.join(fixture, 'out/index.html'), 'utf8'), 'existing public output');
    if (leakOut) {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /local_export_path_(?:leaked|changed)/);
      // Unexpected output is evidence, never silently deleted by the wrapper.
      assert.equal(fs.readFileSync(path.join(fixture, 'out/leak.html'), 'utf8'), 'unexpected output');
    } else {
      assert.equal(result.status, failBuild ? 1 : 0, result.stderr);
      assert.equal(fs.existsSync(path.join(fixture, '.tmp/morrowise-docs/site/docs.html')), !failBuild);
      if (!existingOut) assert.equal(fs.existsSync(path.join(fixture, 'out')), false);
    }
  } finally { fs.rmSync(fixture, {recursive: true, force: true}); }
}
check('local build preserves an existing public export', () => wrapperCase({existingOut: true, failBuild: false}));
check('failed local build preserves an existing public export', () => wrapperCase({existingOut: true, failBuild: true}));
check('fresh local build emits no public export', () => wrapperCase({existingOut: false, failBuild: false}));
check('unexpected public output fails closed and is retained for inspection', () => wrapperCase({existingOut: false, failBuild: true, leakOut: true}));
console.log(JSON.stringify({passed, failed: failures, scope: 'route-discovery-and-wrapper-boundaries'}));
process.exitCode = failures ? 1 : 0;

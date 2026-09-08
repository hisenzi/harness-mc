#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBundle, writeLocalOutputs} from './generate-morrowise-documentation.mjs';
import {evaluateDocumentationImpact} from './lib/morrowise-documentation-impact.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  if (process.argv.length !== 2) throw Error('invalid_sync_verification_arguments');
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'system-workflow/registries/morrowise-document-sources.json'), 'utf8'));
  const impact = evaluateDocumentationImpact({registry, collabRoot: path.resolve(root, '..'), inspectGit: true});
  if (impact.decision !== 'allow') throw Error(`documentation_impact_blocked:${impact.findings.join(',')}`);
  const bundle = createBundle({registry});
  const checked = writeLocalOutputs({bundle, registry, check: true});
  console.log(JSON.stringify({synced: true, ...checked, pages: bundle.pages.length,
    impact: impact.decision, payload_fingerprint: bundle.payload_fingerprint, visibility: bundle.visibility}));
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}

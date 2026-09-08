import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import * as documentation from '../generate-morrowise-documentation.mjs';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const equalFingerprints = (left, right) => isObject(left) && isObject(right)
  && Object.keys(left).length === Object.keys(right).length
  && Object.entries(left).every(([key, value]) => isHash(value) && right[key] === value);
const hasFingerprintKeys = (value, keys) => isObject(value)
  && Object.keys(value).length === keys.length && keys.every(key => isHash(value[key]));
function validReview(review, sourceKeys, documentKeys) {
  return isObject(review) && ['no_impact', 'update_required'].includes(review.decision)
    && nonempty(review.reason) && nonempty(review.author) && nonempty(review.reviewer)
    && review.author.trim().toLowerCase() !== review.reviewer.trim().toLowerCase()
    && /^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(review.reviewed_at ?? '')
    && Array.isArray(review.evidence_refs) && review.evidence_refs.length > 0
    && review.evidence_refs.every(ref => nonempty(ref) && ref.startsWith('$COLLAB/') && !ref.includes('..'))
    && hasFingerprintKeys(review.source_fingerprints, sourceKeys)
    && hasFingerprintKeys(review.document_fingerprints, documentKeys);
}

/** Read only explicitly registered, regular UTF-8 source files; never runtime auth. */
function readSource(ref, collabRoot, cache) {
  if (cache.has(ref)) return cache.get(ref);
  if (typeof ref !== 'string' || !ref.startsWith('$COLLAB/')) throw Error('unsafe_source_ref');
  const relative = ref.slice('$COLLAB/'.length);
  const parts = relative.split('/');
  if (parts.some(part => !part || part === '.' || part === '..') || /[\\\x00-\x1f]/.test(relative)
    || parts.some(part => /^(?:\.env(?:\..*)?|\.git|\.ssh|\.aws|\.credentials|secrets?|credentials?|auth(?:\.json)?|runtime-auth|raw-logs?)$/i.test(part))) {
    throw Error('unsafe_source_ref');
  }
  let current = fs.realpathSync(collabRoot);
  for (const part of parts) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw Error('symlink_source_ref');
  }
  const stat = fs.statSync(current);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw Error('invalid_source_file');
  const bytes = fs.readFileSync(current);
  const body = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  if (body.includes('\0')) throw Error('binary_source_file');
  const result = {body, fingerprint: digest(bytes), filename: current, relative};
  cache.set(ref, result);
  return result;
}

/** Frozen phase-two corpus gate, not an admission system for every project file.
 * Fingerprints describe the working source, not merged/deployed/activated state.
 * An independent reviewer must assess the semantic truth of no-impact evidence.
 */
export function evaluateDocumentationImpact({registry, collabRoot, inspectGit = false, baselineRegistry = undefined}) {
  const findings = [], mappings = [], cache = new Map(), ids = new Set(), covered = new Set();
  let baselineState = baselineRegistry ? 'supplied_baseline' : 'registry_seed';
  const result = () => ({decision: findings.length ? 'blocked' : 'allow', scope: 'registered_manual_corpus',
    state_basis: 'working_source_fingerprints', baseline_state: baselineState, deployment_state: 'not_assessed', findings, mappings});
  if (registry?.scope_version !== 'manual-local-v2') {
    findings.push('phase2_mapping_contract_required');
    return result();
  }
  if (!Array.isArray(registry.records) || !registry.records.length
    || !Array.isArray(registry.capability_mappings) || !registry.capability_mappings.length
    || !Array.isArray(registry.impact_reviews)) {
    findings.push('mapping_contract_missing');
    return result();
  }
  if (inspectGit && !baselineRegistry) {
    const tracked = spawnSync('git', ['ls-tree', '--name-only', 'HEAD', '--', 'system-workflow/registries/morrowise-document-sources.json'],
      {cwd: path.join(collabRoot, 'harness-mc'), encoding: 'utf8', timeout: 10000});
    if (tracked.status !== 0) { findings.push('committed_registry_unreadable'); return result(); }
    if (!tracked.stdout.trim()) {
      // First creation has no committed registry yet; this seed still needs the
      // initial independent corpus review before any completion claim.
      baselineState = 'initial_uncommitted_seed';
    } else {
    const committed = spawnSync('git', ['show', 'HEAD:system-workflow/registries/morrowise-document-sources.json'],
      {cwd: path.join(collabRoot, 'harness-mc'), encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024});
    try {
      if (committed.status !== 0) throw Error('unreadable');
      const candidate = JSON.parse(committed.stdout);
      if (candidate.scope_version === 'manual-local-v2') { baselineRegistry = candidate; baselineState = 'committed_v2'; }
      else if (candidate.scope_version === 'first-chapter-local-v1') baselineState = 'phase1_migration_seed';
      else throw Error('invalid_version');
    } catch {
      findings.push('committed_registry_unreadable');
      return result();
    }
    }
  }
  const baselineMappings = new Map((baselineRegistry?.capability_mappings ?? []).map(mapping => [mapping.id, mapping]));
  if (baselineRegistry?.scope_version === 'manual-local-v2') {
    const currentIds = registry.capability_mappings.map(mapping => mapping.id).sort();
    if (JSON.stringify([...baselineMappings.keys()].sort()) !== JSON.stringify(currentIds)) findings.push('frozen_mapping_set_changed');
  }
  const records = new Map();
  for (const record of registry.records) {
    if (!nonempty(record.id) || records.has(record.id)) findings.push('duplicate_or_invalid_record');
    records.set(record.id, record);
  }
  const reviews = new Map();
  for (const review of registry.impact_reviews) {
    if (!isObject(review) || !nonempty(review.mapping_id) || reviews.has(review.mapping_id)) {
      findings.push('duplicate_or_invalid_review');
      continue;
    }
    reviews.set(review.mapping_id, review);
  }
  for (const mapping of registry.capability_mappings) {
    const id = mapping?.id;
    try {
      if (!nonempty(id) || ids.has(id)) throw Error('duplicate_or_invalid_mapping');
      ids.add(id);
      if (!registry.records.some(record => record.chapter_id === id)) throw Error('unknown_capability');
      if (!Array.isArray(mapping.source_refs) || !mapping.source_refs.length
        || !isObject(mapping.document_fingerprints) || !Object.keys(mapping.document_fingerprints).length) throw Error('empty_mapping');
      const sources = {}, documents = {}, changedSources = [], changedDocuments = [];
      const baselineMapping = baselineMappings.get(id);
      if (baselineMapping && (JSON.stringify(baselineMapping.source_refs.map(ref => ref.path).sort()) !== JSON.stringify(mapping.source_refs.map(ref => ref.path).sort())
        || JSON.stringify(Object.keys(baselineMapping.document_fingerprints).sort()) !== JSON.stringify(Object.keys(mapping.document_fingerprints).sort()))) throw Error('frozen_mapping_members_changed');
      const previousReviews = (baselineRegistry?.impact_reviews ?? []).filter(review => review.mapping_id === id);
      if (previousReviews.length > 1) throw Error('invalid_committed_review');
      const previousReview = previousReviews[0];
      if (previousReview && !validReview(previousReview, mapping.source_refs.map(ref => ref.path), Object.keys(mapping.document_fingerprints))) throw Error('invalid_committed_review');
      for (const source of mapping.source_refs) {
        if (!isObject(source) || !isHash(source.fingerprint) || Object.hasOwn(sources, source.path)) throw Error('invalid_or_duplicate_source');
        const actual = readSource(source.path, collabRoot, cache);
        sources[source.path] = actual.fingerprint;
        const baselineHash = previousReview?.source_fingerprints[source.path]
          ?? baselineMapping?.source_refs.find(ref => ref.path === source.path)?.fingerprint ?? source.fingerprint;
        if (actual.fingerprint !== baselineHash) changedSources.push(source.path);
      }
      for (const [recordId, baseline] of Object.entries(mapping.document_fingerprints)) {
        const record = records.get(recordId);
        if (!record || !isHash(baseline) || !nonempty(record.chapter_id)) throw Error('unknown_or_invalid_document');
        const actual = readSource(record.human_content_ref, collabRoot, cache);
        documents[recordId] = digest(documentation.extractChapter(actual.body, record.chapter_id));
        if (documents[recordId] !== (previousReview?.document_fingerprints[recordId]
          ?? baselineMapping?.document_fingerprints[recordId] ?? baseline)) changedDocuments.push(recordId);
        covered.add(recordId);
      }
      const entry = {id, changed_sources: changedSources, changed_documents: changedDocuments,
        source_fingerprints: sources, document_fingerprints: documents, review_state: 'not_required'};
      mappings.push(entry);
      const review = reviews.get(id);
      if (changedSources.length && !review) throw Error('review_missing');
      if (review) {
        if (!validReview(review, Object.keys(sources), Object.keys(documents))
          || !equalFingerprints(review.source_fingerprints, sources)
          || !equalFingerprints(review.document_fingerprints, documents)) throw Error('invalid_or_stale_review');
        if (changedSources.length && review.decision === 'update_required'
          && changedDocuments.length !== Object.keys(documents).length) throw Error('document_not_updated');
        entry.review_state = review.decision;
      }
    } catch (error) {
      // Avoid echoing filesystem paths or source contents from low-level errors.
      const known = ['unsafe_source_ref','symlink_source_ref','invalid_source_file','binary_source_file',
        'duplicate_or_invalid_mapping','empty_mapping','invalid_or_duplicate_source','unknown_or_invalid_document',
        'review_missing','invalid_or_stale_review','document_not_updated','unknown_capability','frozen_mapping_members_changed','invalid_committed_review'];
      findings.push(`${id ?? 'unknown'}:${known.includes(error.message) ? error.message : 'source_or_chapter_unreadable'}`);
    }
  }
  for (const id of reviews.keys()) if (!ids.has(id)) findings.push(`${id}:unknown_review_mapping`);
  for (const record of records.values()) if (!covered.has(record.id)) findings.push(`${record.id}:document_mapping_missing`);
  if (inspectGit) {
    // Read-only diagnostic of the registered files. Unrelated dirty work is not scope.
    const repos = new Map();
    for (const {relative} of cache.values()) {
      const [repo, ...parts] = relative.split('/');
      if (!repos.has(repo)) repos.set(repo, []);
      repos.get(repo).push(parts.join('/'));
    }
    for (const [repo, files] of repos) {
      const check = spawnSync('git', ['diff', '--name-only', '-z', 'HEAD', '--', ...files],
        {cwd: path.join(collabRoot, repo), encoding: 'utf8', timeout: 10000});
      if (check.status !== 0) findings.push(`${repo}:registered_git_inspection_failed`);
    }
  }
  return result();
}

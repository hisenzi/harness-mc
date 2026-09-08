#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const HARNESS_ROOT = path.resolve(SCRIPT_DIR, '..');
const COLLAB_ROOT = process.env.COLLAB_ROOT ? path.resolve(process.env.COLLAB_ROOT) : path.resolve(HARNESS_ROOT, '..');
const MAX_SOURCE_BYTES = 256 * 1024;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const DOCUMENT_VERSION_RE = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;
const ROLES = new Set(['canonical', 'protocol', 'schema', 'detail', 'runbook', 'evidence', 'generated', 'mirror', 'human_guide']);
const LAYERS = new Set(['entry', 'rules', 'capabilities', 'runtime', 'governance']);
const RELATIONS = new Set(['canonical', 'derived_from', 'detail', 'evidence']);
const CHAPTER_IDS = ['entry', 'collaboration', 'execution', 'delivery', 'documentation', 'troubleshooting'];
const HUMAN_TARGETS = new Map([['', 'README.md'], ['entry', '01-entry.md'], ['rules', '02-rules.md'], ['capabilities', '03-capabilities.md'], ['runtime', '04-runtime.md'], ['governance', '05-governance.md']]);

const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex');
const normalize = value => String(value).replace(/\r\n?/g, '\n');
const fail = message => { throw new Error(message); };
const text = (value, label) => {
  if (typeof value !== 'string' || value.trim() === '') fail(`registry_invalid:${label}`);
  return value;
};
const assertHash = (value, label) => { if (typeof value !== 'string' || !HASH_RE.test(value)) fail(`registry_invalid:${label}`); };

function assertSafeRef(ref, label = 'source_ref') {
  text(ref, label);
  if (!ref.startsWith('$COLLAB/')) fail(`unsafe_source:${label}`);
  const relative = ref.slice('$COLLAB/'.length);
  if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) fail(`unsafe_source:${label}`);
  if (/(^|\/)(?:\.env|secrets?|credentials?|tokens?|runtime-auth|auth)(?:\.|\/|$)/i.test(relative)) fail(`unsafe_source:${label}`);
  return relative;
}

function assertSlug(slug) {
  if (typeof slug !== 'string' || !/^(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(slug)) fail(`unsafe_slug:${slug}`);
}

function validateRegistry(registry) {
  if (!registry || typeof registry !== 'object' || Array.isArray(registry)) fail('registry_invalid:root');
  if (registry.schema_version !== '1.0' || !['first-chapter-local-v1', 'manual-local-v2'].includes(registry.scope_version)) fail('registry_invalid:version');
  const v2 = registry.scope_version === 'manual-local-v2';
  text(registry.registry_ref, 'registry_ref');
  if (!DATE_RE.test(registry.reviewed_at || '')) fail('registry_invalid:reviewed_at');
  if (!Array.isArray(registry.source_allowlist) || registry.source_allowlist.length === 0) fail('registry_invalid:source_allowlist');
  const allowed = new Set();
  for (const ref of registry.source_allowlist) {
    assertSafeRef(ref, 'source_allowlist');
    allowed.add(ref);
  }
  if (!Array.isArray(registry.public_allowlist) || registry.public_allowlist.length !== 0) fail('public_release_not_authorized');
  if (!Array.isArray(registry.records) || registry.records.length === 0) fail('registry_invalid:records');
  if (!Array.isArray(registry.human_navigation) || registry.human_navigation.length === 0) fail('registry_invalid:human_navigation');
  for (const field of ['capability_mappings', 'impact_reviews']) {
    if (field in registry && (!Array.isArray(registry[field]) || registry[field].some(item => !item || typeof item !== 'object' || Array.isArray(item)))) fail(`registry_invalid:${field}`);
  }
  const recordIds = new Set();
  for (const record of registry.records) {
    if (!record || typeof record !== 'object') fail('registry_invalid:record');
    for (const field of ['id', 'system_id', 'title', 'owner', 'task_anchor', 'architecture_summary', 'human_summary', 'human_content_ref', 'summary_reviewed_by']) text(record[field], field);
    if (recordIds.has(record.id)) fail(`duplicate_record:${record.id}`);
    recordIds.add(record.id);
    if (record.record_kind !== 'document' || record.system_id !== 'morrowise' || !LAYERS.has(record.architecture_layer) || !ROLES.has(record.document_role) || record.audience !== 'both' || !(v2 ? ['active', 'conditional'].includes(record.status) : record.status === 'active') || record.visibility !== 'local_only' || record.write_policy !== 'manual' || record.fingerprint_policy !== 'full_content' || record.summary_impact !== 'human') fail(`registry_invalid:${record.id}`);
    if (v2 && (record.document_role !== 'human_guide' || !CHAPTER_IDS.includes(record.chapter_id) || typeof record.document_version !== 'string' || !DOCUMENT_VERSION_RE.test(record.document_version))) fail(`registry_invalid:${record.id}:chapter_contract`);
    if (!Array.isArray(record.member_globs) || record.member_globs.length || !Array.isArray(record.generated_targets) || record.generated_targets.length) fail(`registry_invalid:${record.id}:targets`);
    if (!Array.isArray(record.verifiers) || record.verifiers.length === 0 || !Array.isArray(record.fingerprint_fields) || record.fingerprint_fields.length || !Array.isArray(record.supersedes) || record.supersedes.length || !Array.isArray(record.superseded_by) || record.superseded_by.length) fail(`registry_invalid:${record.id}:contract`);
    for (const dateField of ['summary_reviewed_at', 'last_verified_at']) if (!DATE_RE.test(record[dateField] || '')) fail(`registry_invalid:${record.id}:${dateField}`);
    assertHash(record.summary_reviewed_source_fingerprint, `${record.id}:summary_reviewed_source_fingerprint`);
    if (!Array.isArray(record.source_refs) || record.source_refs.length !== 1) fail(`registry_invalid:${record.id}:source_refs`);
    for (const ref of record.source_refs) {
      const rel = assertSafeRef(ref.path, `${record.id}:source_ref`);
      if (!RELATIONS.has(ref.relation) || !HASH_RE.test(ref.fingerprint) || !registry.source_allowlist.includes(ref.path)) fail(`registry_invalid:${record.id}:source_ref_contract`);
      void rel;
    }
    if (record.human_content_ref !== record.source_refs[0].path) fail(`registry_invalid:${record.id}:human_content_ref`);
  }
  const slugs = new Set();
  const navIds = new Set();
  const contentRecords = new Set();
  for (const nav of registry.human_navigation) {
    for (const field of ['id', 'title', 'kind']) text(nav[field], `navigation:${field}`);
    assertSlug(nav.slug);
    if (slugs.has(nav.slug)) fail(`duplicate_slug:${nav.slug}`);
    slugs.add(nav.slug);
    if (navIds.has(nav.id)) fail(`duplicate_navigation:${nav.id}`);
    navIds.add(nav.id);
    if (!['home', 'index', 'content'].includes(nav.kind)) fail(`registry_invalid:navigation:${nav.kind}`);
    if (v2 && nav.kind !== 'content') {
      if (!HUMAN_TARGETS.has(nav.slug) || nav.kind !== (nav.slug === '' ? 'home' : 'index') || 'record_id' in nav) fail(`registry_invalid:navigation:${nav.slug}`);
      if (!Array.isArray(nav.record_ids) || nav.record_ids.length === 0 || new Set(nav.record_ids).size !== nav.record_ids.length) fail(`registry_invalid:navigation:record_ids`);
      for (const id of nav.record_ids) if (!recordIds.has(id)) fail(`unknown_record:${id}`);
    } else {
      text(nav.record_id, 'navigation:record_id');
      if (!recordIds.has(nav.record_id)) fail(`unknown_record:${nav.record_id}`);
      if (v2) {
        const record = registry.records.find(r => r.id === nav.record_id);
        if ('record_ids' in nav || nav.slug !== `capabilities/${record.chapter_id}` || contentRecords.has(nav.record_id)) fail(`registry_invalid:navigation:content`);
        contentRecords.add(nav.record_id);
      }
    }
  }
  if (v2 && (registry.records.length !== 6 || new Set(registry.records.map(r => r.chapter_id)).size !== 6 || new Set(registry.records.map(r => r.human_content_ref)).size !== 1 || registry.source_allowlist.length !== 1 || registry.human_navigation.length !== 12 || contentRecords.size !== 6 || [...HUMAN_TARGETS.keys()].some(slug => !slugs.has(slug)))) fail('registry_invalid:chapter_coverage_navigation');
  return { registry, allowed, recordIds };
}

// Sentinels are standalone lines; examples inside fenced code are plain content.
function chapterMap(body) {
  const lines = normalize(body).split('\n');
  const chapters = new Map();
  let active = null, fence = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (delimiter && delimiter[1][0] === fence.char && delimiter[1].length >= fence.length && delimiter[2].trim() === '') fence = null;
      continue;
    }
    if (delimiter) { fence = { char: delimiter[1][0], length: delimiter[1].length }; continue; }
    if (!/<!--\s*chapter:/.test(line)) continue;
    const marker = line.match(/^<!-- chapter:(start|end) ([a-z0-9-]+) -->$/);
    if (!marker || !CHAPTER_IDS.includes(marker[2])) fail('chapter_marker:invalid');
    const [, kind, id] = marker;
    if (kind === 'start') {
      if (active || chapters.has(id)) fail(`chapter_marker:duplicate_or_nested:${id}`);
      active = { id, start: i + 1 };
    } else {
      if (!active || active.id !== id) fail(`chapter_marker:unmatched_end:${id}`);
      const content = lines.slice(active.start, i).join('\n') + (i > active.start ? '\n' : '');
      if (!content.trim()) fail(`chapter_marker:empty:${id}`);
      chapters.set(id, content); active = null;
    }
  }
  if (active) fail(`chapter_marker:missing_end:${active.id}`);
  return chapters;
}

export function extractChapter(body, id) {
  if (!CHAPTER_IDS.includes(id)) fail(`chapter_marker:unknown_id:${id}`);
  const value = chapterMap(body).get(id);
  if (value === undefined) fail(`chapter_missing:${id}`);
  return value;
}

function proseLines(body) {
  let fence = null;
  return normalize(body).split('\n').filter(line => {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (delimiter && delimiter[1][0] === fence.char && delimiter[1].length >= fence.length && delimiter[2].trim() === '') fence = null;
      return false;
    }
    if (delimiter) { fence = { char: delimiter[1][0], length: delimiter[1].length }; return false; }
    return true;
  });
}

export function validateCorpus(body, registry) {
  const chapters = chapterMap(body);
  const records = registry?.records;
  if (!Array.isArray(records) || records.length !== 6 || chapters.size !== 6 || CHAPTER_IDS.some(id => !chapters.has(id))) fail('chapter_missing:corpus');
  for (const record of records) {
    const content = chapters.get(record.chapter_id);
    if (content === undefined) fail(`chapter_missing:${record.chapter_id}`);
    const lines = proseLines(content);
    const versions = lines.filter(line => /^文件版本：/.test(line));
    if (versions.length !== 1 || versions[0].match(/^文件版本：\*\*([^\s*]+)\*\*/)?.[1] !== record.document_version) fail(`chapter_version_mismatch:${record.chapter_id}`);
    const histories = lines.map((line, i) => /^## 版本歷史\s*$/.test(line) ? i : -1).filter(i => i >= 0);
    const latest = histories.length === 1 && lines.slice(histories[0] + 1).find(line => /^### /.test(line));
    if (!latest || latest.match(/^### (\S+) — \d{4}-\d{2}-\d{2}｜.+$/)?.[1] !== record.document_version) fail(`chapter_history_version_mismatch:${record.chapter_id}`);
    const maintenanceHeadings = lines.map((line, i) => /^## 版本與維護\s*$/.test(line) ? i : -1).filter(i => i >= 0);
    const afterMaintenance = maintenanceHeadings.length === 1 ? lines.slice(maintenanceHeadings[0] + 1) : [];
    const nextSection = afterMaintenance.findIndex(line => /^## /.test(line));
    const maintenance = nextSection < 0 ? afterMaintenance : afterMaintenance.slice(0, nextSection);
    const currentVersions = maintenance.filter(line => /^\|\s*目前文件版本\s*\|/.test(line) || /文件 ID `[^`]+`、目前 /.test(line)).map(line =>
      line.match(/^\|\s*目前文件版本\s*\|\s*`([^`]+)`/)?.[1] ?? line.match(/文件 ID `[^`]+`、目前 (v[0-9A-Za-z.+-]+)(?=[；，。\s]|$)/)?.[1]);
    if (currentVersions.length !== 1 || currentVersions[0] !== record.document_version) fail(`chapter_maintenance_version_mismatch:${record.chapter_id}`);
  }
  return true;
}

function readSource(collabRoot, ref) {
  const relative = assertSafeRef(ref);
  const file = path.resolve(collabRoot, relative);
  const root = path.resolve(collabRoot);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) fail(`unsafe_source:${ref}`);
  const relativeParts = path.relative(root, file).split(path.sep).filter(Boolean);
  let cursor = root;
  for (const part of relativeParts) {
    cursor = path.join(cursor, part);
    const component = fs.lstatSync(cursor, { throwIfNoEntry: false });
    if (component?.isSymbolicLink()) fail(`symlink_source:${ref}`);
  }
  const stat = fs.lstatSync(file, { throwIfNoEntry: false });
  if (!stat) fail(`source_missing:${ref}`);
  if (!stat.isFile()) fail(`source_not_file:${ref}`);
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(file);
  if (realFile !== realRoot && !realFile.startsWith(`${realRoot}${path.sep}`)) fail(`unsafe_source:${ref}`);
  if (stat.size > MAX_SOURCE_BYTES) fail(`oversized_source:${ref}`);
  const bytes = fs.readFileSync(file);
  if (bytes.includes(0)) fail(`binary_source:${ref}`);
  return { file, body: normalize(bytes.toString('utf8')) };
}

function sourcePage(record, nav, body, sourceRef, sourceFingerprint) {
  const contentFingerprint = digest(body);
  return {
    slug: nav.slug,
    title: nav.title,
    kind: nav.kind,
    body,
    content_fingerprint: contentFingerprint,
    visibility: record.visibility,
    source_ref: sourceRef,
    source_fingerprint: sourceFingerprint,
    document_role: record.document_role,
    write_policy: record.write_policy,
    task_anchor: record.task_anchor,
    freshness: 'fresh',
    last_verified_at: record.last_verified_at,
  };
}

function expectedPageBody(nav, sourceBody, registry) {
  if (registry.scope_version === 'manual-local-v2') {
    if (nav.kind === 'content') return extractChapter(sourceBody, registry.records.find(r => r.id === nav.record_id).chapter_id);
    const items = nav.record_ids.map(id => {
      const record = registry.records.find(r => r.id === id);
      return `- [${record.title}](/docs/capabilities/${record.chapter_id}) — ${record.human_summary}\n  - 版本：${record.document_version}；狀態：${record.status}；來源：\`${record.human_content_ref}\`；task：\`${record.task_anchor}\``;
    });
    return `# ${nav.title}\n\n本頁為 registry 人工審核摘要的唯讀投影，完整操作見各能力章。\n\n${items.join('\n\n')}\n`;
  }
  if (nav.kind === 'content') return sourceBody;
  if (nav.kind === 'home') return '# MorroWise 使用說明書\n\n從能力入口開始。';
  return '## 能力操作指南\n\n選擇一項已登記的能力。';
}

function sourceContext(registry, collabRoot) {
  const { allowed } = validateRegistry(registry);
  const sourceCache = new Map();
  for (const record of registry.records) {
    const ref = record.source_refs[0];
    if (!allowed.has(ref.path)) fail(`source_not_allowlisted:${ref.path}`);
    if (!sourceCache.has(ref.path)) sourceCache.set(ref.path, readSource(collabRoot, ref.path));
    const source = sourceCache.get(ref.path);
    const fp = digest(source.body);
    if (fp !== ref.fingerprint) fail(`source_fingerprint_mismatch:${record.id}`);
    if (record.summary_reviewed_source_fingerprint !== fp) fail(`review_fingerprint_mismatch:${record.id}`);
  }
  if (registry.scope_version === 'manual-local-v2') validateCorpus([...sourceCache.values()][0].body, registry);
  return sourceCache;
}

function buildFromContext(registry, sourceCache) {
  const byId = new Map(registry.records.map(record => [record.id, record]));
  const pages = registry.human_navigation.map(nav => {
    const v2 = registry.scope_version === 'manual-local-v2';
    const record = byId.get(nav.record_id || nav.record_ids?.[0]);
    const source = sourceCache.get(record.source_refs[0].path);
    const page = sourcePage(record, nav, expectedPageBody(nav, source.body, registry), record.source_refs[0].path, digest(source.body));
    if (v2) {
      Object.assign(page, { record_id: nav.kind === 'content' ? record.id : null, chapter_id: nav.kind === 'content' ? record.chapter_id : null, document_version: nav.kind === 'content' ? record.document_version : null, content_hash: page.content_fingerprint, status: nav.kind === 'content' ? record.status : 'summary' });
      if (nav.kind !== 'content') {
        page.record_ids = [...nav.record_ids];
        page.records = nav.record_ids.map(id => {
          const linked = byId.get(id);
          return { id, document_version: linked.document_version, source_ref: linked.human_content_ref, source_fingerprint: digest(sourceCache.get(linked.human_content_ref).body), status: linked.status };
        });
      }
    }
    return page;
  });
  const bundle = {
    schema_version: '1.0', scope_version: registry.scope_version, registry_ref: registry.registry_ref,
    registry_fingerprint: digest(registry), source_fingerprints: Object.fromEntries([...sourceCache].map(([ref, source]) => [ref, digest(source.body)])),
    human_navigation: registry.human_navigation.map(nav => ({ ...nav })), pages, drift_state: 'fresh',
    visibility: 'local_only', write_boundary: 'read_only', generated_at: registry.reviewed_at,
  };
  for (const field of ['capability_mappings', 'impact_reviews']) if (field in registry) bundle[field] = JSON.parse(JSON.stringify(registry[field]));
  bundle.payload_fingerprint = digest({ ...bundle });
  return bundle;
}

export function createBundle({ registry, collabRoot = COLLAB_ROOT, mode = 'local' } = {}) {
  if (mode !== 'local') fail('public_release_not_authorized:local_only');
  return buildFromContext(registry, sourceContext(registry, collabRoot));
}

export function validateBundle(bundle, { registry, collabRoot = COLLAB_ROOT, mode = 'local' } = {}) {
  if (!bundle || bundle.drift_state !== 'fresh') fail('bundle_not_fresh');
  if (mode === 'public' || bundle.visibility !== 'local_only') fail('visibility_denied');
  validateRegistry(registry);
  if (bundle.schema_version !== registry.schema_version || bundle.scope_version !== registry.scope_version || bundle.registry_ref !== registry.registry_ref) fail('bundle_boundary_mismatch');
  if (bundle.write_boundary !== 'read_only' || bundle.generated_at !== registry.reviewed_at) fail('bundle_boundary_mismatch');
  if (bundle.registry_fingerprint !== digest(registry)) fail('registry_fingerprint_mismatch');
  const { payload_fingerprint: _payloadFingerprint, ...unsignedBundle } = bundle;
  const expected = digest(unsignedBundle);
  if (bundle.payload_fingerprint !== expected) fail('payload_fingerprint_mismatch');
  if (!Array.isArray(bundle.pages) || stable(bundle.human_navigation) !== stable(registry.human_navigation)) fail('navigation_mismatch');
  if (bundle.pages.length !== registry.human_navigation.length) fail('page_metadata:page_count');
  const expectedBundle = buildFromContext(registry, sourceContext(registry, collabRoot));
  if (stable(bundle.source_fingerprints) !== stable(expectedBundle.source_fingerprints)) fail('source_map_mismatch');
  const expectedSlugs = registry.human_navigation.map(nav => nav.slug);
  if (stable(bundle.pages.map(page => page.slug)) !== stable(expectedSlugs)) fail('page_set_mismatch');
  for (const [index, page] of bundle.pages.entries()) {
    if (!page || typeof page !== 'object' || typeof page.body !== 'string') fail('page_metadata:body');
    const expectedPage = expectedBundle.pages[index];
    for (const field of ['title', 'kind', 'visibility', 'source_ref', 'source_fingerprint', 'document_role', 'write_policy', 'task_anchor', 'freshness', 'last_verified_at']) {
      if (typeof page[field] !== 'string' || page[field].length === 0) fail(`page_metadata:${page.slug || 'home'}:${field}`);
    }
    if (page.body !== expectedPage.body) fail(`source_lineage_mismatch:${page.slug || 'home'}`);
    if (page.content_fingerprint !== digest(normalize(page.body))) fail(`content_fingerprint_mismatch:${page.slug || 'home'}`);
    if (stable(page) !== stable(expectedPage)) fail(`page_metadata:${page.slug || 'home'}`);
  }
  if (stable(bundle) !== stable(expectedBundle)) fail('bundle_boundary_mismatch');
  return true;
}

function localTargets(bundle) {
  const targets = [];
  if (bundle.scope_version === 'manual-local-v2') {
    for (const [slug, name] of HUMAN_TARGETS) {
      const page = bundle.pages.find(p => p.slug === slug && p.kind !== 'content');
      if (!page) fail(`output_missing_summary:${slug}`);
      targets.push({ relative: `human/${name}`, content: `<!-- Generated from the approved local registry. Do not edit. -->\n\n${page.body}` });
    }
  }
  // The bundle is the consumer's commit point and is published last.
  targets.push({ relative: 'bundle.json', content: `${JSON.stringify(bundle, null, 2)}\n` });
  return targets;
}

function assertOutputPath(outputRoot, collabRoot, fsApi) {
  const expected = path.resolve(collabRoot, 'harness-mc/.tmp/morrowise-docs');
  if (path.resolve(outputRoot) !== expected) fail('unsafe_output_root');
  let cursor = path.resolve(collabRoot);
  for (const part of path.relative(cursor, expected).split(path.sep)) {
    cursor = path.join(cursor, part);
    if (fsApi.lstatSync(cursor, { throwIfNoEntry: false })?.isSymbolicLink()) fail('symlink_output');
  }
}

export function writeLocalOutputs({ bundle, registry, collabRoot = COLLAB_ROOT, outputRoot = path.join(HARNESS_ROOT, '.tmp/morrowise-docs'), check = false, fsApi = fs } = {}) {
  validateBundle(bundle, { registry, collabRoot, mode: 'local' });
  assertOutputPath(outputRoot, collabRoot, fsApi);
  const targets = localTargets(bundle).map(target => {
    const file = path.join(outputRoot, target.relative);
    const directory = fsApi.lstatSync(path.dirname(file), { throwIfNoEntry: false });
    const stat = fsApi.lstatSync(file, { throwIfNoEntry: false });
    if (directory?.isSymbolicLink() || stat?.isSymbolicLink() || (stat && !stat.isFile())) fail('unsafe_output_target');
    const previous = stat ? fsApi.readFileSync(file, 'utf8') : null;
    return { ...target, file, previous };
  });
  const changed = targets.filter(target => target.previous !== target.content);
  if (check) {
    if (changed.length) fail(`output_drift:${changed.map(t => t.relative).join(',')}`);
    return { save_count: 0, hasChange: false, checked: targets.length };
  }
  if (!changed.length) return { save_count: 0, hasChange: false };
  fsApi.mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  const stage = fsApi.mkdtempSync(path.join(outputRoot, '.publish-'));
  fsApi.chmodSync(stage, 0o700);
  const published = [];
  let rollbackFailed = false;
  try {
    for (const [i, target] of changed.entries()) {
      target.pending = path.join(stage, `new-${i}`);
      target.backup = path.join(stage, `old-${i}`);
      fsApi.writeFileSync(target.pending, target.content, { flag: 'wx', mode: 0o600 });
      if (target.previous !== null) fsApi.writeFileSync(target.backup, target.previous, { flag: 'wx', mode: 0o600 });
    }
    for (const target of changed) {
      fsApi.mkdirSync(path.dirname(target.file), { recursive: true, mode: 0o700 });
      fsApi.renameSync(target.pending, target.file);
      published.push(target);
    }
  } catch (error) {
    const failures = [];
    for (const target of published.reverse()) {
      try {
        if (target.previous === null) fsApi.unlinkSync(target.file);
        else fsApi.renameSync(target.backup, target.file);
      } catch (restoreError) { failures.push(`${target.relative}:${restoreError.message}`); }
    }
    if (failures.length) {
      rollbackFailed = true;
      fail(`publish_failed:${error.message};rollback_failed:${failures.join(',')};retained_backup:${path.basename(stage)}`);
    }
    throw error;
  } finally {
    if (!rollbackFailed) {
      for (const name of fsApi.readdirSync(stage)) fsApi.unlinkSync(path.join(stage, name));
      fsApi.rmdirSync(stage);
    }
  }
  return { save_count: changed.length, hasChange: true };
}

function loadRegistry() {
  const registryPath = path.join(HARNESS_ROOT, 'system-workflow/registries/morrowise-document-sources.json');
  return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
}

async function main() {
  try {
    const args = new Set();
    for (const arg of process.argv.slice(2)) {
      if (arg === '--public') fail('public_release_not_authorized');
      if (!['--local', '--check', '--self-test', '--changed-only'].includes(arg)) fail(`unknown_flag:${arg}`);
      if (args.has(arg)) fail(`duplicate_flag:${arg}`);
      args.add(arg);
    }
    if (args.has('--check') && args.has('--changed-only')) fail('conflicting_flags:check_changed-only');
    if (args.has('--self-test')) {
      if (args.size !== 1) fail('conflicting_flags:self-test');
      const sample = '<!-- chapter:start entry -->\nexample\n<!-- chapter:end entry -->\n';
      if (extractChapter(sample, 'entry') !== 'example\n') fail('self_test_failed:extraction');
      let rejected = 0;
      for (const invalid of [sample + sample, sample.replace('chapter:end entry', 'chapter:end execution')]) {
        try { extractChapter(invalid, 'entry'); } catch { rejected++; }
      }
      if (rejected !== 2) fail('self_test_failed:negative');
      console.log(JSON.stringify({ passed: 3, scope: 'chapter_parser' }));
    } else {
      const registry = loadRegistry();
      if (registry.scope_version === 'manual-local-v2') {
        const {evaluateDocumentationImpact} = await import('./lib/morrowise-documentation-impact.mjs');
        const impact = evaluateDocumentationImpact({registry, collabRoot: COLLAB_ROOT, inspectGit: true});
        if (impact.decision !== 'allow') {
          const error = new Error(`documentation_impact_blocked:${impact.findings.join(',')}`);
          error.exitCode = 2;
          throw error;
        }
      }
      const bundle = createBundle({ registry, mode: 'local' });
      console.log(JSON.stringify(writeLocalOutputs({ bundle, registry, check: args.has('--check') })));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = error.exitCode ?? 1;
  }
}

// Do not top-level await: the impact module reuses this module's chapter parser.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();

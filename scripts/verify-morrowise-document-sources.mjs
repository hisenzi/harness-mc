#!/usr/bin/env node
// JV-36 first-chapter slice: independent expectations, isolated real files.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';

const target = new URL('./generate-morrowise-documentation.mjs', import.meta.url);
const api = fs.existsSync(target) ? await import(target.href) : {};
const hash = value => crypto.createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');
const stable = value => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const digest = value => crypto.createHash('sha256').update(stable(value)).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const body = '# 多人協作\n\n## 同檔 ownership\n\n`generated_at` 與 routing_and_decision_evidence 完整保留。\n\n## 交接\n\n原 writer 明確交還後，由獨立檢查者驗收。\n';
const sourceRef = '$COLLAB/notyet-harness/000_Agent/docs/morrowise/OPERATOR-GUIDE.md';

function fixture() {
  assert.equal(typeof api.createBundle, 'function', 'JV-36 createBundle must exist before the source slice can pass');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'morrowise-docs-fixture-'));
  const file = path.join(root, sourceRef.slice('$COLLAB/'.length));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  const record = {
    id: 'operator-guide-collaboration', record_kind: 'document', system_id: 'morrowise',
    title: '多人協作', architecture_layer: 'capabilities', document_role: 'human_guide',
    audience: 'both', status: 'active', visibility: 'local_only',
    source_refs: [{ path: sourceRef, relation: 'canonical', fingerprint: hash(body) }],
    member_globs: [], generated_targets: [], owner: 'Vincent / JV-36',
    task_anchor: 'morrowise/document-source-registry-and-human-sync', write_policy: 'manual',
    verifiers: ['node scripts/verify-morrowise-document-sources.mjs'],
    fingerprint_policy: 'full_content', fingerprint_fields: [], summary_impact: 'human',
    architecture_summary: '協作分工、共用檔案 ownership 與獨立驗收。', human_summary: '分工、同檔交接與独立驗收。',
    human_content_ref: sourceRef, summary_reviewed_source_fingerprint: hash(body),
    summary_reviewed_at: '2026-09-08', summary_reviewed_by: 'fixture reviewer',
    last_verified_at: '2026-09-08', supersedes: [], superseded_by: [],
  };
  const registry = {
    schema_version: '1.0', scope_version: 'first-chapter-local-v1',
    registry_ref: '$COLLAB/harness-mc/system-workflow/registries/morrowise-document-sources.json',
    reviewed_at: '2026-09-08', source_allowlist: [sourceRef], public_allowlist: [],
    records: [record], human_navigation: [
      { id: 'manual-home', slug: '', title: 'MorroWise 說明書', kind: 'home', record_id: record.id },
      { id: 'capabilities', slug: 'capabilities', title: '能力操作指南', kind: 'index', record_id: record.id },
      { id: 'collaboration', slug: 'capabilities/collaboration', title: '多人協作', kind: 'content', record_id: record.id },
    ],
  };
  return { root, file, registry, build: () => api.createBundle({ registry, collabRoot: root, mode: 'local' }) };
}

test('required first-chapter generator API is available', () => {
  assert.equal(typeof api.createBundle, 'function', 'missing deterministic first-chapter producer');
  assert.equal(typeof api.validateBundle, 'function', 'missing fail-closed consumer verifier');
});
test('valid input yields three real pages, exact prose, navigation and source metadata', () => {
  const f = fixture(), b = f.build();
  assert.deepEqual(b.pages.map(p => p.slug), ['', 'capabilities', 'capabilities/collaboration']);
  assert.equal(b.pages[2].body, body);
  assert.equal(b.pages[2].content_fingerprint, hash(body));
  assert.equal(b.pages[2].visibility, 'local_only');
  assert.equal(b.pages[2].source_ref, sourceRef);
  assert.deepEqual(b.human_navigation, f.registry.human_navigation);
  assert.equal(api.validateBundle(b, { mode: 'local', registry: f.registry, collabRoot: f.root }), true);
});
test('two runs are byte-identical and CRLF is normalized without eating underscores', () => {
  const f = fixture(), first = f.build();
  fs.writeFileSync(f.file, body.replace(/\n/g, '\r\n'));
  assert.deepEqual(f.build(), first);
  assert.match(first.pages[2].body, /generated_at/);
  assert.match(first.pages[2].body, /routing_and_decision_evidence/);
});
test('changed source with old review is rejected even though its format is valid', () => {
  const f = fixture(); fs.appendFileSync(f.file, '\n能力已變更。\n');
  assert.throws(f.build, /source_fingerprint_mismatch|review_fingerprint_mismatch/);
});
test('updating only source fingerprint cannot bypass summary review', () => {
  const f = fixture(); fs.appendFileSync(f.file, '\n能力已變更。\n');
  f.registry.records[0].source_refs[0].fingerprint = hash(fs.readFileSync(f.file, 'utf8'));
  assert.throws(f.build, /review_fingerprint_mismatch/);
});
for (const field of ['visibility', 'owner', 'task_anchor', 'architecture_summary', 'summary_reviewed_by', 'human_content_ref']) {
  test(`missing ${field} fails closed`, () => {
    const f = fixture(); delete f.registry.records[0][field]; assert.throws(f.build, /registry_invalid/);
  });
}
test('duplicate record ID and duplicate slug are rejected', () => {
  const f = fixture(); f.registry.records.push(clone(f.registry.records[0]));
  assert.throws(f.build, /duplicate_record/);
  f.registry.records.pop(); f.registry.human_navigation[2].slug = 'capabilities';
  assert.throws(f.build, /duplicate_slug/);
});
test('unknown navigation record and path traversal are rejected', () => {
  const f = fixture(); f.registry.human_navigation[2].record_id = 'missing';
  assert.throws(f.build, /unknown_record/);
  f.registry.human_navigation[2].record_id = 'operator-guide-collaboration';
  f.registry.human_navigation[2].slug = '../private'; assert.throws(f.build, /registry_invalid|unsafe_slug/);
});
test('source outside the explicit allowlist is never read', () => {
  const f = fixture(); f.registry.source_allowlist = [];
  assert.throws(f.build, /registry_invalid|source_not_allowlisted/);
});
test('symlink sources are rejected, including links within the root', () => {
  const f = fixture(), moved = f.file + '.original';
  fs.renameSync(f.file, moved); fs.symlinkSync(moved, f.file);
  assert.throws(f.build, /symlink_source/);
});
test('ancestor symlink sources are rejected before realpath can escape the managed root', () => {
  const f = fixture(), docs = path.dirname(f.file), moved = `${docs}.original`;
  fs.renameSync(docs, moved); fs.symlinkSync(moved, docs);
  assert.throws(f.build, /symlink_source|unsafe_source/);
});
test('binary and oversized sources are rejected before decoding', () => {
  const f = fixture(); fs.writeFileSync(f.file, Buffer.from([0, 1, 2]));
  assert.throws(f.build, /binary_source/);
  fs.writeFileSync(f.file, 'x'.repeat(300000)); assert.throws(f.build, /oversized_source/);
});
test('secret/runtime-auth source paths are rejected even if allowlisted', () => {
  const f = fixture(), ref = '$COLLAB/notyet-harness/.env';
  f.registry.source_allowlist = [ref]; f.registry.records[0].source_refs[0].path = ref;
  f.registry.records[0].human_content_ref = ref;
  assert.throws(f.build, /unsafe_source/);
});
test('public mode cannot fall back to internal/local content', () => {
  const f = fixture(); assert.throws(() => api.createBundle({ registry: f.registry, collabRoot: f.root, mode: 'public' }), /public_release_not_authorized/);
  const b = f.build(); assert.throws(() => api.validateBundle(b, { mode: 'public', registry: f.registry }), /visibility_denied/);
});
test('body tampering and registry/header tampering are detected', () => {
  const f = fixture(), original = f.build(), b = clone(original);
  b.pages[2].body += '\n捏造新政策。';
  assert.throws(() => api.validateBundle(b, { mode: 'local', registry: f.registry, collabRoot: f.root }), /content_fingerprint_mismatch|payload_fingerprint_mismatch|source_lineage_mismatch/);
  const other = clone(original); other.registry_fingerprint = 'a'.repeat(64);
  assert.throws(() => api.validateBundle(other, { mode: 'local', registry: f.registry, collabRoot: f.root }), /registry_fingerprint_mismatch|payload_fingerprint_mismatch/);
});
test('missing page safety metadata is rejected', () => {
  const f = fixture(), b = f.build();
  delete b.pages[2].source_ref;
  const { payload_fingerprint: _old, ...unsigned } = b;
  b.payload_fingerprint = digest(unsigned);
  assert.throws(() => api.validateBundle(b, { mode: 'local', registry: f.registry, collabRoot: f.root }), /page_metadata|source_ref/);
});
test('stale status and missing navigation cannot masquerade as a fresh bundle', () => {
  const f = fixture(), b = f.build(); b.drift_state = 'stale';
  assert.throws(() => api.validateBundle(b, { mode: 'local', registry: f.registry, collabRoot: f.root }), /bundle_not_fresh|payload_fingerprint_mismatch/);
  const c = f.build(); c.human_navigation.pop();
  assert.throws(() => api.validateBundle(c, { mode: 'local', registry: f.registry, collabRoot: f.root }), /navigation_mismatch|payload_fingerprint_mismatch/);
});

function resign(bundle) {
  const { payload_fingerprint: _old, ...unsigned } = bundle;
  bundle.payload_fingerprint = digest(unsigned);
  return bundle;
}

test('recomputed self-hashes cannot approve synthetic body or page-set changes', () => {
  const f = fixture();
  const bodyTampered = clone(f.build());
  bodyTampered.pages[2].body += '\n自我重算不等於來源核准。\n';
  bodyTampered.pages[2].content_fingerprint = hash(bodyTampered.pages[2].body);
  assert.throws(() => api.validateBundle(resign(bodyTampered), { mode: 'local', registry: f.registry, collabRoot: f.root }), /source_lineage_mismatch/);

  const pageSetTampered = clone(f.build());
  pageSetTampered.pages[2] = clone(pageSetTampered.pages[0]);
  pageSetTampered.pages[2].slug = '';
  pageSetTampered.pages[2].content_fingerprint = hash(pageSetTampered.pages[2].body);
  assert.throws(() => api.validateBundle(resign(pageSetTampered), { mode: 'local', registry: f.registry, collabRoot: f.root }), /page_set_mismatch|source_lineage_mismatch/);
});

test('recomputed self-hashes cannot weaken the bundle boundary or source map', () => {
  const f = fixture();
  const mutable = clone(f.build());
  mutable.write_boundary = 'mutable';
  assert.throws(() => api.validateBundle(resign(mutable), { mode: 'local', registry: f.registry, collabRoot: f.root }), /bundle_boundary_mismatch/);

  const wrongSourceMap = clone(f.build());
  wrongSourceMap.source_fingerprints[sourceRef] = 'a'.repeat(64);
  assert.throws(() => api.validateBundle(resign(wrongSourceMap), { mode: 'local', registry: f.registry, collabRoot: f.root }), /source_map_mismatch/);
});

// S2 local corpus: real isolated files and independent expected chapter bodies.
const chapterIds = ['entry', 'collaboration', 'execution', 'delivery', 'documentation', 'troubleshooting'];
const summarySlugs = ['', 'entry', 'rules', 'capabilities', 'runtime', 'governance'];
const chapterBody = id => `## ${id} 操作\n\n文件版本：**v0.3.0**\n\n${id} 的獨立正文與 \`generated_at\`。\n\n## 版本與維護\n\n${id === 'collaboration' ? '| 目前文件版本 | `v0.3.0`；版本描述正文內容 |' : `文件 ID \`guide-${id}\`、目前 v0.3.0；版本描述本章內容。`}\n\n## 版本歷史\n\n### v0.3.0 — 2026-09-08｜本版內容\n\n- ${id} 的來源與驗收。\n`;
const corpusBody = () => `# 共用指南前言，不得混入章節\n\n${chapterIds.map(id => `<!-- chapter:start ${id} -->\n${chapterBody(id)}<!-- chapter:end ${id} -->`).join('\n\n')}\n\n章外保留尾文。\n`;

function corpusFixture() {
  const f = fixture();
  f.registry.scope_version = 'manual-local-v2';
  const template = f.registry.records[0];
  f.registry.records = chapterIds.map(id => ({
    ...clone(template), id: `guide-${id}`, chapter_id: id, document_version: 'v0.3.0',
    title: `${id} 操作`, human_summary: `${id} 的人工審核摘要。`,
    status: id === 'delivery' ? 'conditional' : 'active',
  }));
  f.registry.human_navigation = [
    ...summarySlugs.map((slug, i) => ({ id: `summary-${i}`, slug, title: `摘要 ${i}`, kind: i ? 'index' : 'home', record_ids: f.registry.records.map(r => r.id) })),
    ...f.registry.records.map(r => ({ id: r.chapter_id, slug: `capabilities/${r.chapter_id}`, title: r.title, kind: 'content', record_id: r.id })),
  ];
  f.registry.impact_reviews = [];
  f.update = body => {
    fs.writeFileSync(f.file, body);
    for (const record of f.registry.records) {
      record.source_refs[0].fingerprint = hash(body);
      record.summary_reviewed_source_fingerprint = hash(body);
    }
  };
  f.update(corpusBody());
  f.capabilityRef = '$COLLAB/notyet-harness/system/rule.md';
  f.capabilityFile = path.join(f.root, f.capabilityRef.slice('$COLLAB/'.length));
  f.capabilityBody = '# Fixture capability rule\n\nOne confirmed writer per shared file.\n';
  fs.mkdirSync(path.dirname(f.capabilityFile), { recursive: true });
  fs.writeFileSync(f.capabilityFile, f.capabilityBody);
  f.registry.capability_mappings = chapterIds.map(id => ({
    id, source_refs: [{ path: f.capabilityRef, fingerprint: hash(f.capabilityBody) }],
    document_fingerprints: { [`guide-${id}`]: hash(api.extractChapter(corpusBody(), id)) },
  }));
  f.outputRoot = path.join(f.root, 'harness-mc/.tmp/morrowise-docs');
  f.publish = (fsApi = fs) => api.writeLocalOutputs({ bundle: f.build(), registry: f.registry, collabRoot: f.root, outputRoot: f.outputRoot, fsApi });
  f.cli = (...args) => {
    const script = path.join(f.root, 'harness-mc/scripts/generate-morrowise-documentation.mjs');
    const registryFile = path.join(f.root, 'harness-mc/system-workflow/registries/morrowise-document-sources.json');
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.mkdirSync(path.dirname(registryFile), { recursive: true });
    fs.copyFileSync(target, script);
    const impactFile = path.join(path.dirname(script), 'lib/morrowise-documentation-impact.mjs');
    fs.mkdirSync(path.dirname(impactFile), { recursive: true });
    fs.copyFileSync(new URL('./lib/morrowise-documentation-impact.mjs', import.meta.url), impactFile);
    fs.writeFileSync(registryFile, JSON.stringify(f.registry));
    // Stub only the external read-only Git boundary; the real impact library,
    // source files, parser and publisher still execute in this isolated root.
    const gitBin = path.join(f.root, 'fixture-bin');
    fs.mkdirSync(gitBin, { recursive: true });
    const gitStub = `#!${process.execPath}\nconst args = process.argv.slice(2);\nconst same = expected => JSON.stringify(args) === JSON.stringify(expected);\nif (same(['ls-tree', '--name-only', 'HEAD', '--', 'system-workflow/registries/morrowise-document-sources.json'])) process.exit(${f.gitInspectionFailure ? 31 : 0});\nif (same(['diff', '--name-only', '-z', 'HEAD', '--', 'system/rule.md', '000_Agent/docs/morrowise/OPERATOR-GUIDE.md'])) process.exit(0);\nprocess.stderr.write('unexpected_fixture_git_command');\nprocess.exit(97);\n`;
    fs.writeFileSync(path.join(gitBin, 'git'), gitStub, { mode: 0o700 });
    // Match Node's real import path on macOS (/var is an alias for /private/var).
    return spawnSync(process.execPath, [fs.realpathSync(script), ...args], { encoding: 'utf8', env: { ...process.env, COLLAB_ROOT: fs.realpathSync(f.root), PATH: `${gitBin}${path.delimiter}${process.env.PATH ?? ''}` } });
  };
  return f;
}

test('manual-local-v2 produces six exact chapters and six human-reviewed summary pages', () => {
  const f = corpusFixture(), b = f.build();
  assert.equal(b.pages.length, 12);
  for (const id of chapterIds) {
    const page = b.pages.find(p => p.chapter_id === id && p.kind === 'content');
    assert.equal(page.body, chapterBody(id));
    assert.equal(page.record_id, `guide-${id}`);
    assert.equal(page.document_version, 'v0.3.0');
    assert.equal(page.content_hash, hash(chapterBody(id)));
    assert.equal(page.content_fingerprint, page.content_hash);
    assert.equal(page.status, id === 'delivery' ? 'conditional' : 'active');
    assert.doesNotMatch(page.body, /共用指南前言|章外保留尾文/);
  }
  const home = b.pages.find(p => p.slug === '');
  assert.match(home.body, /entry 的人工審核摘要/);
  assert.match(home.body, /\/docs\/capabilities\/entry/);
  assert.doesNotMatch(home.body, /entry 的獨立正文/);
  assert.deepEqual(home.record_ids, f.registry.records.map(r => r.id));
  assert.equal(home.document_version, null);
  assert.deepEqual(home.records, f.registry.records.map(r => ({ id: r.id, document_version: r.document_version, source_ref: sourceRef, source_fingerprint: hash(corpusBody()), status: r.status })));
  assert.equal(api.validateBundle(b, { registry: f.registry, collabRoot: f.root }), true);
  assert.equal(fs.readFileSync(f.file, 'utf8'), corpusBody());
});

test('published JSON schema declares v2 chapter and navigation fields without dropping v1', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('../system-workflow/schemas/morrowise-document-source.schema.json', import.meta.url), 'utf8'));
  assert.deepEqual(schema.properties.scope_version.enum, ['first-chapter-local-v1', 'manual-local-v2']);
  const versionContract = schema.$defs.record.properties.document_version;
  assert.equal(versionContract.const, undefined);
  assert.equal(versionContract.type, 'string');
  assert.equal(typeof versionContract.pattern, 'string');
  const versionPattern = new RegExp(versionContract.pattern);
  for (const version of ['v0.3.0', 'v0.3.1', 'v2.0.0', 'v1.0.0-rc.1+docs.7']) assert.equal(versionPattern.test(version), true, version);
  for (const version of ['0.3.1', 'v0.03.1', 'v01.0.0', 'v1.0', 'v1.0.0-01', 'v1.0.0+']) assert.equal(versionPattern.test(version), false, version);
  assert.deepEqual(schema.$defs.record.properties.chapter_id.enum, chapterIds);
  assert.equal(schema.$defs.navigation.properties.record_ids.uniqueItems, true);
  assert.equal(schema.properties.capability_mappings.items.type, 'object');
  assert.equal(schema.properties.impact_reviews.items.type, 'object');
  assert.equal(schema.additionalProperties, false);
});

test('same-file corpus is read once per producer or consumer validation', () => {
  const f = corpusFixture(), original = fs.readFileSync;
  let reads = 0;
  fs.readFileSync = function(file, ...args) { if (String(file) === f.file) reads++; return original.call(fs, file, ...args); };
  try {
    const b = f.build(); assert.equal(reads, 1);
    reads = 0; api.validateBundle(b, { registry: f.registry, collabRoot: f.root }); assert.equal(reads, 1);
  } finally { fs.readFileSync = original; }
});

for (const [label, transform] of [
  ['missing end', s => s.replace('<!-- chapter:end entry -->', '')],
  ['duplicate chapter', s => `${s}\n<!-- chapter:start entry -->\n${chapterBody('entry')}<!-- chapter:end entry -->\n`],
  ['nested marker', s => s.replace('<!-- chapter:end entry -->', '<!-- chapter:start execution -->\n<!-- chapter:end entry -->')],
  ['wrong matching end', s => s.replace('<!-- chapter:end entry -->', '<!-- chapter:end collaboration -->')],
  ['end before start', s => `<!-- chapter:end entry -->\n${s}`],
  ['unknown chapter', s => s.replaceAll('chapter:start entry', 'chapter:start outsider').replaceAll('chapter:end entry', 'chapter:end outsider')],
  ['marker embedded in prose', s => s.replace('<!-- chapter:start entry -->', 'prefix <!-- chapter:start entry -->')],
]) {
  test(`chapter parser rejects ${label}`, () => {
    const f = corpusFixture(); f.update(transform(corpusBody()));
    assert.throws(f.build, /chapter_marker|chapter_missing/);
  });
}

test('chapter-like markers inside fenced code are not parsed as live sentinels', () => {
  const f = corpusFixture();
  const example = '\n```md\n<!-- chapter:start outsider -->\n<!-- chapter:end outsider -->\n```\n';
  f.update(corpusBody().replace('<!-- chapter:end entry -->', `${example}<!-- chapter:end entry -->`));
  const b = f.build();
  assert.match(b.pages.find(p => p.slug === 'capabilities/entry').body, /chapter:start outsider/);
});

test('chapter version and latest history version must match the registry', () => {
  const f = corpusFixture();
  f.update(corpusBody().replace('文件版本：**v0.3.0**', '文件版本：**v0.2.0**'));
  assert.throws(f.build, /chapter_version/);
  f.update(corpusBody().replace('### v0.3.0', '### v0.2.0'));
  assert.throws(f.build, /chapter_history/);
});

test('one chapter can upgrade its patch version without relabeling other chapters or the overview', () => {
  const f = corpusFixture();
  const updated = chapterBody('entry').replaceAll('v0.3.0', 'v0.3.1') + '\n### v0.3.0 — 2026-09-07｜保留舊版本歷史\n\n- 舊版本為歷史，不是目前版本。\n';
  f.update(corpusBody().replace(chapterBody('entry'), updated));
  f.registry.records[0].document_version = 'v0.3.1';
  const bundle = f.build();
  const entry = bundle.pages.find(page => page.chapter_id === 'entry');
  assert.equal(entry.document_version, 'v0.3.1'); assert.equal(entry.body, updated);
  for (const id of chapterIds.slice(1)) {
    const page = bundle.pages.find(candidate => candidate.chapter_id === id);
    assert.equal(page.document_version, 'v0.3.0'); assert.equal(page.body, chapterBody(id));
  }
  const home = bundle.pages.find(page => page.slug === '');
  assert.equal(home.document_version, null);
  assert.deepEqual(home.records.map(record => record.document_version), ['v0.3.1', ...Array(5).fill('v0.3.0')]);
  assert.equal(api.validateBundle(bundle, { registry: f.registry, collabRoot: f.root }), true);
});

test('semantic versions support valid release and prerelease forms without hardcoded current versions', () => {
  for (const version of ['v2.0.0', 'v1.0.0-rc.1+docs.7']) {
    const f = corpusFixture();
    f.update(corpusBody().replace(chapterBody('entry'), chapterBody('entry').replaceAll('v0.3.0', version)));
    f.registry.records[0].document_version = version;
    assert.equal(f.build().pages.find(page => page.chapter_id === 'entry').document_version, version);
  }
  for (const version of ['0.3.1', 'v0.03.1', 'v01.0.0', 'v1.0', 'v1.0.0-01', 'v1.0.0+']) {
    const f = corpusFixture(); f.registry.records[0].document_version = version;
    assert.throws(f.build, /chapter_contract/, version);
  }
});

test('patch upgrades reject a registry, chapter header or latest history left at another version', () => {
  const registryOnly = corpusFixture(); registryOnly.registry.records[0].document_version = 'v0.3.1';
  assert.throws(registryOnly.build, /chapter_version_mismatch/);
  const staleHistory = corpusFixture(); staleHistory.registry.records[0].document_version = 'v0.3.1';
  staleHistory.update(corpusBody().replace('文件版本：**v0.3.0**', '文件版本：**v0.3.1**'));
  assert.throws(staleHistory.build, /chapter_history_version_mismatch/);
  const staleRegistry = corpusFixture();
  staleRegistry.update(corpusBody().replace(chapterBody('entry'), chapterBody('entry').replaceAll('v0.3.0', 'v0.3.1')));
  assert.throws(staleRegistry.build, /chapter_version_mismatch/);
});

test('chapter maintenance current version must match in both prose and table formats', () => {
  const prose = corpusFixture();
  prose.update(corpusBody().replace('目前 v0.3.0；', '目前 v0.2.9；'));
  assert.throws(prose.build, /chapter_maintenance_version_mismatch/);
  const table = corpusFixture();
  table.update(corpusBody().replace('| 目前文件版本 | `v0.3.0`', '| 目前文件版本 | `v0.2.9`'));
  assert.throws(table.build, /chapter_maintenance_version_mismatch/);
  const missing = corpusFixture();
  missing.update(corpusBody().replace('## 版本與維護', '## 非維護章節'));
  assert.throws(missing.build, /chapter_maintenance_version_mismatch/);
});

test('v2 summary and content navigation reject unknown, missing and duplicate references', () => {
  const f = corpusFixture(); f.registry.human_navigation[0].record_ids.push('missing');
  assert.throws(f.build, /unknown_record|navigation/);
  f.registry.human_navigation[0].record_ids.pop(); f.registry.human_navigation.pop();
  assert.throws(f.build, /navigation|chapter_coverage/);
  const g = corpusFixture(); g.registry.human_navigation[0].record_ids.push('guide-entry');
  assert.throws(g.build, /duplicate|navigation/);
});

test('v2 extraction is a real public API and does not include other chapters or outer prose', () => {
  assert.equal(typeof api.extractChapter, 'function');
  assert.equal(typeof api.validateCorpus, 'function');
  assert.equal(api.extractChapter(corpusBody(), 'entry'), chapterBody('entry'));
  const f = corpusFixture(); assert.equal(api.validateCorpus(corpusBody(), f.registry), true);
});

test('local publisher writes exactly bundle plus six human summaries and then saves zero', () => {
  const f = corpusFixture(); assert.equal(typeof api.writeLocalOutputs, 'function');
  const first = f.publish(); assert.equal(first.save_count, 7);
  assert.deepEqual(fs.readdirSync(path.join(f.outputRoot, 'human')).sort(), ['01-entry.md', '02-rules.md', '03-capabilities.md', '04-runtime.md', '05-governance.md', 'README.md']);
  const before = fs.statSync(path.join(f.outputRoot, 'bundle.json'), { bigint: true }).mtimeNs;
  const second = f.publish(); assert.equal(second.save_count, 0); assert.equal(second.hasChange, false);
  assert.equal(fs.statSync(path.join(f.outputRoot, 'bundle.json'), { bigint: true }).mtimeNs, before);
  assert.equal(fs.existsSync(path.join(f.root, 'harness-mc/public')), false);
  assert.equal(fs.existsSync(path.join(f.root, 'notyet-harness/000_Agent/docs/morrowise/human')), false);
});

test('partial publish failure restores every previously published target and the last good bundle', () => {
  const f = corpusFixture(); assert.equal(typeof api.writeLocalOutputs, 'function'); f.publish();
  const paths = ['bundle.json', ...fs.readdirSync(path.join(f.outputRoot, 'human')).map(x => `human/${x}`)];
  const original = new Map(paths.map(p => [p, fs.readFileSync(path.join(f.outputRoot, p), 'utf8')]));
  for (const r of f.registry.records) r.human_summary += ' 已審核修改。';
  let renames = 0;
  const fsApi = { ...fs, renameSync(from, to) { if (++renames === 2) throw new Error('isolated_rename_failure'); return fs.renameSync(from, to); } };
  assert.throws(() => f.publish(fsApi), /isolated_rename_failure/);
  for (const [p, bytes] of original) assert.equal(fs.readFileSync(path.join(f.outputRoot, p), 'utf8'), bytes);
  assert.equal(fs.readFileSync(f.file, 'utf8'), corpusBody());
});

test('changed chapter rewrites only the bundle and preserves all unchanged human summaries', () => {
  const f = corpusFixture(); f.publish();
  const human = path.join(f.outputRoot, 'human');
  const before = new Map(fs.readdirSync(human).map(name => [name, fs.statSync(path.join(human, name), { bigint: true }).mtimeNs]));
  f.update(corpusBody().replace('entry 的獨立正文', 'entry 的已核准新版正文'));
  const changed = f.publish(); assert.equal(changed.save_count, 1);
  const output = JSON.parse(fs.readFileSync(path.join(f.outputRoot, 'bundle.json'), 'utf8'));
  assert.match(output.pages.find(p => p.chapter_id === 'entry').body, /已核准新版正文/);
  for (const [name, mtime] of before) assert.equal(fs.statSync(path.join(human, name), { bigint: true }).mtimeNs, mtime);
  assert.equal(f.publish().save_count, 0);
});

test('last rename failure rolls back all six summaries without replacing the good bundle', () => {
  const f = corpusFixture(); f.publish();
  const paths = ['bundle.json', ...fs.readdirSync(path.join(f.outputRoot, 'human')).map(name => `human/${name}`)];
  const original = new Map(paths.map(p => [p, fs.readFileSync(path.join(f.outputRoot, p), 'utf8')]));
  for (const r of f.registry.records) r.human_summary += ' 已核准新摘要。';
  let renames = 0;
  const fsApi = { ...fs, renameSync(from, to) { if (++renames === 7) throw new Error('isolated_bundle_rename_failure'); return fs.renameSync(from, to); } };
  assert.throws(() => f.publish(fsApi), /isolated_bundle_rename_failure/);
  for (const [p, bytes] of original) assert.equal(fs.readFileSync(path.join(f.outputRoot, p), 'utf8'), bytes);
  assert.equal(fs.readdirSync(f.outputRoot).some(name => name.startsWith('.publish-')), false);
});

test('failed validation and symlink output cannot overwrite the last good publication', () => {
  const f = corpusFixture(); assert.equal(typeof api.writeLocalOutputs, 'function'); f.publish();
  const original = fs.readFileSync(path.join(f.outputRoot, 'bundle.json'), 'utf8');
  const tampered = f.build(); tampered.pages[6].body += ' tampered';
  assert.throws(() => api.writeLocalOutputs({ bundle: tampered, registry: f.registry, collabRoot: f.root, outputRoot: f.outputRoot }), /fingerprint|lineage/);
  assert.equal(fs.readFileSync(path.join(f.outputRoot, 'bundle.json'), 'utf8'), original);
  const moved = `${f.outputRoot}-original`; fs.renameSync(f.outputRoot, moved); fs.symlinkSync(moved, f.outputRoot);
  assert.throws(f.publish, /unsafe_output|symlink_output/);
});

test('CLI rejects unknown, duplicate and self-test conflict flags before writing', () => {
  for (const args of [['--unknown'], ['--local', '--local'], ['--self-test', '--changed-only'], ['--local', '--check', '--changed-only']]) {
    const f = corpusFixture(), result = f.cli(...args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unknown_flag|duplicate_flag|conflicting_flags/);
    assert.equal(fs.existsSync(f.outputRoot), false);
  }
});

test('CLI retains the explicit public release denial with and without local flags', () => {
  for (const args of [['--public'], ['--public', '--local']]) {
    const f = corpusFixture(), result = f.cli(...args);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /public_release_not_authorized/);
    assert.equal(fs.existsSync(f.outputRoot), false);
  }
});

test('CLI impact gate rejects unavailable Git inspection before publishing', () => {
  const f = corpusFixture(); f.gitInspectionFailure = true;
  const result = f.cli('--local');
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /committed_registry_unreadable/);
  assert.equal(fs.existsSync(f.outputRoot), false);
});

test('CLI impact gate blocks capability changes with untouched docs and preserves all last good outputs', () => {
  const f = corpusFixture();
  const initial = f.cli('--local'); assert.equal(initial.status, 0, initial.stderr);
  const paths = ['bundle.json', ...fs.readdirSync(path.join(f.outputRoot, 'human')).map(name => `human/${name}`)];
  const original = new Map(paths.map(p => [p, fs.readFileSync(path.join(f.outputRoot, p), 'utf8')]));
  fs.appendFileSync(f.capabilityFile, '\nChanged capability behavior requires fresh documentation impact review.\n');
  const result = f.cli('--local');
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /review_missing/);
  for (const [p, bytes] of original) assert.equal(fs.readFileSync(path.join(f.outputRoot, p), 'utf8'), bytes);
  assert.equal(fs.readFileSync(f.file, 'utf8'), corpusBody());
});

test('CLI changed-only is idempotent, check includes human drift, and self-test is meaningful', () => {
  const f = corpusFixture();
  const first = f.cli('--local', '--changed-only'); assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).save_count, 7);
  const second = f.cli('--local', '--changed-only'); assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).save_count, 0);
  assert.equal(f.cli('--local', '--check').status, 0);
  fs.appendFileSync(path.join(f.outputRoot, 'human/README.md'), '\nmanual drift\n');
  const drift = f.cli('--local', '--check'); assert.notEqual(drift.status, 0); assert.match(drift.stderr, /output_drift/);
  const self = f.cli('--self-test'); assert.equal(self.status, 0, self.stderr);
  assert.equal(JSON.parse(self.stdout).passed >= 3, true);
});

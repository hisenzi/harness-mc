#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as generator from './generate-morrowise-documentation.mjs';
const {createBundle, validateBundle} = generator;
import Ajv2020 from 'ajv/dist/2020.js';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const COLLAB_ROOT = path.resolve(ROOT, '..');
const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const registry = JSON.parse(read('system-workflow/registries/morrowise-document-sources.json'));
const registrySchema = JSON.parse(read('system-workflow/schemas/morrowise-document-source.schema.json'));
const bundleFile = path.join(ROOT, '.tmp/morrowise-docs/bundle.json');
const guideFile = path.join(COLLAB_ROOT, 'notyet-harness/000_Agent/docs/morrowise/OPERATOR-GUIDE.md');
const bundle = JSON.parse(fs.readFileSync(bundleFile, 'utf8'));
const failures = [];
const historyModule = path.join(ROOT, 'app/docs/version-history.mjs');
const historyPlugins = fs.existsSync(historyModule) ? [(await import(historyModule)).default] : [];
const renderMarkdown = body => renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, ...historyPlugins] }, body));
const sensitiveMarker = /\b(?:(?:sk|ghp)[_-][A-Za-z0-9_-]{12,}|xox[baprs]-[A-Za-z0-9-]{12,})\b/i;
let consumer, consumerError;
try { consumer = await import('../lib/morrowise-docs-source.ts'); } catch (error) { consumerError = error; }

function check(name, fn) {
  try {
    fn();
    console.log(`✔ ${name}`);
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    console.log(`✘ ${name}`);
  }
}

check('bundle validates against the JV-36 registry', () => {
  assert.equal(validateBundle(bundle, { registry, collabRoot: COLLAB_ROOT }), true);
  assert.equal(bundle.visibility, 'local_only');
  assert.equal(bundle.write_boundary, 'read_only');
  assert.equal(bundle.drift_state, 'fresh');
});

check('numbered history renders as two closed native disclosures with intact content', () => {
  const html = renderMarkdown('## 版本歷史\n\n### v0.2.0 — 新版\n\n保留 `generated_at`。\n\n- 改動一\n\n### v0.1.0 — 初版\n\n[依據](https://example.com/source)\n\n## 後續章節\n\n不可吞入歷史。');
  assert.equal((html.match(/<details\b/g) ?? []).length, 2);
  assert.match(html, /<summary>v0\.2\.0 — 新版<\/summary>/);
  assert.match(html, /<code>generated_at<\/code>/);
  assert.match(html, /<li>改動一<\/li>/);
  assert.match(html, /<a href="https:\/\/example.com\/source">依據<\/a>/);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:[=>\s])/);
  assert.match(html, /<\/details>\s*<h2>後續章節<\/h2>\s*<p>不可吞入歷史。<\/p>/);
});

check('prerelease and build versions render as closed history disclosures with exact labels', () => {
  const html = renderMarkdown('## 版本歷史\n\n### v0.4.0-rc.1 — 候選版\n\n候選版內容。\n\n### v0.3.1+build.5 — 建置標記\n\n保留 `generated_at`。\n\n## 下一節\n\n不是歷史。');
  assert.equal((html.match(/<details\b/g) ?? []).length, 2);
  assert.match(html, /<summary>v0\.4\.0-rc\.1 — 候選版<\/summary>/);
  assert.match(html, /<summary>v0\.3\.1\+build\.5 — 建置標記<\/summary>/);
  assert.match(html, /<code>generated_at<\/code>/);
  assert.doesNotMatch(html, /<details[^>]*\bopen(?:[=>\s])/);
  assert.match(html, /<\/details>\s*<h2>下一節<\/h2>\s*<p>不是歷史。<\/p>/);
});

check('history version recognition rejects malformed versions and ignores fenced prerelease examples', () => {
  const html = renderMarkdown('### v0.4.0-rc.1 — 非歷史\n\n```md\n## 版本歷史\n### v0.4.0-rc.1\n```\n\n## 版本歷史\n\n### v01.2.3 — 前導零\n\n### v1.2.3-01 — 無效數字標記\n\n### v1.2.3+ — 缺建置標記\n\n### v1.2.3-rc.1+build.5 — 合法版本\n\n合法內容。');
  assert.equal((html.match(/<details\b/g) ?? []).length, 1);
  assert.match(html, /<h3>v0\.4\.0-rc\.1 — 非歷史<\/h3>/);
  assert.match(html, /<h3>v01\.2\.3 — 前導零<\/h3>/);
  assert.match(html, /<h3>v1\.2\.3-01 — 無效數字標記<\/h3>/);
  assert.match(html, /<h3>v1\.2\.3\+ — 缺建置標記<\/h3>/);
  assert.match(html, /<summary>v1\.2\.3-rc\.1\+build\.5 — 合法版本<\/summary>/);
});

check('history transformation does not reinterpret code, other headings or unsafe HTML', () => {
  const html = renderMarkdown('### v0.1.0 — 非歷史章節\n\n```md\n## 版本歷史\n### v9.9.9\n```\n\n## 版本歷史\n\n說明保留。\n\n### v0.2.0 — **修訂**\n\n<script>alert(1)</script>\n\n| 欄位 | 值 |\n| --- | --- |\n| owner | Agent |');
  assert.equal((html.match(/<details\b/g) ?? []).length, 1);
  assert.match(html, /<h3>v0\.1\.0 — 非歷史章節<\/h3>/);
  assert.match(html, /<summary>v0\.2\.0 — <strong>修訂<\/strong><\/summary>/);
  assert.match(html, /<p>說明保留。<\/p>/);
  assert.match(html, /<td>Agent<\/td>/);
  assert.doesNotMatch(html, /<script>/);
});

check('registry satisfies the versioned JSON schema', () => {
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(registrySchema);
  assert.equal(validate(registry), true, JSON.stringify(validate.errors));
});

check('bundle has exactly six approved chapters and six generated overviews', () => {
  assert.deepEqual(bundle.human_navigation, registry.human_navigation);
  assert.deepEqual(bundle.pages.map(page => page.slug), registry.human_navigation.map(nav => nav.slug));
  assert.equal(bundle.pages.filter(page => page.kind === 'content').length, 6);
  assert.equal(bundle.pages.filter(page => page.kind !== 'content').length, 6);
  assert.deepEqual(bundle.pages.filter(page => page.kind === 'content').map(page => page.slug).sort(),
    ['entry', 'collaboration', 'execution', 'delivery', 'documentation', 'troubleshooting'].map(id => `capabilities/${id}`).sort());
});

check('every capability body is an exact chapter projection with versioned lineage', () => {
  const guide = fs.readFileSync(guideFile, 'utf8').replace(/\r\n?/g, '\n');
  for (const page of bundle.pages.filter(candidate => candidate.kind === 'content')) {
    const record = registry.records.find(record => record.id === page.record_id);
    assert.ok(record);
    assert.equal(page.body, generator.extractChapter(guide, record.chapter_id));
    assert.equal(page.source_ref, record.human_content_ref);
    assert.equal(page.source_fingerprint, record.summary_reviewed_source_fingerprint);
    assert.equal(page.document_version, record.document_version);
    assert.equal(page.content_hash, page.content_fingerprint);
    assert.ok(record.architecture_summary);
    const versions = [...page.body.matchAll(/^### (v\S+) — /gm)].map(match => match[1]);
    assert.equal(versions[0], page.document_version);
    assert.equal((renderMarkdown(page.body).match(/<details\b/g) ?? []).length, versions.length);
  }
});

check('actual guide has a consistent current version and an intact Agent construction section', () => {
  const body = bundle.pages.find(page => page.slug === 'capabilities/collaboration').body;
  const current = /文件版本：\*\*(v[^*\s]+)\*\*/.exec(body)?.[1];
  assert.ok(current, 'missing visible current version');
  assert.ok(body.includes(`| 目前文件版本 | \`${current}\``));
  const entries = [...body.matchAll(/^### (v\S+) — /gm)].map(match => match[1]);
  assert.equal(entries[0], current);
  assert.equal(new Set(entries).size, entries.length, 'duplicate version entry');
  const html = renderMarkdown(body);
  assert.equal((html.match(/<details\b/g) ?? []).length, entries.length);
  assert.match(html, /<h2>給 AI Agent：從零建制到完成<\/h2>/);
  assert.match(html, /<h3>7\. 正式承接與完成邊界<\/h3>/);
  for (const match of bundle.pages.map(page => page.body).join('\n').matchAll(/`(\$COLLAB\/[^`]+)`/g)) {
    const ref = match[1].split('#')[0];
    // The documented generated site is created after the source checks.
    if (ref === '$COLLAB/harness-mc/.tmp/morrowise-docs/site/') continue;
    assert.ok(fs.existsSync(path.join(COLLAB_ROOT, ref.slice('$COLLAB/'.length))), `guide path does not exist: ${ref}`);
  }
});

check('same inputs reproduce the same bundle', () => {
  const rerun = createBundle({ registry });
  assert.deepEqual(rerun, bundle);
});

check('public release is denied before any content can be emitted', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts/generate-morrowise-documentation.mjs'), '--public'], { cwd: ROOT, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /public_release_not_authorized/);
});

check('Fumadocs route consumes bundle metadata and has no write action', () => {
  const page = read('app/docs/[[...slug]]/page.tsx');
  assert.match(page, /ReactMarkdown/);
  assert.match(page, /remarkPlugins=\{\[remarkGfm, remarkVersionHistory\]\}/);
  assert.match(page, /DocsPage/);
  assert.match(page, /source_ref/);
  assert.match(page, /write_policy/);
  assert.match(page, /page\.document_version/);
  assert.match(page, /toc=\{pageToc\(page\.body\)\}/);
  assert.match(page, /id=\{headingId\(title\)\}/);
  assert.match(page, /Mission Control/);
  assert.match(page, /文件頁面導覽/);
  assert.match(page, /上一頁/);
  assert.match(page, /下一頁/);
  assert.doesNotMatch(page, /fetch\s*\(/);
  assert.doesNotMatch(page, /method:\s*["']POST/);
});

check('actual Markdown anchor renderer respects Next basePath and preserves external and fragment links', () => {
  const runner = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import ts from 'typescript';
    import { createElement } from 'react';
    import * as jsxRuntime from 'react/jsx-runtime';
    import { renderToStaticMarkup } from 'react-dom/server';
    import ReactMarkdown from 'react-markdown';
    import Link from 'next/link.js';
    const text = fs.readFileSync('app/docs/[[...slug]]/page.tsx', 'utf8');
    const source = ts.createSourceFile('page.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let anchor;
    const visit = node => {
      if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === 'ReactMarkdown') {
        const components = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(source) === 'components');
        anchor = components?.initializer?.expression?.properties?.find(p => p.name?.getText(source) === 'a')?.initializer;
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    let components = {};
    if (anchor) {
      const compiled = ts.transpileModule('const renderer = ' + anchor.getText(source), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } }).outputText;
      components.a = new Function('require', 'Link', 'exports', compiled + '; return renderer;')(name => { assert.equal(name, 'react/jsx-runtime'); return jsxRuntime; }, Link, {});
    }
    const body = '[Internal](/docs/capabilities/entry "Entry title") [External](https://example.com/docs) [Fragment](#section) [Network](//example.com/docs) [Mail](mailto:reader@example.com)';
    const html = renderToStaticMarkup(createElement(ReactMarkdown, { components }, body));
    const prefix = process.env.__NEXT_ROUTER_BASEPATH;
    assert.ok(html.includes('href="' + prefix + '/docs/capabilities/entry"'), html);
    for (const href of ['https://example.com/docs', '#section', '//example.com/docs', 'mailto:reader@example.com']) assert.ok(html.includes('href="' + href + '"'), href);
    assert.ok(html.includes('title="Entry title"'));
    console.log('actual Markdown anchor renderer OK: ' + (prefix || 'root'));
  `;
  for (const basePath of ['', '/fixture-docs']) {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', runner], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, __NEXT_ROUTER_BASEPATH: basePath },
    });
    assert.equal(result.status, 0, result.stderr);
  }
});

check('mobile Markdown tables target the real docs article and own their horizontal overflow', () => {
  const css = read('app/docs/docs.css');
  assert.match(css, /#nd-page\s+\.prose\s+table\s*\{[^}]*display:\s*block\s*;[^}]*max-width:\s*100%\s*;[^}]*overflow-x:\s*auto\s*;/);
});

check('Fumadocs layout is registry-bound and search is static', () => {
  const layout = read('app/docs/layout.tsx');
  const provider = read('app/docs/providers.tsx');
  assert.match(layout, /docsTree/);
  assert.match(layout, /docsSearchLinks/);
  assert.match(layout, /DocsLayout/);
  assert.match(layout, /nav=\{\{\s*title: "MorroWise 說明書"/);
  assert.match(provider, /options:\s*\{\s*links:\s*searchLinks/);
  assert.match(provider, /RootProvider/);
  assert.match(provider, /zh-TW/);
  assert.match(provider, /搜尋/);
  const search = read('app/docs/search-dialog.tsx');
  assert.match(search, /toLocaleLowerCase\(\)\.includes\(query\)/);
  assert.match(search, /SearchDialogList/);
  assert.doesNotMatch(search, /fetch\s*\(/);
});

check('theme provider hydration is explicitly tolerated at the shared root', () => {
  assert.match(read('app/layout.tsx'), /<html lang="zh-TW" suppressHydrationWarning>/);
});

check('documentation shell overrides the dashboard canvas without global drift', () => {
  const css = read('app/docs/docs.css');
  assert.match(css, /body:has\(#nd-page\)/);
  assert.match(css, /#nd-page\s*\{[\s\S]*background:\s*var\(--color-fd-background\)/);
  assert.match(css, /#nd-page \.prose\s*\{[\s\S]*--tw-prose-body:\s*var\(--color-fd-foreground\)/);
});

check('real consumer searches every approved chapter and overview, with no unknown result', () => {
  assert.ifError(consumerError);
  assert.ok(consumer.docsSearchCorpus, 'missing source-bound multi-page search corpus');
  assert.equal(consumer.docsSearchLinks.length, 12);
  const queries = [
    ['登入', 'entry'], ['ownership', 'collaboration'], ['同檔', 'collaboration'],
    ['read_thread', 'collaboration'], ['獨立驗收', 'collaboration'], ['AI Agent', 'collaboration'],
    ['task', 'execution'], ['執行', 'execution'], ['commit', 'delivery'], ['push', 'delivery'],
    ['source parity', 'documentation'], ['說明書', 'documentation'], ['除錯', 'troubleshooting'],
    ['回復', 'troubleshooting'], ['版本歷史', 'collaboration'],
  ];
  for (const [query, chapter] of queries) {
    const hits = consumer.docsSearchLinks.filter(([name, url]) =>
      `${name}\n${consumer.docsSearchCorpus[url]}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    assert.ok(hits.some(([, url]) => url === `/docs/capabilities/${chapter}`), `${query} must find ${chapter}`);
  }
  assert.equal(consumer.docsSearchLinks.filter(([, url]) => consumer.docsSearchCorpus[url].includes('不存在詞-xyz')).length, 0);
  for (const [title, url] of consumer.docsSearchLinks) {
    const page = bundle.pages.find(page => (page.slug ? `/docs/${page.slug}` : '/docs') === url);
    assert.ok(page, 'search route must exist');
    assert.equal(title, page.title);
    assert.equal(consumer.docsSearchCorpus[url], page.body, 'search must use the exact rendered body');
  }
  const source = read('lib/morrowise-docs-source.ts');
  for (const forbidden of ['llms.txt', 'llms-full.txt', '/api/chat', 'Ask AI']) assert.doesNotMatch(source, new RegExp(forbidden.replace('/', '\\/')));
});

check('consumer revalidates source lineage, navigation and local-only boundary', () => {
  const source = read('lib/morrowise-docs-source.ts');
  assert.match(source, /verifyBundle\(bundle/);
  assert.match(source, /MORROWISE_DOCS_LOCAL_PREVIEW/);
  assert.match(source, /human_navigation/);
  assert.doesNotMatch(source, /capabilities\/collaboration/);
});

check('local build routes export through the isolated artifact wrapper', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['docs:build:local'], 'node scripts/build-morrowise-local-docs.mjs');
  const nextConfig = read('next.config.mjs');
  assert.match(nextConfig, /MORROWISE_DOCS_LOCAL_PREVIEW/);
  assert.match(nextConfig, /\.tmp\/morrowise-docs\/site/);
  const builder = read('scripts/build-morrowise-local-docs.mjs');
  assert.match(builder, /local_export_path_occupied/);
  assert.match(builder, /MORROWISE_DOCS_LOCAL_PREVIEW/);
  assert.match(builder, /local_export_path_leaked/);
  assert.match(builder, /local_export_path_created_on_failed_build/);
  assert.match(builder, /rmSync\(outPath/);
});

check('local-only static export does not remain in the public out directory', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'out')), false, 'local preview export must be isolated under .tmp/morrowise-docs/site');
  const isolatedSite = path.join(ROOT, '.tmp/morrowise-docs/site');
  if (!fs.existsSync(isolatedSite)) return;
  const files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(isolatedSite);
  assert.ok(files.length > 0, 'isolated local export is empty');
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(content, /\/Users\/[A-Za-z0-9._-]+\/(?:Documents|Downloads|Desktop|Library|private)\//);
    assert.doesNotMatch(content, /\b(?:sk|ghp)_[A-Za-z0-9]{20,}\b|\bxox[baprs]-[A-Za-z0-9-]{20,}\b/i);
    assert.doesNotMatch(content, /BEGIN (?:RSA|OPENSSH|EC) PRIVATE KEY/);
  }
});

check('sensitive marker detection accepts task filenames but rejects credential-shaped fixtures', () => {
  assert.equal(sensitiveMarker.test('task-write-command-map.md'), false);
  for (const prefix of ['sk_', 'sk-proj-', 'ghp_', 'xoxb-']) {
    assert.equal(sensitiveMarker.test(prefix + 'A'.repeat(32)), true, `must reject ${prefix} fixture`);
  }
});

check('in-scope source files contain no machine-specific absolute path or secret markers', () => {
  const files = [
    'system-workflow/registries/morrowise-document-sources.json',
    'system-workflow/schemas/morrowise-document-source.schema.json',
    'next.config.mjs',
    'app/layout.tsx',
    'scripts/generate-morrowise-documentation.mjs',
    'scripts/verify-morrowise-document-sources.mjs',
    'scripts/lib/morrowise-documentation-impact.mjs',
    'scripts/verify-morrowise-documentation-impact.mjs',
    'scripts/verify-morrowise-documentation-sync.mjs',
    'scripts/verify-morrowise-docs-surface.mjs',
    'scripts/build-morrowise-local-docs.mjs',
    'app/docs/layout.tsx',
    'app/docs/[[...slug]]/page.tsx',
    'app/docs/providers.tsx',
    'app/docs/search-dialog.tsx',
    'app/docs/docs.css',
    'app/docs/version-history.mjs',
    'lib/morrowise-docs-source.ts',
  ];
  for (const file of files) {
    const body = read(file);
    assert.doesNotMatch(body, /\/Users\/[^\n`"']+/);
    assert.equal(sensitiveMarker.test(body), false, `sensitive marker in ${file}`);
  }
});

if (failures.length > 0) {
  console.error(`\nMorroWise docs surface verification failed (${failures.length})`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nMorroWise docs surface verification OK');
}

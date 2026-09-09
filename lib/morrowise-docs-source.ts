import fs from "node:fs";
import path from "node:path";
import type * as PageTree from "fumadocs-core/page-tree";
import { validateBundle } from "../scripts/generate-morrowise-documentation.mjs";
import { evaluateDocumentationImpact } from "../scripts/lib/morrowise-documentation-impact.mjs";
import { validatePublicRelease } from "../scripts/lib/morrowise-public-release.mjs";

export type DocumentationPage = {
  slug: string;
  title: string;
  kind: "home" | "index" | "content";
  body: string;
  content_fingerprint: string;
  content_hash: string;
  record_id?: string | null;
  record_ids?: string[];
  chapter_id?: string | null;
  document_version?: string | null;
  records?: Array<{id: string; document_version: string; source_fingerprint: string}>;
  visibility: "local_only" | "public";
  source_ref: string;
  source_fingerprint: string;
  document_role: string;
  write_policy: "read_only" | "manual";
  task_anchor: string;
  freshness: "fresh";
  last_verified_at: string;
};

type DocumentationBundle = {
  schema_version: string;
  scope_version: string;
  registry_ref: string;
  registry_fingerprint: string;
  source_fingerprints: Record<string, string>;
  human_navigation: Array<{ id: string; slug: string; title: string; kind: DocumentationPage["kind"]; record_id?: string; record_ids?: string[] }>;
  pages: DocumentationPage[];
  drift_state: "fresh";
  visibility: "local_only" | "public";
  write_boundary: "read_only";
  generated_at: string;
  payload_fingerprint: string;
};

const bundlePath = path.resolve(process.cwd(), ".tmp/morrowise-docs/bundle.json");

function loadBundle(): DocumentationBundle {
  if (process.env.MORROWISE_SITE_TARGET === "zeabur") {
    if (process.env.MORROWISE_DOCS_LOCAL_PREVIEW === "1") throw new Error("conflicting_documentation_modes");
    const read = (relative: string): string => {
      let file = process.cwd();
      for (const part of relative.split("/")) {
        file = path.join(file, part);
        if (fs.lstatSync(file).isSymbolicLink()) throw new Error("public_release_symlink_rejected");
      }
      if (!fs.statSync(file).isFile()) throw new Error("public_release_regular_file_required");
      return fs.readFileSync(file, "utf8");
    };
    const registry = JSON.parse(read("system-workflow/registries/morrowise-document-sources.json"));
    const body = read("docs/morrowise/OPERATOR-GUIDE.md");
    const release = {
      manifest: JSON.parse(read("release/morrowise-docs/manifest.json")),
      bundle: JSON.parse(read("release/morrowise-docs/bundle.json")),
    };
    const verifyRelease = validatePublicRelease as unknown as (candidate: unknown, options: {registry: unknown; body: string; allowCandidate: boolean}) => true;
    verifyRelease(release, {registry, body, allowCandidate: process.env.MORROWISE_PUBLIC_CANDIDATE === "1"});
    return release.bundle as DocumentationBundle;
  }
  if (process.env.NODE_ENV === "production" && process.env.MORROWISE_DOCS_LOCAL_PREVIEW !== "1") {
    throw new Error("local_only_docs_requires_preview_flag");
  }
  if (!fs.existsSync(bundlePath)) {
    throw new Error(`MorroWise documentation bundle is missing: ${bundlePath}`);
  }
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8")) as DocumentationBundle;
  const registryPath = path.resolve(process.cwd(), "system-workflow/registries/morrowise-document-sources.json");
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const impact = evaluateDocumentationImpact({registry, collabRoot: path.resolve(process.cwd(), ".."), inspectGit: true});
  if (impact.decision !== "allow") throw new Error(`documentation_impact_blocked:${impact.findings.join(",")}`);
  const verifyBundle = validateBundle as unknown as (candidate: DocumentationBundle, options: { registry: unknown; collabRoot: string; mode: "local" }) => true;
  verifyBundle(bundle, { registry, collabRoot: path.resolve(process.cwd(), ".."), mode: "local" });
  return bundle;
}

export const docsBundle = loadBundle();
export const docsPages = docsBundle.pages;

export function getDocumentationPage(slug: string): DocumentationPage | undefined {
  return docsPages.find((page) => page.slug === slug);
}

function urlFor(slug: string): string {
  return slug ? `/docs/${slug}` : "/docs";
}

// Both the searchable text and rendered page come from this verified bundle.
// One result per page avoids a long list of duplicate keyword aliases.
export const docsSearchLinks: [string, string][] = docsPages.map(page => [page.title, urlFor(page.slug)]);
export const docsSearchCorpus: Record<string, string> = Object.fromEntries(
  docsPages.map(page => [urlFor(page.slug), page.body]),
);

function pageNode(nav: DocumentationBundle["human_navigation"][number]): PageTree.Node {
  return { type: "page", name: nav.title, url: urlFor(nav.slug) };
}

const navigation = docsBundle.human_navigation;
const home = navigation.find((nav) => nav.kind === "home");
if (!home) throw new Error("navigation_missing:home");
const indexes = navigation.filter((nav) => nav.kind === "index");
const indexedSlugs = new Set<string>([home.slug]);
const folders: PageTree.Node[] = indexes.map((index) => {
  indexedSlugs.add(index.slug);
  const children = navigation
    .filter((nav) => nav.kind === "content" && nav.slug.startsWith(`${index.slug}/`))
    .map((nav) => {
      indexedSlugs.add(nav.slug);
      return pageNode(nav);
    });
  if (!children.length) return pageNode(index);
  return {
    type: "folder",
    name: index.title,
    root: true,
    defaultOpen: true,
    index: pageNode(index) as PageTree.Item,
    children,
  };
});
const loosePages = navigation.filter((nav) => !indexedSlugs.has(nav.slug)).map(pageNode);

export const docsTree: PageTree.Root = {
  type: "root",
  name: "MorroWise 使用說明書",
  children: [pageNode(home), ...folders, ...loosePages],
};

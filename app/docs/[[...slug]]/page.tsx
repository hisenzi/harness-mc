import { notFound } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkVersionHistory from "../version-history.mjs";
import type { ReactNode } from "react";
import type { TOCItemType } from "fumadocs-core/toc";
import { DocsBody, DocsPage } from "fumadocs-ui/layouts/docs/page";
import { docsPages, getDocumentationPage } from "@/lib/morrowise-docs-source";

function headingText(children: ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(headingText).join("");
  return "";
}

function headingId(title: string): string {
  return title.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
}

function pageToc(body: string): TOCItemType[] {
  let inHistory = false;
  return body.split("\n").flatMap((line) => {
    const match = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (!match) return [];
    if (match[1].length === 2) inHistory = match[2] === "版本歷史";
    // Collapsed entries have summaries, not heading anchors. Link to the visible section.
    if (inHistory && match[1].length === 3) return [];
    return [{ title: match[2], url: `#${headingId(match[2])}`, depth: match[1].length }];
  });
}

function pageUrl(slug: string): string {
  return slug ? `/docs/${slug}` : "/docs";
}

export function generateStaticParams() {
  return docsPages.map((page) => ({
    slug: page.slug ? page.slug.split("/") : [],
  }));
}

export function generateMetadata({ params }: { params: Promise<{ slug?: string[] }> }) {
  return params.then(({ slug }) => {
    const page = getDocumentationPage((slug ?? []).join("/"));
    return { title: page?.title ?? "MorroWise 使用說明書" };
  });
}

export default async function DocumentationPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const { slug } = await params;
  const page = getDocumentationPage((slug ?? []).join("/"));
  if (!page) notFound();
  const pageIndex = docsPages.findIndex((candidate) => candidate.slug === page.slug);
  const previousPage = pageIndex > 0 ? docsPages[pageIndex - 1] : undefined;
  const nextPage = pageIndex >= 0 && pageIndex < docsPages.length - 1 ? docsPages[pageIndex + 1] : undefined;

  return (
    <DocsPage
      toc={pageToc(page.body)}
      tableOfContent={{ enabled: page.kind === "content" }}
      footer={{ enabled: true }}
      breadcrumb={{ enabled: true }}
    >
      <DocsBody>
        <div className="morrowise-doc-meta" data-testid="morrowise-doc-meta">
          <Link href="/" className="morrowise-doc-home-link">↩ 返回 Mission Control</Link>
          <span>source: {page.source_ref}</span>
          <span>role: {page.document_role}</span>
          <span>write: {page.write_policy === "manual" ? "manual source / site read-only" : page.write_policy}</span>
          <span>visibility: {page.visibility}</span>
          <span>freshness: {page.freshness}</span>
          <span>version: {page.document_version ?? "generated overview"}</span>
          <span>task: {page.task_anchor}</span>
        </div>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkVersionHistory]}
          components={{
            a: ({ href, title, children }) => href?.startsWith("/") && !href.startsWith("//")
              ? <Link href={href} title={title}>{children}</Link>
              : <a href={href} title={title}>{children}</a>,
            h2: ({ children }) => {
              const title = headingText(children);
              return <h2 id={headingId(title)}>{children}</h2>;
            },
            h3: ({ children }) => {
              const title = headingText(children);
              return <h3 id={headingId(title)}>{children}</h3>;
            },
          }}
        >
          {page.body}
        </ReactMarkdown>
        <nav className="morrowise-page-nav" aria-label="文件頁面導覽">
          {previousPage ? <Link href={pageUrl(previousPage.slug)}>← 上一頁：{previousPage.title}</Link> : <span aria-hidden="true" />}
          {nextPage ? <Link href={pageUrl(nextPage.slug)}>下一頁：{nextPage.title} →</Link> : <span aria-hidden="true" />}
        </nav>
      </DocsBody>
    </DocsPage>
  );
}

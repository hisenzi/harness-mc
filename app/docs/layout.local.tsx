import type { Metadata } from "next";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { docsSearchLinks, docsSearchCorpus, docsTree } from "@/lib/morrowise-docs-source";
import { DocsProviders } from "./providers";
import "./docs.css";

export const metadata: Metadata = {
  title: {
    default: "MorroWise 使用說明書",
    template: "%s · MorroWise",
  },
  description: "MorroWise 能力操作指南的唯讀文件入口。",
};

export default function DocumentationLayout({ children }: { children: React.ReactNode }) {
  return (
    <DocsProviders searchLinks={docsSearchLinks} searchCorpus={docsSearchCorpus}>
      <DocsLayout
        tree={docsTree}
        nav={{ title: "MorroWise 說明書", url: "/docs" }}
        searchToggle={{ enabled: true }}
        themeSwitch={{ enabled: true }}
      >
        {children}
      </DocsLayout>
    </DocsProviders>
  );
}

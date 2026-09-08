"use client";

import type { ReactNode } from "react";
import { RootProvider } from "fumadocs-ui/provider/next";
import MorroWiseSearchDialog from "./search-dialog";

export function DocsProviders({ children, searchLinks, searchCorpus }: {
  children: ReactNode; searchLinks: [string, string][]; searchCorpus: Record<string, string>;
}) {
  return (
    <RootProvider
      i18n={{
        locale: "zh-TW",
        locales: [{ locale: "zh-TW", name: "繁體中文" }],
        translations: {
          displayName: "繁體中文",
          "Search(search dialog)": "搜尋",
          "Search(search trigger)": "搜尋",
          "Open Search(search trigger)(aria-label)": "開啟搜尋",
          "Close Search(search dialog)(aria-label)": "關閉搜尋",
          "No results found(search dialog)": "找不到結果",
          "On this page(table of contents)": "本頁內容",
          "Table of Contents(inline table of contents)": "本頁內容",
          "No Headings(table of contents)": "沒有標題",
          "Previous Page(pagination)": "上一頁",
          "Next Page(pagination)": "下一頁",
          "Toggle Menu(mobile menu)(aria-label)": "切換選單",
          "Open Sidebar(sidebar)(aria-label)": "開啟側欄",
          "Close Sidebar(sidebar)(aria-label)": "關閉側欄",
          "Toggle Theme(theme switcher)(aria-label)": "切換主題",
          "Light(theme switcher)(aria-label)": "淺色",
          "Dark(theme switcher)(aria-label)": "深色",
          "System(theme switcher)(aria-label)": "跟隨系統",
        },
      }}
      search={{
        SearchDialog: (props) => <MorroWiseSearchDialog {...props} corpus={searchCorpus} />,
        options: { links: searchLinks },
      }}
      theme={{ enabled: true }}
    >
      {children}
    </RootProvider>
  );
}

# 第一次 GSC 健檢 MVP 輸出樣板

## 目的

這份樣板用於 Search Ops Agent 的第一次健檢 MVP，把 GSC 匯出或 API、sitemap、crawler、URL Inspection 抽樣與人工檢查合併成 URL 級 backlog。

交付重點不是報表，而是每一筆 URL 接下來要怎麼處理、誰能處理、修完怎麼驗證。

## 輸入資料

### 必要輸入

| input | 說明 | 最低要求 |
|---|---|---|
| site_url | GSC property URL | URL-prefix property 需保留結尾 `/`，Domain property 使用 `sc-domain:example.com` |
| homepage_url | 網站首頁 | 用於 crawl 起點與重要頁辨識 |
| sitemap_url | sitemap 或 sitemap index | 可讀取、可解析、能列出候選 URL |
| gsc_index_export | GSC 網頁索引匯出 | 至少含問題類型與 URL |
| search_analytics_export | Search Analytics 匯出或 API 查詢 | 近 28-90 天 page/query/clicks/impressions/ctr/position |
| important_urls | 客戶或 Vincent 指定的重要頁 | 商業頁、服務頁、案例頁、FAQ、文章、產品頁 |
| editable_scope | 可修改範圍 | code / CMS / content / metadata / sitemap / robots / GSC |

### 建議輸入

| input | 說明 |
|---|---|
| url_inspection_sample | URL Inspection 抽樣結果，優先抽重要頁與高風險 URL |
| crawl_export | crawler 匯出，含 status、canonical、title、description、h1、links、indexability |
| recent_changes | 最近改版、搬站、刪頁、改網址、換 CMS 的時間點 |
| conversion_urls | 轉換頁或商業優先頁 |
| competitor_notes | 主要競品或參考頁 |

## URL Backlog CSV 欄位

CSV header：

```csv
url,page_type,should_index,issue_bucket,issue_type,evidence_source,evidence,recommendation,priority,owner,review_required,verification,status,notes
```

| 欄位 | 必填 | 值域 / 格式 | 說明 |
|---|---|---|---|
| url | yes | URL | 問題或候選 URL |
| page_type | yes | homepage / service / article / case / product / category / tag / parameter / media / other | 頁面類型 |
| should_index | yes | yes / no / uncertain | 是否應進入搜尋結果 |
| issue_bucket | yes | fix / noindex_or_canonical / ignore / monitor | 四大處理分類 |
| issue_type | yes | indexing / sitemap / robots / canonical / noindex / metadata / content / internal_link / performance / ctr / query_match / redirect / status_code | 主要問題 |
| evidence_source | yes | gsc_index / search_analytics / url_inspection / sitemap / crawler / pagespeed / manual | 證據來源 |
| evidence | yes | text | 可回查的具體證據 |
| recommendation | yes | text | 具體修正建議 |
| priority | yes | P0 / P1 / P2 / P3 | 修正優先級 |
| owner | yes | Vincent / client / engineer / content / pending | 下一步負責者 |
| review_required | yes | yes / no | 是否必須人工審核後才能改 |
| verification | yes | text | 修完後如何驗證 |
| status | yes | todo / doing / fixed / waiting / ignored / monitor | backlog 狀態 |
| notes | no | text | 補充脈絡 |

## JSON 版本

```json
{
  "site": {
    "site_url": "https://www.example.com/",
    "homepage_url": "https://www.example.com/",
    "sitemap_url": "https://www.example.com/sitemap.xml",
    "data_range": {
      "start": "YYYY-MM-DD",
      "end": "YYYY-MM-DD"
    },
    "editable_scope": ["code", "CMS", "content", "metadata", "sitemap"]
  },
  "backlog": [
    {
      "url": "https://www.example.com/service",
      "page_type": "service",
      "should_index": "yes",
      "issue_bucket": "fix",
      "issue_type": "metadata",
      "evidence_source": "crawler",
      "evidence": "Title is duplicated across 8 service pages.",
      "recommendation": "Rewrite title and H1 to match the service intent and primary query cluster.",
      "priority": "P1",
      "owner": "Vincent",
      "review_required": "yes",
      "verification": "Re-crawl page and confirm title/H1 uniqueness; monitor Search Analytics after 30 days.",
      "status": "todo",
      "notes": ""
    }
  ]
}
```

## 四大分類規則

### fix

放進 `fix` 的 URL 是「應被搜尋理解或收錄，且目前有可修問題」。

常見條件：

- 重要頁被 noindex、robots 擋、404、錯誤 redirect 或 canonical 指到不該指的頁。
- 重要頁已檢索未索引，且內容、內部連結、metadata 或 canonical 有明確可修點。
- Search Analytics 顯示高曝光低 CTR、排名 4-20、有曝光無點擊，且頁面有商業或內容價值。
- sitemap 內重要 URL 狀態不一致，例如 sitemap 內 URL 回 3xx/4xx、指向非 canonical、或缺少重要頁。

### noindex_or_canonical

放進 `noindex_or_canonical` 的 URL 是「不應獨立進搜尋結果，但需要用正確方式處理」。

常見條件：

- tag、參數頁、搜尋結果頁、重複分類頁、低價值歷史頁。
- 內容重複但有明確主版本，應 canonical 到主版本。
- 頁面不該進 Google，但目前只用 robots.txt 擋。robots.txt 主要管理 crawler access，不是讓頁面不出現在 Google 的可靠方式；要排除頁面應評估 noindex 或權限保護。

### ignore

放進 `ignore` 的 URL 是「不修也不追」。

常見條件：

- 測試頁、已廢棄 URL、低價值附件、無商業價值且不影響 sitemap 或索引健康。
- GSC 顯示問題，但 URL 本來就不該被 indexed，且已經有合理 noindex/canonical/404/410。
- 第三方或系統生成 URL 無法修改，且不影響重要頁。

### monitor

放進 `monitor` 的 URL 是「現在不改，但要下輪回看」。

常見條件：

- 剛新增、剛改版、剛提交 sitemap，還需要等待 Google 重新處理。
- URL Inspection 或 GSC 訊號不一致，需要更多樣本或時間確認。
- Search Analytics 有波動，但不足以判斷是內容、季節性、排名或技術問題。

## 問題類型與建議

| issue_type | 判斷來源 | 常見證據 | 建議修正 | 驗證方式 |
|---|---|---|---|---|
| indexing | GSC / URL Inspection | Indexed 狀態異常、已檢索未索引、找不到重要頁 | 補內容、補內部連結、修 canonical/noindex/sitemap 後重新觀察 | URL Inspection 抽查，30 天後比對 GSC |
| sitemap | sitemap / GSC / crawler | sitemap 有 3xx/4xx/noindex/非 canonical URL，或缺重要頁 | 清 sitemap，只保留應收錄 canonical 200 URL | 重新解析 sitemap，確認 GSC sitemap 狀態 |
| robots | robots.txt / crawler | 重要路徑被 Disallow，或用 robots 擋不該出現的頁 | 重要頁移除阻擋；排除頁面改用 noindex 或權限保護 | crawler 檢查 robots access，必要時人工確認 |
| canonical | URL Inspection / crawler | Google canonical 與 user canonical 不一致，或 canonical 指錯 | 修 canonical 指向主版本，處理重複頁 | URL Inspection 抽查，crawler 確認 canonical |
| noindex | crawler / manual | 重要頁有 noindex，或不重要頁缺 noindex | 重要頁移除 noindex；低價值頁補 noindex | crawler 確認 robots meta / X-Robots-Tag |
| metadata | crawler / manual / Search Analytics | title/description/H1 缺漏、重複、錯配 | 重寫 title、description、H1，對齊搜尋意圖 | 重新 crawl，30 天後看 CTR |
| content | manual / Search Analytics | 內容薄、重複、無明確主題、query/page 錯配 | 補內容、重排資訊、合併或刪除重複頁 | 人工審核，30 天後看 query/page 變化 |
| internal_link | crawler / manual | 重要頁孤兒、內部連結少、導航無入口 | 從首頁、服務頁、文章或 FAQ 補入口 | crawler 確認 inlinks 增加 |
| performance | PageSpeed / Lighthouse | 手機載入慢、Core Web Vitals 風險 | 壓縮圖片、減少阻塞資源、改善 LCP/CLS/INP | PageSpeed 或 Lighthouse 重測 |
| ctr | Search Analytics | 高曝光低 CTR，排名不差但點擊低 | 改 title/description、補更精準段落 | 30 天後比對 CTR |
| query_match | Search Analytics / manual | query 意圖與 landing page 內容不對 | 調整頁面主題、內部連結或新建更合適頁 | 比對 query/page 組合 |
| redirect | crawler | redirect chain、錯誤目的地、http/https 混亂 | 縮短 chain，指向最終 canonical URL | crawler 重跑 |
| status_code | crawler | 重要頁 4xx/5xx，或應刪頁未妥善處理 | 修復 200、設定 301/410、從 sitemap 移除 | HTTP 檢查與 sitemap 重驗 |

## 優先級規則

| priority | 條件 | 處理時間 |
|---|---|---|
| P0 | 重要頁無法被 crawl/index、robots/noindex/canonical/status/redirect 嚴重錯誤、sitemap 大量污染 | 立即處理 |
| P1 | 重要商業頁已檢索未索引、metadata 明顯錯配、內容薄、內部連結弱 | 本輪前 5-10 個任務 |
| P2 | 高曝光低 CTR、排名 4-20、內容可補強、schema/alt/performance 可改善 | 本月排程 |
| P3 | 低流量、低商業價值、歷史頁、tag/參數頁清理 | 有餘裕再處理或批次處理 |

## 合併流程

1. 建立候選 URL 清單：合併 sitemap URL、GSC 問題 URL、Search Analytics page、important_urls、crawler URL。
2. URL 正規化：統一 trailing slash、http/https、大小寫、query parameter 保留規則。
3. 標記 `page_type` 與 `should_index`：先依 URL pattern，再由人工校正重要頁。
4. 套入資料來源：把 GSC index、Search Analytics、URL Inspection、sitemap、crawler、manual evidence 合併到同一 URL。
5. 先分四大 bucket：`fix`、`noindex_or_canonical`、`ignore`、`monitor`。
6. 再分 `issue_type`：每筆只放一個主要問題，次要問題寫入 `notes`。
7. 設定 priority：依商業重要性、技術嚴重度、可修性、驗證成本排序。
8. 指派 owner 與 `review_required`：涉及 canonical/noindex/robots/sitemap/content rewriting 一律 `yes`。
9. 產出前 5-10 個任務：只選 P0/P1，且每筆都能直接交給實作者。
10. 設定 30 天回看欄位：每筆都要有可重新檢查的驗證方法。

## Search Analytics 查詢建議

最小 API 查詢：

```json
{
  "startDate": "YYYY-MM-DD",
  "endDate": "YYYY-MM-DD",
  "dimensions": ["page", "query"],
  "type": "web",
  "rowLimit": 25000
}
```

補充分群：

- `dimensions: ["page"]`：找機會頁與下滑頁。
- `dimensions: ["query", "page"]`：找 query/page 錯配。
- `dimensions: ["page", "device"]`：看手機與桌機差異。
- `dimensions: ["date", "page"]`：看改版或修正前後趨勢。

注意：

- Search Analytics rows 會依 clicks 排序，且受 Search Console 內部限制，不保證回傳所有資料列。
- 若使用近期資料，需標記資料是否可能尚未 finalized。
- CTR 是 0 到 1 的比例，輸出給客戶時可另轉成百分比。

## URL Inspection 抽樣規則

URL Inspection 不做全站掃描，只做抽樣與高風險驗證。

優先抽樣：

- 所有 P0 URL。
- 重要商業頁與首頁。
- sitemap 內狀態不一致的 URL。
- GSC 已檢索未索引中的高價值 URL。
- canonical/noindex/robots 修正前後的代表 URL。

注意：

- URL Inspection API 回傳的是 Google index 版本狀態，不是 live URL 可索引性測試。
- `inspectionUrl` 必須屬於 `siteUrl` 指定的 GSC property。
- 結果只作證據之一，不單獨作為自動改站依據。

## 初診交付檔案

### diagnostic-summary.md

必含：

- 網站與資料範圍。
- 主要風險 3-5 點。
- 前 5-10 個高優先任務。
- 不處理或延後處理的 URL 類型。
- 30 天回看方式。

### url-backlog.csv 或 url-backlog.json

必含：

- 所有欄位通過本文件 schema。
- 每筆都有 evidence、recommendation、priority、owner、verification。
- `review_required` 明確標示，避免 Agent 直接自動改站。

### 30-day-plan.md

必含：

- 本輪要修的 P0/P1 任務。
- 每個任務的 owner、預估輸出、驗證方式。
- 30 天後要重查的 GSC / crawler / Search Analytics 指標。

## 30 天回看欄位

回看時在 backlog 補以下欄位或另建 `30-day-review.md`：

| 欄位 | 說明 |
|---|---|
| fixed_at | 實際修正日期 |
| verification_result | pass / fail / partial / waiting |
| inspection_after | URL Inspection 或人工抽查摘要 |
| clicks_before / clicks_after | 修正前後 clicks |
| impressions_before / impressions_after | 修正前後 impressions |
| ctr_before / ctr_after | 修正前後 CTR |
| position_before / position_after | 修正前後 average position |
| next_action | done / monitor / revise / escalate |

## 範例 Backlog

```csv
url,page_type,should_index,issue_bucket,issue_type,evidence_source,evidence,recommendation,priority,owner,review_required,verification,status,notes
https://www.example.com/services,service,yes,fix,metadata,crawler,"Title duplicated with /service-old and H1 is generic","Rewrite title/H1 to match service intent; keep canonical self-referencing",P1,Vincent,yes,"Re-crawl title/H1/canonical; compare CTR after 30 days",todo,"Important commercial page"
https://www.example.com/?utm_source=test,parameter,no,noindex_or_canonical,canonical,crawler,"Parameter URL returns 200 and canonical points to itself","Canonical to https://www.example.com/ or exclude parameter from crawlable links",P2,engineer,yes,"Crawler confirms canonical target and sitemap excludes parameter URL",todo,"Do not noindex before confirming tracking need"
https://www.example.com/tag/news,tag,no,ignore,indexing,gsc_index,"Discovered - currently not indexed","Ignore; tag page has no independent search value and is not in sitemap",P3,Vincent,no,"No action; confirm not in sitemap during monthly cleanup",ignored,""
https://www.example.com/new-case,case,yes,monitor,url_inspection,url_inspection,"New page not yet indexed; published 3 days ago","Wait for crawl; add internal link from case index if still absent next week",P2,content,yes,"Recheck URL Inspection and Search Analytics in 14-30 days",monitor,"Recently published"
```

## 完成標準

第一次健檢 MVP 視為完成，需同時滿足：

- backlog 每筆都有 URL、問題類型、證據、建議修正、優先級、owner、驗證方式。
- 每筆都能歸入 `fix`、`noindex_or_canonical`、`ignore`、`monitor` 其中之一。
- 覆蓋索引狀態、sitemap、canonical、noindex、title/description/H1、內部連結與高曝光低 CTR。
- 涉及 canonical、noindex、robots、sitemap、內容重寫與刪頁的項目都有人工審核欄位。
- 前 5-10 個任務能直接交給 Vincent、客戶、工程或內容窗口執行。

## 官方參考

- https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview
- https://developers.google.com/search/docs/crawling-indexing/robots/intro

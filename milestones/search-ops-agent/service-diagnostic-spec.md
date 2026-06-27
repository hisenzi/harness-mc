# Search Ops Agent 初診服務規格

## 定位

Search Ops Agent 初診不是 SEO 報告，也不是保證收錄服務。

它是一個把 Google Search Console、sitemap、網站 crawl、頁面 metadata 與 Search Analytics 訊號，整理成 URL 級修正 backlog 的一次性服務。交付重點是「下一步怎麼修、誰能修、修完怎麼驗證」，不是把圖表搬進文件。

## ICP

優先服務：

- 已有網站上線，且能提供 GSC 權限或匯出資料的客戶。
- 網站主或 Vincent 能修改 code、CMS、內容、metadata、sitemap、canonical 或 noindex。
- 有明確商業頁面、內容頁、案例頁、產品頁、FAQ/知識頁，且在意 Google 搜尋曝光。
- 近期遇到「已檢索未索引」、「曝光低」、「CTR 低」、「改版後流量掉」、「sitemap 混亂」等問題。

暫緩服務：

- 只想要保證排名、保證收錄、短期流量承諾的客戶。
- 無法提供 GSC 權限、匯出檔或網站修改窗口的客戶。
- 網站內容仍未定稿，或大量頁面是測試頁、複製頁、空殼頁。
- 索引問題主要來自商業模式、內容品質或法規限制，但客戶只願意改技術設定。

## 服務方案

### 1. Search Ops 初診

一次性健檢，目標是在 3-5 個工作天內產出可執行 backlog。

交付：

- 資產與權限檢查
- GSC 索引問題分類
- Search Analytics 機會頁分析
- sitemap / robots / canonical / noindex audit
- URL 級修正 backlog
- 前 5-10 個高優先任務
- 30 天回看建議

### 2. Search Ops 月維護

每月固定巡檢，目標是讓網站保持可被 Google 理解、可被追蹤、可持續改善。

交付：

- 每週搜尋成效摘要
- 每月索引健康檢查
- 新增問題 URL 分類
- 高曝光低 CTR 頁面建議
- 排名 4-20 機會頁清單
- 本月已修 / 待修 / 待觀察 backlog

### 3. Search Ops 實作代管

在月維護之上加入實作，適合 Vincent 可直接修改的網站。

交付：

- metadata、canonical、noindex、sitemap、內部連結修正
- 內容補強建議或初稿
- schema / structured data 補強建議
- 修正後驗證紀錄
- 30 天成效回看

## 不承諾項目

- 不承諾 Google 一定收錄。
- 不承諾排名、流量或詢問量。
- 不用 Indexing API 推一般文章、產品頁、案例頁或企業官網頁。
- 不替代內容策略、品牌定位、商業頁文案與長期 SEO 投資。
- 不在未經人工審核時自動修改 canonical、noindex、robots 或 sitemap。

## Onboarding 輸入

必要：

- GSC property access，或 GSC 匯出檔。
- 網站首頁 URL。
- sitemap URL 或 sitemap index URL。
- 客戶認為重要的頁面清單。
- 可修改範圍：code、CMS、內容、metadata、DNS、GSC 權限。

建議：

- 近 3 個月 Search Analytics 匯出。
- GSC 網頁索引問題匯出。
- 最近改版、搬站、改網址、刪頁、換 CMS 的時間點。
- 客戶最在意的商業轉換頁。
- 主要競品或參考網站。

## 檢查項目

### 資產層

- GSC property 類型是否正確。
- sitemap 是否可讀、是否已提交、是否混入不該收錄頁。
- robots.txt 是否誤擋重要路徑。
- 重要頁 HTTP status 是否為 200。
- redirect chain 是否過長或指錯。

### 索引層

- 重要 URL 是否 indexed。
- Google canonical 與使用者 canonical 是否一致。
- 已檢索未索引 URL 是否為應修、應忽略、應 noindex/canonical、待觀察。
- sitemap 內是否有 noindex、redirect、404、非 canonical URL。
- 重要頁是否缺內部連結或成為孤兒頁。

### 內容層

- title、description、H1 是否唯一且對應搜尋意圖。
- 頁面是否太薄、重複、空泛或缺少明確主題。
- 重要頁是否有相關內部連結。
- 圖片 alt 是否支援內容理解。
- FAQ/結構化資料是否真的服務頁面內容，不為了標記而標記。

### 成效層

- 高曝光低 CTR 頁。
- 排名 4-20 機會頁。
- 有曝光無點擊頁。
- 近期曝光、點擊、CTR、position 下降頁。
- query 與 page 是否錯配。

### 體驗層

- PageSpeed / Lighthouse 的 performance、accessibility、SEO 建議。
- Core Web Vitals 風險頁。
- 手機版主要內容是否可讀、可點、可載入。

## URL 級 backlog 欄位

| 欄位 | 說明 |
|---|---|
| url | 問題 URL |
| page_type | 首頁 / 服務頁 / 文章 / 案例 / 商品 / 分類 / tag / 參數頁 |
| should_index | yes / no / uncertain |
| issue_type | indexing / sitemap / canonical / noindex / content / metadata / internal_link / performance / ctr |
| evidence | GSC、URL Inspection、crawler、Search Analytics 或人工檢查證據 |
| recommendation | 具體修正建議 |
| priority | P0 / P1 / P2 / P3 |
| owner | Vincent / 客戶 / 工程 / 內容 / 待確認 |
| verification | 修完後如何驗證 |
| status | todo / doing / fixed / waiting / ignored / monitor |

## 優先級規則

- P0：重要頁被 noindex、robots 擋、404、redirect 錯、canonical 指錯，或 sitemap 大量污染。
- P1：重要商業頁已檢索未索引、內容太薄、內部連結弱、title/H1 明顯錯配。
- P2：高曝光低 CTR、排名 4-20、內容可補強、schema 或圖片 alt 可改善。
- P3：低流量、低商業價值、歷史頁、tag/分類/參數頁清理。

## 交付格式

初診交付不超過三份：

1. `diagnostic-summary.md`：5-10 分鐘可讀完的決策摘要。
2. `url-backlog.csv` 或 `url-backlog.json`：URL 級 backlog。
3. `30-day-plan.md`：前 5-10 個任務與 30 天回看方式。

## 驗證方式

初診完成時：

- project/service spec 已定義服務邊界、ICP、三層方案與非承諾項目。
- backlog 每筆都有 URL、證據、建議、優先級、owner、驗證方式。
- 高優先任務能直接交付給實作者，不需要再讀完整報告才知道要做什麼。

修正後 30 天：

- 重新抽查高優先 URL 的 URL Inspection 狀態。
- 比對 Search Analytics 的 clicks、impressions、CTR、position。
- 標記 fixed / monitor / still failing / intentionally ignored。
- 產出下一輪候選任務。

## 官方 API 邊界

- Search Console API 可程式化存取常用報表與動作，包含 Search Analytics、已驗證網站列表與 sitemap 管理。
- Search Analytics API 可按 query、page、country、device、date 等維度查 clicks、impressions、CTR、position；資料量受 Search Console 內部限制，不保證回傳所有列。
- URL Inspection API 可查指定 URL 在 Google index 裡的狀態，但目前不是 live URL 可索引性測試。
- Indexing API 主要用於 JobPosting 與 livestreaming video 頁；Search Ops 不把它當一般頁面收錄工具。
- PageSpeed Insights API 可補 performance、accessibility、SEO 建議；頻繁自動化建議使用 API key，且 CrUX 真實資料供應方式需另行留意。

## 參考來源

- https://developers.google.com/webmaster-tools
- https://developers.google.com/webmaster-tools/v1/searchanalytics/query
- https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect
- https://developers.google.com/search/apis/indexing-api/v3/quickstart
- https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview
- https://developers.google.com/speed/docs/insights/v5/get-started

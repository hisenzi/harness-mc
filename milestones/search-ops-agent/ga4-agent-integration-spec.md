# Search Ops & Analytics Agent: GA4 數據追蹤與 Agent 整合規格

## 1. 任務定位與背景

在網站營運中，搜尋引流（GSC / Search Ops）與進站轉換（GA4 / Analytics Ops）為互為因果之雙引擎：
* **GSC（Search Ops 軌）**：負責檢測網站在 Google 搜尋上的能見度、收錄狀態（Indexability）、關鍵字排名與 CTR。
* **GA4（Analytics Ops 軌）**：負責追蹤訪客進站後的使用者行為、各管道成效（Paid, Organic, Referral, Direct）、表單與詢價轉換，並讓 AI Agent 具備數據驅動的營運與自動報表能力。

本規格定義如何將 **Google Analytics 4 (GA4)** 與 **AI Agent** 深度串接，達成「環境自動建置」、「事件打點上報」與「對話式數據分析」三大自動化能力。

---

## 2. 三大核心架構與邊界

```
                  ┌─────────────────────────────────┐
                  │            AI Agent             │
                  └───────┬─────────┬─────────┬─────┘
                          │         │         │
       1. 環境自動建置     │         │ 2. 打點  │ 3. 數據查詢
       (Admin API)        │         │ (MP)    │ (MCP / Data API)
                          ▼         ▼         ▼
                  ┌──────────────┬──────────────┬──────────────┐
                  │ GA4 後台資源 │  GA4 收集庫  │ GA4 報表系統 │
                  │  (Property)  │ (Measurement)│  (Reporting) │
                  └──────────────┴──────────────┴──────────────┘
```

### 模組 1：環境自動建置 (Provisioning via Google Analytics Admin API)
* **核心價值**：消除繁瑣的手動後台建立流程，以程式碼一鍵初始化專案的 GA4 資源與串流。
* **執行腳本**：`scripts/analytics/setup_ga_environment.py`
* **功能**：
  1. 透過 `AnalyticsAdminServiceClient` 查詢指定 Google 帳號授權之 Account。
  2. 自動建立 GA4 Property（指定名稱、時區 `Asia/Taipei`、幣別 `TWD`）。
  3. 自動建立網站資料串流（Web Data Stream，綁定網域 `default_uri`），取得 `Measurement ID` (`G-XXXXXXXXXX`)。
  4. 自動呼叫 `create_measurement_protocol_secret` 建立 Measurement Protocol API 密碼。
  5. 自動產出 `.env.analytics` 環境變數檔供後續模組讀取。

### 模組 2：事件打點上報 (Event Tracking via Measurement Protocol)
* **核心價值**：無需透過前端瀏覽器，Agent 可直接從伺服器端或工作流向 GA4 上報重要事件。
* **執行腳本**：`scripts/analytics/send_ga_event.py`
* **功能**：
  1. 封裝 GA4 Measurement Protocol HTTP POST 協議。
  2. 支援 Google 官方 Debug 驗證端點（`https://www.google-analytics.com/debug/mp/collect`），提前檢測 payload 結構。
  3. 支援 Live 正式發送端點（`https://www.google-analytics.com/mp/collect`），事件於 60 秒內反映至即時報表。
  4. 典型事件涵蓋：`agent_chat_lead`、`inquiry_submitted`、`automated_checkup_completed`。

### 模組 3：對話式報表分析 (Reporting & Insights via Google Analytics MCP)
* **核心價值**：讓 Agent 扮演專業數據分析師，可透過自然語言直接提問並獲得結構化數據回饋。
* **使用技術**：Google 官方開源 `googleanalytics/google-analytics-mcp`。
* **能力與邊界**：
  * **可操作**：調用 `run_report`、`run_realtime_report`、`run_funnel_report`、`get_account_summaries`。
  * **不可操作（安全防護）**：官方 MCP 為純 Read-Only 設計，杜絕 AI 誤改/誤刪後台設定與資源。

---

## 3. 認證與安全管理規範

1. **唯一憑證入口**：
   * 採用 Google Cloud 服務帳戶（Service Account）金鑰（`ga-credentials.json`）或 OAuth 2.0 Client ID（`client_secret.json`）。
   * 需在 Google Analytics 後台之「帳戶存取管理」中將該服務帳戶 Email 加入授權。
2. **防洩漏鐵律**：
   * 所有金鑰檔案（`*credentials*.json`、`client_secret*.json`、`token*.json`）及環境變數（`.env.analytics`）強制列入 `.gitignore`。
   * 程式碼中嚴格禁止出現任何硬編碼金鑰或絕對路徑。

---

## 4. 驗收標準 (Acceptance Criteria)

- [ ] **AC-1 (安全隔離)**：專案 `.gitignore` 包含金鑰與 `.env.analytics` 規則，Git 狀態無任何金鑰洩漏。
- [ ] **AC-2 (環境建置腳本)**：`setup_ga_environment.py` 在提供憑證後能獨立執行，成功回傳 Property ID、Stream ID、Measurement ID 與 API Secret，並寫入 `.env.analytics`。
- [ ] **AC-3 (事件發送驗證)**：`send_ga_event.py` 能通過 Google debug 端點校驗，且 `--live` 送出後在 GA4 即時報表能觀察到事件。
- [ ] **AC-4 (MCP 查詢支援)**：MCP 設定規格完備，Agent 能調用 GA4 API 查詢指定時間範圍內之流量與事件統計。

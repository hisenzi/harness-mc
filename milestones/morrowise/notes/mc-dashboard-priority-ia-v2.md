# MC 儀表板資訊優先級與繁中化決策 v2

> Task：`morrowise/mc-dashboard-priority-ia-v2`
> 行動正本：`$COLLAB/harness-mc/milestones/morrowise/tasks.json`
> 架構入口：待 JV-36 Document Source Registry 上線後，由 generated document index 在 `ARCHITECTURE.md` 產生薄連結；本頁不作架構正本。
> 目前結論（已核准）：保留既有資料鏈，先修正正本與優先級判斷，再把首頁收斂為「例外與行動優先」的繁中控制台；MC-LIVE-SYS-10 保留給後續 UI 下鑽實作。
> 身份邊界：`MC-DASH-V2` 是本 task 的治理／決策身份；`MC-LIVE-SYS-10` 是後續 UI 下鑽實作的規格與驗收身份。
> 執行狀態、優先級與下一步一律以 `tasks.json` 為準。

## 1. 決定與影響

### 核准決定

MC 首頁不再平均陳列所有系統資訊，而依下列順序呈現：

1. 需要立即處理的例外。
2. 目前工作焦點：進行中、受阻與下一個可執行任務。
3. 資料可信度：正本、最後更新、驗證結果與資料是否過期。
4. 整體運作概況。
5. 趨勢與預警。
6. 能力、治理、歷史與技術證據移到下鑽頁。

所有使用者可見標題、按鈕、狀態、空狀態與錯誤訊息使用繁體中文。Task ID、檔名、CLI、schema field 等技術識別碼可保留原文，但只作為次要資訊或下鑽證據。

### 預期影響

- 首頁優先回答：「現在要不要管、先管哪裡、資料能不能信？」
- `blocked`、需核准、驗證失敗等可行動項目不得被資料過期或一般警告遮蔽。
- 修正 `morrowise_living_system` 目前讀取 `harness-mc` project task chain 的正本錯置。
- 延用既有 13 個 surface 的 freshness、attention、next action、write boundary 與 verifier 資料，不重建第二套資料層。
- 首頁只留摘要；完整 task、event、worktree、approval 與技術證據使用下鑽頁查看。

### 本 task 邊界

- 本 task 只完成研究、判斷、最終方案與驗收設計，不直接修改 UI 或 generator。
- 不手改 `public/data/*.json`。
- 不把議題紀錄變成第二份 task 狀態表。
- 核准方案後，再依 ownership routing 建立必要的 MorroWise system 與 harness-mc surface 實作 task。

### 核准範圍（2026-07-20）

- 本 task 改列為 governance：它負責決定首頁順序、資料正本、繁中顯示與首頁／下鑽邊界，不直接做介面。
- `MC-DASH-V2` 保留為本決策的唯一 work anchor；`MC-LIVE-SYS-10` 保留為後續 UI 下鑽頁實作與驗收，兩者不得共用身份。
- 本輪沒有建立 implementation task，也沒有修改 UI、generator、read model 或 generated JSON。

## 2. 判斷脈絡

### 現況與限制

- 本次盤點時，`scripts/generate-morrowise-live-dashboard.mjs` 的 `morrowiseLivingSystemSurface()` 選取 `harness-mc` project，因此 surface 顯示 29 tasks／27 completed；canonical MorroWise 在建立本 task 前是 74 tasks／56 completed。
- 現行首頁同時承載 System Attention、Task Event Pipeline、MorroWise、主動閉環、worktree、視覺同步、治理、能力與學習內容，決策訊號被大量正常或技術資訊稀釋。
- `System Attention` 與 dashboard generator 各有排序與 freshness 判斷，存在同一事件重複發卡或次要警告遮蔽重大事項的風險。
- 既有 draft spec 已規劃 `/attention`、`/morrowise`、`/task-events`、`/worktrees`、`/approvals` 下鑽頁與繁中對照，但目前仍未形成可操作頁面。
- 現有 read-model chain 與 13 個 surfaces 可重用；完整重建會增加成本與新的漂移面。

### 方案取捨

| 方案 | 判斷 | 關鍵理由 |
|---|---|---|
| 只調整首頁文案與卡片順序 | 不採用 | 無法修正正本錯置、雙重排序與缺少下鑽頁等結構問題。 |
| 全面重建資料模型與首頁 | 不採用 | 既有 13 個 surfaces 已有可重用 contract；重建會製造第二套資料鏈。 |
| 保留資料鏈，修正正本與優先級 contract，再做首頁收斂與下鑽 | 已核准採用 | 能處理根因，同時控制改動面與未來維護成本。 |

### 證據與文獻

| 來源 | 關鍵觀點 | 如何影響本案 |
|---|---|---|
| [Stephen Few：Dashboard Design for Real-Time Situation Awareness](https://perceptualedge.com/articles/Whitepapers/Dashboard_Design.pdf) | 儀表板應整合達成目標所需的最重要資訊，支援快速掌握情勢。 | 首頁只保留最重要且需要反應的資訊；正常狀態壓縮為摘要。 |
| [Ben Shneiderman：The Eyes Have It](https://www.cs.umd.edu/~ben/papers/Shneiderman1996eyes.pdf) | 先概覽，再縮放與篩選，最後按需看細節。 | 採首頁概覽加下鑽頁，不把 task、registry、log 與原始證據全部塞在首頁。 |
| [Nielsen Norman Group：Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | 初始畫面只顯示最重要與最常用內容，專門資訊按需揭露。 | 能力、治理與歷史預設不展開；常用異常詳情維持一個動作可達。 |
| [Nielsen Norman Group：Visibility of System Status](https://www.nngroup.com/articles/visibility-system-status/) | 系統必須及時說明正在發生什麼，以及使用者下一步能做什麼。 | 每個例外都要顯示影響、最後更新與可執行下一步。 |
| [Google SRE：Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) | 先看症狀與影響，警示必須可行動，根因留給調查層。 | 沒有下一步的資訊不進「需要你處理」；同一事件的多個訊號合併。 |
| [Grafana：Dashboard Best Practices](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/) | 每個 dashboard 應回答明確問題，資訊由一般到具體排列。 | 各區塊直接用問題命名，並建立首頁到詳情的穩定層級。 |
| [W3C：Localization vs. Internationalization](https://www.w3.org/International/questions/qa-i18n) | 在地化不只翻譯，也包含日期、數字、排序與閱讀習慣。 | 採 `zh-TW` 與 `Asia/Taipei` 顯示規則，不只替換英文標題。 |

## 3. 演進與驗證

| 日期 | 新資訊或發現 | 決策如何改變 | 證據 |
|---|---|---|---|
| 2026-07-19 | 初始需求要求重新規劃 MC 儀表板、全繁中並依輕重緩急排序。 | 從一般視覺優化提升為資訊架構、優先級與正本邊界問題。 | `app/page.tsx`、現行 dashboard data。 |
| 2026-07-19 | 唯讀盤點發現 MorroWise surface 讀取 `harness-mc` task chain，以及首頁、排序、路由和語言的多重缺口。 | 不採只改文案；先處理資料可信度與決策訊號，再調整畫面。 | generator、read-model contract、drilldown draft spec。 |
| 2026-07-19 | HC 檢查顯示原先 Task、Dossier、Spec、ADR、Article Seed、Daily Memory 六層結構會增加維護與漂移。 | 改採「一題兩檔」：Task 管行動，單頁議題紀錄管思考；其他輸出按需產生。 | `#rightProblem`、`#infoNeeded`、`#optimization`、`#organization`、`#vincentThinking`。 |
| 2026-07-19 | Vincent 核准使用 JV-32。 | 以 `JV-32/task-lifecycle:create` 建立 canonical work anchor，暫不進入 UI 實作。 | `morrowise-task-lifecycle.md`。 |
| 2026-07-19 | Vincent 要求演進紀錄與文章素材可由整體架構找到。 | 保留本頁為決策脈絡正本，改由 JV-36 registry 在 `ARCHITECTURE.md` 生成薄連結，不手寫或複製正文。 | `document-source-registry-and-human-sync`、`promote-to-architecture`。 |
| 2026-07-19 | 發現 `MC-LIVE-SYS-10` 已被既有下鑽頁 spec 與驗收 ID 使用。 | 規劃 task 保留 `mc-dashboard-priority-ia-v2`，另以 `MC-DASH-V2` 作為 order label，避免與後續 UI 實作身份碰撞。 | `morrowise-live-dashboard-drilldown-pages.md`、`tasks.json`。 |
| 2026-07-20 | Vincent 核准最終 IA，要求本 task 改列 governance 並解除身份碰撞。 | `MC-DASH-V2` 成為治理／決策 work anchor；`MC-LIVE-SYS-10` 專供後續 UI 下鑽實作的規格與驗收。本輪不建立 implementation task。 | 本 session 的明確核准、`morrowise-live-dashboard-drilldown-pages.md`。 |

### 後續驗證門檻

- 5 秒內能指出是否有急件、第一個動作及資料是否可信。
- MorroWise 活系統顯示 canonical MorroWise task chain，不再以歷史 `harness-mc/morrowise-system` track 代替。
- 可行動例外的排序高於單純 stale／watch 資訊，同一事件不重複發卡。
- 首頁與下鑽頁的使用者可見文字除技術識別碼外無英文。
- 五個預定下鑽 route 真實存在並讀取對應 generated data，不以 hardcoded mock 假裝正常。
- 另一個 Agent 只讀 Task 與本頁，即可說明目前決定、理由、證據與下一步，不需要重讀聊天。

## 4. 文章素材

### 核心論點

好的儀表板不是把資料展示完整，而是把「該不該行動、先做什麼、資料能不能信」壓縮成幾秒內可完成的判斷。

### 反直覺發現

- 卡片越多，不一定越可觀測；正常資訊與 stale 警告太多，反而可能遮蔽真正需要處理的項目。
- UI 看似有 MorroWise 卡片，不代表它正在讀 MorroWise 正本；錯的 project task chain仍能產生外觀合理的數字。
- 「統一管理」不是把所有文件搬到一起，而是讓每一種資訊只有一個正本，並從同一個 task 找得到。

### 可用案例

- 盤點時畫面顯示 29 tasks／27 completed，但建立本 task 前的 canonical MorroWise 是 74 tasks／56 completed：這是 surface 合理、source 錯誤的典型假活案例。
- 原本規劃六種文件角色，HC 分析後收斂為 Task＋單頁議題紀錄，降低每次判斷「該寫哪裡」的成本。

### 候選題目

1. 《真正有用的儀表板，不是完整，而是讓你知道下一步》
2. 《卡片都有資料，為什麼儀表板仍可能是假的？》
3. 《從六種文件收斂成兩個正本：AI 協作如何避免知識漂移》

## 5. Phase 2A 治理定錨與對帳（2026-07-22）

本段只記錄已核准 task 的 canonical 對帳與啟動順序；行動狀態仍以 `tasks.json` 為唯一正本，不在本頁複製 status 或 progress。

### 已對帳的 operation batch

| 項目 | Canonical task／owner | 對帳結論 | 本階段操作與開始門檻 |
|---|---|---|---|
| IA 決策錨點 | `morrowise/mc-dashboard-priority-ia-v2` | 既有 `MC-DASH-V2` 已是 governance；`MC-LIVE-SYS-10` 已只屬 UI spec／驗收。 | 保留既有身份；本頁只補對帳紀錄，不重做 UI。JV-36 產生薄連結前不可結案。 |
| Action Priority Read Model | `morrowise/action-priority-read-model-v2` | 已核准 `genuinely_new`，是 canonical task 的唯讀 priority 層。 | 選為唯一 weekly core；本週只完成 deterministic input／output、priority／dedupe／freshness／verifier contract，不做 UI、daily loop 或 task state 自動化。 |
| Trusted Heartbeat Runtime | `morrowise/trusted-heartbeat-runtime-v1` | 已核准 `genuinely_new`，沿用既有 scheduler，不另建 scheduler。 | 維持 todo；只在 priority read model 完成後才供後續 daily loop 與 JV-36.R5 消費。 |
| Reality Tax lineage | `morrowise/reality-tax-daily-review-task` → `morrowise/morrowise-live-decision-loop-v1` | `replace` 已完成：舊 task 為 cancelled，successor 已建立。 | 禁止啟動 successor，直到 priority read model、trusted heartbeat 與 lifecycle gate 都通過；不得建立第二個 daily loop。 |
| 文件控制面 | `morrowise/document-source-registry-and-human-sync`（JV-36） | 既有 Roadmap-in-Anchor；R1–R5 已定義。 | 維持同一 anchor；R1–R4 不是另一個 task identity，R5 必須等待 trusted heartbeat。 |
| 儀表板 surface | `harness-mc/morrowise-priority-dashboard-surface-v2` | 既有 surface task，且已被 priority read model 阻擋。 | 維持 blocked；只能在 read model 驗收後做繁中首頁與五個真實下鑽。 |
| Skill candidate gate | `morrowise/skill-candidate-review-gate`（JV-41） | 既有 closeout-only review gate。 | 維持 todo；每個 task 的 E2E／closeout 成功時才做候選提醒，不建立或安裝 skill。 |

### 唯一 weekly core 與依賴邊界

2026-07-22 選入 `action-priority-read-model-v2` 作為唯一 weekly core，`review_date=2026-07-29`。選擇理由是 JV-36.R1–R4 各自仍為完整文件治理交付，不能把文字 slice 偽裝成可由 lifecycle 管理的獨立 weekly core；priority read model 則已有單一 canonical owner、可驗證輸入輸出與明確的下游 consumer。

依賴順序固定為：`JV-32／JV-40 lifecycle gates → Action Priority Read Model → {harness-mc Surface, Live Daily Decision Loop}`；`既有 scheduler／run evidence → Trusted Heartbeat Runtime → {Live Daily Decision Loop, JV-36.R5}`。JV-36.R1–R4 與 priority core 可各自排程，但本週只允許一個 `weekly_core=true`。

### Phase 2A 的可驗證不變量

- MorroWise system／governance tasks 只以 `$COLLAB/harness-mc/milestones/morrowise/tasks.json` 為 canonical task state；harness-mc surface task 只消費它的 read model，不持有可寫 task state。
- 舊 Reality Tax task 維持 cancelled，successor 未執行；本階段沒有第二個 active daily decision loop，也沒有新增 scheduler、`jobs.json` 或 cron。
- `weekly_core` 只允許一個、必為 `in_progress` 且含明確 `review_date`；到期只能經 Vincent 的 reframe／suspend／cancel／complete 決策，不得自動延期。
- 每個下游實作在開始前都必須記錄 owner、正本、輸入、輸出、verifier、停止條件與 architecture decision；本階段本身不提前做 Architecture Admission。

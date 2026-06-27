# MorroWise 活儀表板明細頁規格

> Task: `MC-LIVE-SYS-10`
> Status: draft spec
> Updated: 2026-06-21
> Scope: 首頁摘要、側欄分流、五個明細頁、資料接線、繁中顯示與驗收任務。

## 目的

這份文件把活儀表板從「首頁塞所有區塊，再用錨點跳轉」改成「首頁摘要 + 側欄分流 + 明細頁」。

本規格只定義頁面、資料、連結與驗收，不代表已完成實作。實作前必須先確認本規格。

## 成功定義

| 項目 | 通過條件 |
|---|---|
| 首頁 | 只顯示摘要、下一步、資料新鮮度、待批准數、commit gate 狀態。 |
| 側欄 | 點擊後進入對應 route，不再用 `#anchor` 跳同頁區塊。 |
| 明細頁 | 五個明細頁都能讀真實 `public/data/*.json`，不可使用假資料。 |
| 繁中 | 使用者可見標題、按鈕、狀態說明必須是繁中。 |
| 唯讀 | 任何頁面都不可直接改 task、commit、push、deploy、套用 event 或同步外部工具。 |
| 驗收 | 五個使用任務能在頁面上完成，不靠聊天說明。 |

## 清楚驗收條件格式

清楚的驗收項目必須能被不同 agent、不同時間重跑，並得到同一個通過或不通過判斷。不得只寫「看起來正常」、「能回答問題」、「體驗順暢」。

每個驗收項目必須包含：

| 欄位 | 定義 |
|---|---|
| 驗收編號 | 穩定 ID，方便回報與追蹤。 |
| 要驗什麼 | 單一行為或單一頁面，不混多個目標。 |
| 前置資料 | 要先存在的 data file、route、fixture 或狀態。 |
| 操作步驟 | 使用者或 verifier 要怎麼走到結果。 |
| 通過條件 | 可觀察、可比對、可重跑的結果。 |
| 失敗條件 | 出現哪些狀況即判定不通過。 |
| 驗證方式 | 人工點擊、Playwright、script、`rg`、`npm run build` 等。 |

判定規則：

- 通過條件要能回答「看到什麼才算通過」。
- 失敗條件要能回答「看到什麼一定不通過」。
- 每項只能驗一件事；多件事要拆成多項。
- 不得把「需要 Vincent 自己理解」當作通過條件。
- 不得把聊天說明當作頁面已完成。

## 繁中顯示規則

UI 顯示文字一律繁中。英文只允許出現在：

- route，例如 `/worktrees`
- JSON key，例如 `generated_at`
- 檔名與路徑，例如 `public/data/worktrees.json`
- 指令，例如 `npm run build`
- task id、commit hash、repo name、技術識別碼

| 禁止直接顯示 | 顯示為 |
|---|---|
| `Live Dashboard` | 活儀表板 |
| `System Attention` | 系統注意事項 |
| `Task Event Pipeline` | 任務事件管線 |
| `Worktree Status` | 待收尾工作 |
| `Approval Queue` | 待批准項目 |
| `Freshness` | 資料新鮮度 |
| `Primary Next Action` | 下一步 |
| `Boundary` | 操作邊界 |
| `Drill-down` | 明細頁 |
| `read-only` | 唯讀 |
| `pending` | 待處理 |
| `rejected` | 已拒絕 |
| `applied` | 已套用 |
| `failed` | 失敗 |
| `blocked` | 卡住 |
| `stale` | 資料過期 |
| `degraded` | 資料降級 |
| `fresh` | 資料新鮮 |

## 頁面清單

| 顯示名稱 | Route | 主要問題 |
|---|---|---|
| 首頁摘要 | `/` | 現在要不要處理、優先處理哪裡、資料新不新。 |
| 系統注意事項 | `/attention` | 哪些 stale、blocked、queue 需要處理。 |
| MorroWise 活系統 | `/morrowise` | MorroWise 任務鏈、open loop、主動閉環狀態。 |
| 任務事件管線 | `/task-events` | task event / sync event 是否 pending、rejected、failed。 |
| 待收尾工作 | `/worktrees` | 哪些 repo 未 commit、未 push、需要 worktree-commit。 |
| 待批准項目 | `/approvals` | 哪些動作需要 Vincent 批准，原因與邊界是什麼。 |

## 首頁摘要 `/`

首頁是判斷層，不是明細層。

### 資料來源

| 資料 | 用途 |
|---|---|
| `public/data/morrowise-live-dashboard.json.summary` | 整體新鮮度、最高注意等級、主要下一步、待批准數。 |
| `public/data/morrowise-live-dashboard.json.completion_gate.worktree_commit` | commit gate 是否 pending。 |
| `public/data/morrowise-live-dashboard.json.surfaces[]` | 最多顯示幾個需要注意的 surface 摘要。 |

### 顯示區塊

| 區塊 | 顯示 |
|---|---|
| 狀態摘要 | 最高注意等級、資料新鮮度、待批准數、commit gate 狀態。 |
| 下一步 | `summary.primary_next_action.label` 的繁中版本。 |
| 快速入口 | 連到五個明細頁。 |
| 操作邊界 | 明確顯示「首頁唯讀」。 |

### 首頁不得顯示

- 完整 task list。
- 完整 dirty file list。
- 完整 pending event list。
- 完整 approval payload。
- 大量 raw JSON 欄位。

## 系統注意事項 `/attention`

用來回答：「目前最需要注意的是什麼？」

### 資料來源

| 資料 | 欄位 | 用途 |
|---|---|---|
| `public/data/morrowise-live-dashboard.json.summary` | `overall_freshness_state`, `highest_attention_level`, `primary_next_action`, `stale_surface_count`, `degraded_surface_count` | 頁首狀態。 |
| `public/data/morrowise-live-dashboard.json.surfaces[]` | `label`, `freshness_state`, `attention_level`, `next_action`, `freshness_reason`, `evidence_refs` | surface 注意清單。 |
| `public/data/changes.json` | `events`, `stale`, `blocked_now`, `brief`, `generated_at` | stale / blocked / 今日變化。 |
| `public/data/task-events.json` | `task_events.pending`, `task_events.rejected`, `sync_events.pending`, `sync_events.failed` | queue 壓力。 |

### 頁面區塊

| 區塊 | 顯示 | 連結 |
|---|---|---|
| 注意總覽 | stale、blocked、queue、資料新鮮度 | 無 |
| 需要處理的 surface | 每個 surface 的繁中名稱、狀態、下一步 | 依 `drilldown_route` 連到對應頁 |
| stale / blocked | project、task、原因、天數或狀態 | task 脈絡連 `/projects` |
| queue 摘要 | pending / rejected / failed 數量 | `/task-events` |
| commit gate 摘要 | 有未收尾工作時顯示 | `/worktrees` |

### 驗收任務

使用者能從此頁回答：

1. 現在是否有需要處理的 stale / blocked / queue。
2. 哪一類問題優先。
3. 需要去 `/task-events` 還是 `/worktrees` 繼續處理。

## MorroWise 活系統 `/morrowise`

用來回答：「MorroWise 活系統目前到哪裡？下一個 open loop 是什麼？」

### 資料來源

| 資料 | 欄位 | 用途 |
|---|---|---|
| `public/data/projects.json` | `project === "harness-mc"`, `tasks[]` | MorroWise task chain。 |
| `public/data/morrowise-live-dashboard.json.surfaces[]` | `morrowise_living_system`, `morrowise_proactive_loop` | 活系統 surface 摘要。 |
| `public/data/morrowise-proactive-loop.json` | `summary`, `scenarios[]` | 主動閉環狀態。 |
| `public/data/task-events.json` | recent task events | feedback / write-back 脈絡。 |

### 頁面區塊

| 區塊 | 顯示 | 連結 |
|---|---|---|
| 任務鏈摘要 | MorroWise tasks 完成數、下一個未完成 task | `/projects` |
| open loop | 未閉合 loop、blocked loop、等待 approval loop | `/approvals` 或 `/task-events` |
| 主動閉環 | trigger、recommendation、approval、action、feedback | `/approvals` |
| 來源與邊界 | source files、verifier、唯讀限制 | 無 |

### 任務篩選規則

MorroWise task 來自 `public/data/projects.json` 中 `harness-mc` project，符合任一條件：

- `track === "morrowise-system"`
- `id` 以 `morrowise-` 開頭
- `order_label` 以 `MC-LIVE` 開頭

### 驗收任務

使用者能從此頁回答：

1. MorroWise 目前完成到哪個 task。
2. 下一個未閉合項目是什麼。
3. 哪些 loop 等待 approval 或 feedback。

## 任務事件管線 `/task-events`

用來回答：「task event / sync event 管線有沒有卡住？」

### 資料來源

| 資料 | 欄位 | 用途 |
|---|---|---|
| `public/data/task-events.json.task_events` | `pending`, `applied`, `rejected`, `rejected_by_reason` | task event 狀態。 |
| `public/data/task-events.json.sync_events` | `pending`, `synced`, `failed`, `by_target` | sync event 狀態。 |
| `public/data/task-events.json.latest_reducer_run` | `generated_at`, `applied`, `rejected`, `duplicates` | reducer 最近執行結果。 |
| `public/data/task-events.json.recent_task_events[]` | `id`, `queue`, `type`, `project`, `task_id`, `reason` | 最近 task events。 |
| `public/data/task-events.json.recent_sync_events[]` | `id`, `queue`, `type`, `target`, `project`, `task_id` | 最近 sync events。 |

### 頁面區塊

| 區塊 | 顯示 | 連結 |
|---|---|---|
| 管線總覽 | task pending、sync pending、rejected、failed | 無 |
| reducer 狀態 | 最近執行時間、套用數、拒絕數、重複數 | 無 |
| task events | event id、type、project、task id、reason | `/projects` |
| sync events | target、project、task id、狀態 | `/attention` 或 `/projects` |

### 操作邊界

此頁只顯示，不執行：

- `apply-task-events`
- external sync
- overwrite tasks
- retry failed sync

### 驗收任務

使用者能從此頁回答：

1. 現在有幾筆 pending event。
2. 有沒有 rejected 或 failed。
3. 哪個 project / task 被卡住。

## 待收尾工作 `/worktrees`

用來回答：「哪些 repo 還沒 commit / push？」

### 資料來源

| 資料 | 欄位 | 用途 |
|---|---|---|
| `public/data/worktrees.json.summary` | `scanned`, `uncommitted`, `local_commits`, `needs_reconcile`, `clean` | 總覽。 |
| `public/data/worktrees.json.repositories[]` | `repo`, `path_label`, `branch`, `head`, `status`, `risk`, `suggested_action` | repo 狀態。 |
| `public/data/worktrees.json.repositories[].files[]` | `indexStatus`, `worktreeStatus`, `path` | dirty files。 |
| `public/data/morrowise-live-dashboard.json.completion_gate.worktree_commit` | `state`, `required_evidence`, `blocker` | commit gate。 |

### 頁面區塊

| 區塊 | 顯示 | 連結 |
|---|---|---|
| 收尾總覽 | 未提交、未推送、需對帳數量 | 無 |
| repo 清單 | repo、branch、head、狀態、建議動作 | 無 |
| dirty files | staged / unstaged / untracked 前幾筆 | 無 |
| commit gate | 需要的 evidence、blocker、下一步 | worktree-commit skill path |

### 操作邊界

此頁不得提供一鍵 commit / push / reset / delete。只能提示：

```text
請走 worktree-commit 流程。
```

### 驗收任務

使用者能從此頁回答：

1. 哪些 repo 還沒 commit。
2. 哪些 repo 有本機未推送 commit。
3. 下一步是否該走 worktree-commit。

## 待批准項目 `/approvals`

用來回答：「哪些動作需要 Vincent 批准？」

### 資料來源

| 資料 | 欄位 | 用途 |
|---|---|---|
| `public/data/morrowise-live-dashboard.json.approval_queue[]` | `id`, `action_class`, `requested_action`, `destination`, `owner`, `payload_preview`, `closure_condition`, `write_boundary` | approval 清單。 |
| `public/data/morrowise-proactive-loop.json.scenarios[]` | `approval.requires_approval`, `approval.policy`, `action.output_type`, `feedback.status` | approval 來源脈絡。 |
| `system-workflow/registries/morrowise-approval-policy.json` | action policy tiers | policy 依據。 |

### 頁面區塊

| 區塊 | 顯示 | 連結 |
|---|---|---|
| 批准總覽 | 待批准數、風險分類 | 無 |
| 待批准清單 | action class、請求動作、目的地、owner、payload preview | `/morrowise` 或 `/worktrees` |
| policy 依據 | allowed / approval_required / forbidden 摘要 | registry path |
| 操作邊界 | 此頁不可代替 Vincent 批准 | 無 |

### 驗收任務

使用者能從此頁回答：

1. 有哪些動作需要批准。
2. 為什麼需要批准。
3. 批准前要看哪個脈絡頁。

## 側欄連結規格

側欄不得使用下列同頁錨點作為主要 navigation：

- `#system-attention`
- `#task-event-pipeline`
- `#worktree-status`
- `#approval-queue`
- `#freshness`

側欄必須使用 route：

| 顯示文字 | Route |
|---|---|
| 首頁摘要 | `/` |
| 系統注意事項 | `/attention` |
| MorroWise 活系統 | `/morrowise` |
| 任務事件管線 | `/task-events` |
| 待收尾工作 | `/worktrees` |
| 待批准項目 | `/approvals` |
| 專案與任務 | `/projects` |
| 工具與技能 | `/tools` |
| 學習進度 | `/learning` |

## 頁面間連結規則

| 來源 | 目標 | 條件 |
|---|---|---|
| `/` | 五個明細頁 | 摘要卡、側欄、下一步入口。 |
| `/attention` | `/task-events` | queue / reducer / event 問題。 |
| `/attention` | `/worktrees` | commit gate / dirty work 問題。 |
| `/attention` | `/approvals` | approval required 問題。 |
| `/morrowise` | `/approvals` | proactive loop 等待批准。 |
| `/morrowise` | `/task-events` | feedback write-back / event queue 問題。 |
| `/task-events` | `/projects` | event 指向 project / task。 |
| `/worktrees` | `$COLLAB/notyet-harness/000_Agent/skills/worktree-commit/SKILL.md` | 需要 commit gate。 |
| `/approvals` | `/morrowise` | approval 來自主動閉環。 |
| `/approvals` | `/worktrees` | approval 類型是 commit / push / deploy。 |

## 禁止項目

- 不得把 browser screenshot 當 source of truth。
- 不得從 Obsidian Canvas 或 Heptabase card 反向覆寫 task 狀態。
- 不得在頁面上提供會寫入 state 的按鈕。
- 不得把英文 label 直接顯示給使用者。
- 不得把所有明細留在首頁，然後只用錨點跳轉。

## 實作順序

| 順序 | 工作 | 驗收 |
|---:|---|---|
| 1 | 新增共用繁中 navigation / label 字典。 | `Task Event Pipeline` 等英文不再出現在 UI 顯示層。 |
| 2 | 建立五個明細頁 route。 | `/attention`、`/morrowise`、`/task-events`、`/worktrees`、`/approvals` 都可開。 |
| 3 | 每頁接真實資料。 | 每頁至少顯示本規格列出的主要欄位。 |
| 4 | 首頁降密度。 | 首頁只留摘要與入口，不再展開完整明細。 |
| 5 | 側欄改 route link。 | 點擊側欄後 URL 變成對應 route，不是 `#anchor`。 |
| 6 | 補 verifier。 | route、資料來源、繁中詞彙、唯讀邊界可檢查。 |
| 7 | 跑 build。 | `npm run build` 通過。 |

## 驗收矩陣

| ID | 要驗什麼 | 前置資料 | 操作步驟 | 通過條件 | 失敗條件 | 驗證方式 |
|---|---|---|---|---|---|---|
| `MC-LIVE-SYS-10-A01` | 首頁只做摘要，不展開完整明細。 | `public/data/morrowise-live-dashboard.json` 已生成。 | 開 `/`。 | 首頁只出現摘要、下一步、資料新鮮度、待批准數、commit gate、五個明細入口。 | 首頁直接列出完整 task list、完整 dirty files、完整 event list 或完整 approval payload。 | 人工檢查 + Playwright screenshot。 |
| `MC-LIVE-SYS-10-A02` | 側欄使用真實 route。 | app route 已建立。 | 逐一點擊側欄：首頁摘要、系統注意事項、MorroWise 活系統、任務事件管線、待收尾工作、待批准項目。 | URL 依序變成 `/`、`/attention`、`/morrowise`、`/task-events`、`/worktrees`、`/approvals`。 | URL 仍是 `/#...`，或畫面只是在首頁內捲動。 | Playwright click test。 |
| `MC-LIVE-SYS-10-A03` | 系統注意事項頁能判斷目前優先處理項。 | `public/data/morrowise-live-dashboard.json`、`public/data/changes.json`、`public/data/task-events.json` 存在。 | 開 `/attention`。 | 頁面顯示 stale、blocked、queue、資料新鮮度，以及至少一個可連到 `/task-events`、`/worktrees` 或 `/approvals` 的下一步入口。 | 只顯示泛用說明，沒有狀態數字、原因或下一步入口。 | Playwright + data fixture assertion。 |
| `MC-LIVE-SYS-10-A04` | MorroWise 活系統頁能找出下一個 open loop。 | `public/data/projects.json`、`public/data/morrowise-proactive-loop.json` 存在。 | 開 `/morrowise`。 | 頁面顯示 MorroWise task 完成狀態、下一個未閉合項目、等待 approval 或 feedback 的 loop。 | 只有靜態文案，沒有 task id、loop 狀態或資料來源。 | Playwright + fixture assertion。 |
| `MC-LIVE-SYS-10-A05` | 任務事件管線頁能判斷 event 是否卡住。 | `public/data/task-events.json` 存在。 | 開 `/task-events`。 | 頁面顯示 task pending、task rejected、sync pending、sync failed、最近 reducer 執行時間與最近事件。 | 找不到 pending / rejected / failed 數量，或仍顯示英文標題 `Task Event Pipeline`。 | Playwright + `rg` 禁字檢查。 |
| `MC-LIVE-SYS-10-A06` | 待收尾工作頁能判斷哪些 repo 要 commit / push。 | `public/data/worktrees.json` 存在。 | 開 `/worktrees`。 | 頁面顯示 repo、branch、head、未提交數、本機未推送數、建議走 worktree-commit。 | 看不到 repo 狀態，或頁面提供一鍵 commit / push / reset / delete。 | Playwright + DOM text assertion。 |
| `MC-LIVE-SYS-10-A07` | 待批准項目頁能判斷為何需要 Vincent 批准。 | `public/data/morrowise-live-dashboard.json.approval_queue[]`、`system-workflow/registries/morrowise-approval-policy.json` 存在。 | 開 `/approvals`。 | 頁面顯示 action、原因、owner、closure condition、write boundary、policy 依據。 | 只有「需要批准」但沒有原因、邊界或回到脈絡頁的連結。 | Playwright + data fixture assertion。 |
| `MC-LIVE-SYS-10-A08` | UI 顯示文字強制繁中。 | app build output 可檢查。 | 掃描 app 與生成頁面。 | 使用者可見區域不得出現禁止英文：`Task Event Pipeline`、`Approval Queue`、`Worktree Status`、`System Attention`、`Freshness`、`Primary Next Action`、`Boundary`、`Drill-down`、`read-only`。 | 禁止英文出現在標題、按鈕、卡片、狀態說明或側欄。 | `rg` 禁字檢查 + Playwright text check。 |
| `MC-LIVE-SYS-10-A09` | 五個明細頁都讀真實資料。 | `public/data/*.json` 已生成。 | 開五個明細頁。 | 每頁至少顯示一個來自對應 data file 的值，例如 generated time、count、repo、event id、task id 或 approval id。 | 頁面只靠 hardcoded mock data，或資料檔不存在時仍假裝正常。 | fixture test + build。 |
| `MC-LIVE-SYS-10-A10` | 整個儀表板維持唯讀。 | app route 已建立。 | 掃描 UI 與程式。 | 頁面沒有會寫入 task、commit、push、deploy、apply event、external sync 的互動控制。 | 出現一鍵套用、一鍵同步、一鍵 commit、一鍵 push、一鍵 deploy 或 reset/delete 類操作。 | `rg` action keyword 檢查 + 人工 UI 檢查。 |

## 驗證命令

最小驗證：

```bash
rg -n "Task Event Pipeline|Approval Queue|Worktree Status|System Attention|Freshness|Primary Next Action|Boundary|Drill-down|read-only" app system-workflow/docs/mockups
npm run build
```

實作完成後必須新增或更新 verifier，檢查：

- 五個 routes 存在。
- 首頁側欄 links 指向 routes，不是同頁 anchors。
- 使用者可見文字沒有禁止英文。
- 每頁 fetch 的資料檔存在。
- 頁面沒有寫入型操作。

## 後續文件更新

實作 `MC-LIVE-SYS-10` 時，至少要同步更新：

| 文件 / 程式 | 更新內容 |
|---|---|
| `system-workflow/docs/specs/morrowise-live-dashboard-routing.md` | 把 current route map 從 homepage anchor 改成 real route。 |
| `system-workflow/docs/specs/morrowise-live-dashboard-read-model-contract.md` | 將 routes 規格從 future route 升級為 current route。 |
| `scripts/generate-morrowise-live-dashboard.mjs` | route labels 改繁中。 |
| `app/page.tsx` | 首頁降密度、sidebar route link。 |
| `app/*/page.tsx` | 新增五個明細頁。 |
| verifier | 新增 route / 繁中 / data source / read-only 檢查。 |

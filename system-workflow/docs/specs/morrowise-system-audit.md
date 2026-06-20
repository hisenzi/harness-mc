# MorroWise 系統稽核

> 建立日期：2026-06-20
> 範圍：`$COLLAB/harness-mc/milestones/harness-mc` 裡的 `morrowise-system` track
> 狀態：Audit v0.1，於 `morrowise-system-index` 之前

## 判定

MorroWise 的骨架方向是對的，但目前還不是完整的活系統。

目前狀態：**部分通過**。

系統已經具備：

- 清楚的正式名稱與邊界：MorroWise 是現行名稱；Jarvis / `system-ops` 只保留為歷史參照。
- 明確的 source-of-truth 原則：現行 MC milestone 檔案是正本，舊 OpenClaw 檔案是證據。
- 分階段的任務鏈：從 source inventory、index、task map、growth gate、read model、dashboard surface、proactive loop 到 verification。
- 鄰近的 ACP 與 sentinel 機制：task event、single-writer apply、sync queue、dashboard visibility、session startup change detection。
- 已規劃的 ACP-SYNC 遷移線：`ACP-SYNC-01` 到 `ACP-SYNC-05` 負責 Heptabase PAI sync 解耦，透過 `acp-external-sync-queue` 間接連到 MorroWise，但尚未被命名為 MorroWise capability family。

主要缺口：MorroWise 周圍已有幾個重要機制，但還沒有被正式吸收進 MorroWise 的 growth rules。最清楚的例子是 task completion 與 commit discipline：`worktree-commit`、task event、dirty-tree visibility、visual-layer sync 都已存在，但 MorroWise growth gate 還沒有定義「完成的 task 什麼時候形成 commit boundary、什麼時候留下 open loop、什麼時候需要 approval」。

## 稽核標準

本次 audit 對照 project decision：MorroWise 必須具備以下能力：

1. trigger；
2. source -> process -> output data flow；
3. MC / control-plane visual surface；
4. task/event feedback loop；
5. 明確的 approval 與 safety boundary；
6. 穩定的 source-of-truth 行為。

## 成功標準對照

| 標準 | 狀態 | 證據 | 缺口 |
|---|---|---|---|
| 已列出 MorroWise 來源檔與 source-of-truth 等級。 | 通過 | `morrowise-source-inventory` 已完成，且 `morrowise-source-inventory.md` 已存在。 | Inventory 是靜態 markdown；未來 read model 必須避免 status drift。 |
| 已分離舊 `system-ops` / Jarvis 素材與現行狀態。 | 通過 | Inventory 分出 S0 current MC、S1 legacy canonical evidence、S2 mirror、S3 memory、S4 visual layers。 | 下一份 index 仍需把每個 historical capability 分類成 keep、migrate、supersede 或 archive。 |
| 現行 task chain 可見。 | 部分通過 | 13 個 `morrowise-system` tasks 已存在，且有 dependencies 與兩個 batch。 | task chain 跳過 order labels 5-12，因為 ACP/control-plane 鄰近任務佔用該區間；原因合理，但尚未在 MorroWise index 中說明。 |
| Growth gate 覆蓋真實 workflow triggers。 | 部分通過 | `morrowise-growth-gate-spec` 提到 Vincent phrases、weekly review、stale/blocked task、project-init growth gate。 | 尚未點名 task completion、commit boundary、dirty tree、rejected task event、sync queue pressure 作為 growth-gate triggers。 |
| Feedback loop 已有現行 infrastructure 支撐。 | 部分通過 | `acp-task-event-outbox`、`acp-apply-task-events`、`acp-external-sync-queue`、`acp-task-event-dashboard` 已完成。 | MorroWise 尚未宣告哪些是 feedback spine，哪些只是 implementation details。 |
| External sync migration 已映射進 MorroWise。 | 部分通過 | `ACP-SYNC-01` 到 `ACP-SYNC-05` 以 `heptabase-pai-sync-migration` batch 存在，並依賴 `acp-external-sync-queue` / `acp-skill-validator`。 | 這些 tasks 已在 ACP/control-plane 規劃，但尚未被 MorroWise index、task map、growth-gate language 點名。 |
| Visual layer 維持 mirror，而不是 source of truth。 | 通過 | Inventory 說明 Heptabase 與 Canvas 是 visual layers；project decisions 說明 MC milestones / read model 是 canonical。 | 未來 growth gate 需要 guard：Heptabase 或 Canvas 狀態不得在沒有 MC event / task update 的情況下關閉 task。 |
| Approval policy 排在 autonomous runner 之前。 | 通過 | `morrowise-approval-policy` 擋在 `morrowise-autonomous-action-runner-v0` 前面。 | Policy 必須明確覆蓋 commit、push、external sync、delete、secret、history rewrite、task state mutation。 |
| Proactive loop 有驗收端點。 | 通過 | `morrowise-proactive-loop-verify` 要求回答 trigger、recommendation、evidence、approval、runner output、feedback write-back、open loops。 | 目前還只是 task text；尚無 test fixture 或 sample event chain。 |

## 系統層檢視

### 1. 意圖層

狀態：**通過**

MorroWise 的 identity 已足夠清楚，可以繼續推進：

- 正式名稱：MorroWise。
- Tagline：讓人的意志長成現實的活系統。
- 歷史參照：Jarvis / `system-ops`。
- Project placement：放在 `harness-mc` 內，不另開獨立 milestone。

這個決策是正確的。MorroWise 不應該變成另一個孤立的願景專案；它應該是 MC 與 control-plane pipeline 的 growth layer。

風險：`living system` 這個概念很強，但範圍也很大。Index 必須把它轉成 anatomy categories，否則後續 tasks 容易滑回抽象文字。

### 2. Source-Of-Truth 層

狀態：**通過，但有一個注意點**

Source hierarchy 是合理的：

- S0：現行 MC milestone files。
- S1：舊 `system-ops` project files。
- S2：Obsidian mirror。
- S3：daily memory timeline。
- S4：Heptabase 與 Canvas visual layers。

注意點：Markdown inventory 會漂移。這次已經出現一個小例子：`morrowise-source-inventory.md` 的 task table 建立時把 `morrowise-source-inventory` 標成 `todo`，後來 `tasks.json` 已更新為 `completed`。Audit 已修正該靜態表格，但這個 pattern 本身重要。

後續要加的規則：MorroWise read models 應從 MC data 讀 task status，不應從人工維護的 markdown tables 讀取。

### 3. Task Chain 層

狀態：**部分通過**

13-task chain 的結構是好的：

- 第一批：control-console observability。
- 第二批：proactive loop。
- Verification tasks 分成 console verification 與 proactive-loop verification。

Dependency chain 大致正確：

```text
source inventory -> index -> task map -> growth gate -> anatomy read model -> dashboard surface -> console verify
console verify -> trigger registry -> recommendation -> approval policy -> runner -> dashboard -> proactive verify
```

缺口：task completion / commit discipline 尚未成為 MorroWise 的正式關注點。

它應該被明確加入 `morrowise-growth-gate-spec`，不能只留在 `worktree-commit` 裡。

### 4. Feedback 層

狀態：**部分通過**

現有鄰近機制很強：

- `acp-task-event-outbox`：跨 repo commit 產生 append-only events，而不是直接寫 MC。
- `acp-apply-task-events`：single-writer reducer 套用 events。
- `acp-task-state-split`：task definition / state separation 已存在。
- `acp-external-sync-queue`：external sync 會變成 queue events。
- `acp-task-event-dashboard`：queue / reducer state 可視化。
- `acp-obsidian-canvas-sync-hook`：task changes 會 sync 到 Canvas。

但 MorroWise 尚未定義要如何使用這些機制的 lifecycle。

必要規則：

```text
Task completed -> verify artifact -> decide commit boundary -> 4C commit plan -> commit or open loop -> task event/state update -> sync queue -> visual mirror -> dashboard feedback.
```

如果沒有這條規則，task completion 可能停在 dirty files、chat memory 或 visual-layer state 裡。

### 5. Trigger 層

狀態：**部分通過**

目前已規劃的 triggers 包含：

- Vincent 說 MorroWise / 活系統 / system-ops。
- weekly review。
- stale 或 blocked task。
- project-init growth gate missing。

缺少的 triggers：

- task 被標成 completed，但沒有 commit boundary。
- work 已 commit，但 task state 沒有更新。
- task event rejected。
- sync event failed 或 pending 太久。
- dirty tree 裡包含已完成 task artifacts。
- 靜態 docs 與 `tasks.json` 不一致。
- Heptabase / Canvas 已 refreshed，但 MC canonical state 沒有變更。
- approval request 等待太久。

這些不是 nice-to-have。它們正是讓 MorroWise 不只是 dashboard，而能進入「feedback to growth」的信號。

### 6. Recommendation 層

狀態：**已規劃，尚未實作**

`morrowise-recommendation-engine-v0` 要求輸出：

- reason；
- evidence refs；
- risk level；
- approval requirement；
- suggested task id。

這個 shape 是對的。

需要補充：當 task completion 形成 version-control boundary decision 時，recommendation candidates 應能提出 `commit now`、`do not commit yet`、`split commit`、`create open loop`。

### 7. Approval And Safety 層

狀態：**已規劃，但不夠具體**

`morrowise-approval-policy` 目前覆蓋：

- task reorder；
- task create / update / close；
- external sync；
- draft patch；
- delete；
- secret；
- history rewrite。

需要補充：

| Action | 建議 policy |
|---|---|
| 讀取現行 MC / docs / public data | Auto allowed |
| 產生 audit / index / read model | Auto allowed |
| MC task update 後 refresh visual layer | Auto allowed，前提是沒有 manual overwrite risk |
| Commit this session's clean task scope | 需要 Vincent confirmation |
| Push branch | 需要 Vincent confirmation，除非前面 scope 已包含 push |
| Close 或 reorder 大量 tasks | 需要 Vincent confirmation |
| 寫入外部 Notion / Telegram / Heptabase | 需要 policy-specific approval |
| Delete files、rewrite history、read secrets | Forbidden，除非 Vincent 明確要求且理由充分 |

### 8. Surface 層

狀態：**已規劃，且有可用鄰近機制**

Surface plan 是好的：

- `morrowise-dashboard-surface` 應顯示 triggers、next steps、feedback、tasks、open loops。
- `morrowise-proactive-loop-dashboard` 應顯示 trigger -> recommendation -> approval -> action -> feedback。

現有鄰近機制：

- sentinel card 可顯示 changes 與 stale signals。
- task event dashboard 可顯示 pending / applied / rejected。
- worktree status mockup 可顯示 unfinished local work。

缺口：這些 surfaces 尚未統一成一個 MorroWise state。使用者目前能看見片段，但還看不到完整 living-system loop。

### 9. External Sync / Integration Boundary 層

狀態：**部分通過**

`ACP-SYNC-01` 到 `ACP-SYNC-05` 是一條 coherent external sync migration line：

- `ACP-SYNC-01`：定義 Heptabase PAI sync decoupling 規格。
- `ACP-SYNC-02`：抽出 shared PAI / Notion helper library。
- `ACP-SYNC-03`：讓 `heptabase-cli-to-pai.py` 成為 main path。
- `ACP-SYNC-04`：將 MCP/OAuth `heptabase-to-pai.py` 標成或封存為 legacy fallback。
- `ACP-SYNC-05`：關閉 skill version 與 changelog loop。

這些 tasks 屬於 `control-plane`，batch 是 `heptabase-pai-sync-migration`，並且接在 `acp-external-sync-queue` 與 `acp-skill-validator` 之後。這是正確的 implementation location。

MorroWise 不應把 ACP-SYNC 當成第一批 living-system core。它應該把 ACP-SYNC 視為 external sync muscle 與 integration hygiene line：

- external sync muscle：安全地把狀態移到 PAI / Notion / Heptabase-facing surfaces。
- integration boundary：區分 dry-run、external write、fallback、retry、archive 行為。
- immune-system hygiene：避免 future agents 在 CLI path 成為 main line 後，繼續使用錯誤的 legacy script。

MorroWise 必須吸收的部分：

- `morrowise-system-index` 應把 ACP-SYNC 列為 external sync capability family。
- `morrowise-mc-task-map` 應把 `ACP-SYNC-01` 到 `ACP-SYNC-05` 映射到 integration boundary / Heptabase PAI migration。
- `morrowise-growth-gate-spec` 應定義 sync migration、dry-run mismatch、sync failure、fallback usage、legacy archive risk 何時成為 growth-gate trigger。
- `morrowise-approval-policy` 應分類 PAI / Notion writes、dry-run-only operations、retries、legacy script archive actions。

## 主要發現

### Finding 1：Commit discipline 應該屬於 MorroWise

嚴重性：high

現行 commit 機制很強，但它在 MorroWise 的正式規則之外。這造成一個 conceptual leak：task completion 是 MorroWise 的 growth moment，但 commit decision 目前只被視為 Git workflow concern。

建議補進 `morrowise-growth-gate-spec`：

```text
Add Task Completion Growth Gate:
When a task reaches done_condition, MorroWise must decide whether the work forms a commit boundary, remains an open loop, or needs split-commit. The decision uses worktree-commit 4C, dirty-tree scan, visual-layer sync state, and task event status.
```

### Finding 2：MorroWise 在 proactive automation 前需要明確的 open-loop model

嚴重性：high

Tasks 已提到 `open_loops`，但尚無具體 model。

最低欄位：

| Field | 用途 |
|---|---|
| `loop_id` | Stable id |
| `source` | trigger / task / event / audit / user |
| `condition` | 為什麼仍 open |
| `risk_level` | low / medium / high |
| `suggested_next_action` | 下一步應做什麼 |
| `requires_approval` | true / false |
| `owner` | Vincent / codex / external |
| `expires_at` 或 `review_after` | 避免被遺忘 |
| `evidence_refs` | file paths、task ids、event ids |

### Finding 3：MorroWise 應重用 ACP，不要重建 ACP

嚴重性：medium

Inventory 正確指向 ACP tasks。Audit 確認這是正確方向：

- task event outbox 是 feedback bridge。
- apply-task-events 是 reducer。
- sync queue 是 external side-effect boundary。
- task event dashboard 是 observability。
- worktree status 是 unfinished-work sensing。

MorroWise 應定義 living-system semantics 與 read model，不應複製底層 pipeline。

### Finding 4：帶 status 的 markdown tables 有 drift 風險

嚴重性：medium

Inventory 的 task table 在 task completion 後立刻漂移。這次只是小問題，但 pattern 很危險。

規則：

- Markdown 可以解釋 source hierarchy 與 decisions。
- Current task status 應來自 `tasks.json` 或 generated read model。
- Dashboard 與 future audit 應盡量優先使用 generated data。

### Finding 5：External delivery 仍被 blocked，應保留在第二階段

嚴重性：medium

Notion 與 Telegram sentinel exits 目前 blocked 或 pending。這是可以接受的。MorroWise 應先完成 trigger / recommendation / approval policy，再接 external delivery。

不要在 approval policy 存在前解鎖 proactive external notification。

### Finding 6：ACP-SYNC 已規劃，但尚未被 MorroWise 吸收

嚴重性：medium

`ACP-SYNC-01` 到 `ACP-SYNC-05` 並不是缺失項。它們已形成一條清楚的 control-plane migration line，處理 Heptabase PAI sync。問題在於 representation：它們目前是 ACP implementation tasks，不是 MorroWise 裡被命名的 capability family。

這很重要，因為 external sync 是 living system 最容易不小心改到外部世界的位置之一。MorroWise 需要語言描述：

- dry-run vs external write；
- CLI main path vs legacy fallback；
- sync failure vs retry；
- archive vs delete；
- skill / changelog closure as an integration hygiene loop。

建議補充：

```text
Treat ACP-SYNC as MorroWise external sync muscle.
It remains implemented in control-plane tasks, but MorroWise index, task map, growth gate, and approval policy must name how it participates in feedback and external side-effect boundaries.
```

## 必要 task 調整

建議調整既有 tasks：

| Task | 調整 |
|---|---|
| `morrowise-system-index` | 將本 audit 作為 input，並加入「MorroWise 周圍已有但尚未吸收的機制」區段。 |
| `morrowise-system-index` | 納入 ACP-SYNC 作為 external sync capability family：Heptabase PAI migration、CLI main path、legacy fallback、skill version closure。 |
| `morrowise-mc-task-map` | 將 commit discipline、worktree status、task event reducer、sync queue、sentinel triggers、`ACP-SYNC-01` 到 `ACP-SYNC-05` 映射進 MorroWise capabilities。 |
| `morrowise-growth-gate-spec` | 新增 Task Completion Growth Gate、Commit Boundary Gate、External Sync Growth Gate。 |
| `morrowise-anatomy-read-model` | 在 schema candidates 加入 `commit_boundaries`、`dirty_work`、`open_loops`、`feedback_events`。 |
| `morrowise-trigger-rules-registry` | 加入 uncommitted completed work、task-event rejection、sync failure、dry-run mismatch、legacy fallback usage、docs/status drift 等 triggers。 |
| `morrowise-recommendation-engine-v0` | 允許 recommendations：commit now、split commit、wait、create task event、refresh visual layer、dry-run external sync、archive legacy path、request approval。 |
| `morrowise-approval-policy` | 明確分類 commit、push、task mutation、PAI / Notion writes、dry-run-only operations、external sync retries、legacy script archive、delete、secret、history rewrite。 |
| `morrowise-control-console-verify` | 驗證 MC 能回答：「哪些 completed work 尚未 commit，或尚未反映在 task state？」 |
| `morrowise-proactive-loop-verify` | 驗證完整鏈：trigger -> recommendation -> approval -> action -> feedback write-back。 |

## 建議最小 Growth Gate

以下規則應折進 `morrowise-growth-gate-spec`：

```text
Task Completion Growth Gate

Input:
- task id
- done_condition
- changed files
- verification result
- Heptabase / Canvas sync state
- task event state

Decision:
- commit now
- split commit
- keep open loop
- request approval
- block because verification is missing

Checks:
- 4C: Context, Change, Cause, Check
- dirty tree scope
- source-of-truth update
- visual-layer mirror status
- external side-effect risk

Output:
- commit plan or open-loop record
- task event or MC state update
- sync_requested event when applicable
- dashboard-visible feedback
```

```text
External Sync Growth Gate

Input:
- sync task id
- target system
- dry-run result
- external write risk
- legacy fallback state
- approval policy

Decision:
- dry-run only
- migrate implementation
- retry sync
- archive legacy path
- request approval
- block due to external write risk

Checks:
- target system and scope are explicit
- no token or secret is read into output
- dry-run parity is verified before write
- legacy fallback is preserved or archived with rollback path
- PAI / Notion writes follow approval policy

Output:
- sync migration plan or open-loop record
- sync_requested / sync_failed / sync_blocked event
- legacy path status
- skill or changelog closure task
```

## 下一步

不要直接跳到 UI 或 automation。

建議下一個 task：`morrowise-system-index`。

Index 應吸收本 audit，產出穩定的 MorroWise anatomy：

1. intention and naming；
2. source hierarchy；
3. historical capability families；
4. current ACP / sentinel / worktree mechanisms；
5. ACP-SYNC external sync capability family；
6. missing growth gates；
7. next executable tasks。

之後 `morrowise-mc-task-map` 才能判斷：需要新增/修改 tasks，還是既有 13 個 tasks 只要補 done conditions 就足夠。

## 稽核結論

MorroWise 已經足夠 coherent，可以繼續推進。

但現在還不能誠實稱為活系統。它目前是一個結構良好的 control-console plan，周圍有幾個強而有力的鄰近機制。

下一個轉化，是把這些鄰近機制吸收成明確的 MorroWise growth rules，尤其是：

- task completion to commit boundary；
- open-loop tracking；
- feedback event visibility；
- approval policy before automation；
- generated read model over static markdown status；
- ACP-SYNC external sync capability family。

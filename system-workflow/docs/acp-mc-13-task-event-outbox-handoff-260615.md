# ACP-MC-13 Task Event Outbox Handoff（2026-06-15）

> Project: `$COLLAB/harness-mc`  
> Task: `ACP-MC-13` / `acp-task-event-outbox`  
> Scope: cross-repo task status recording for `worktree-commit`  
> Status: `in_progress`

## 背景

目前多個 agent session 會同時使用 `worktree-commit`。舊流程在跨 repo commit 後會直接寫入 `$COLLAB/harness-mc/milestones/*/tasks.json`，造成多個 session 同時修改 `harness-mc` canonical state，容易產生 dirty worktree、commit 混雜、push 衝突。

ACP-MC-13 的目標是先把跨 repo task 狀態回填改成 append-only event outbox：

- commit repo 是 `harness-mc`：仍可直接更新 `tasks.json` 並 rebuild。
- commit repo 不是 `harness-mc`：只寫入 task event，不直接修改 `harness-mc/tasks.json`。
- canonical state 由後續 sync actor / apply pipeline 處理，這是 ACP-MC-14。

## 本次已完成

新增 task event writer：

- `$COLLAB/harness-mc/scripts/task-event-outbox.mjs`
- `$COLLAB/harness-mc/scripts/verify-task-event-outbox.mjs`
- `$COLLAB/harness-mc/task-events/pending/.gitkeep`

更新 npm script：

- `$COLLAB/harness-mc/package.json`
- 新增 `test:task-event-outbox`

更新 `worktree-commit` skill：

- `$COLLAB/notyet-harness/000_Agent/skills/worktree-commit/SKILL.md`
- 版本更新為 `v1.6`
- 新增跨 repo task event 模式
- 明確禁止 commit repo 非 `harness-mc` 時直接修改 `harness-mc/tasks.json`
- 明確規定跨 repo commit 後不做 MC rebuild、Canvas sync、Heptabase append，只產生 outbox event

更新 task 追蹤：

- `$COLLAB/harness-mc/milestones/harness-mc/tasks.json`
- `ACP-MC-13` 已標為 `in_progress`
- note 已記錄：writer、verification script、`worktree-commit` v1.6 已完成，待 commit / 驗收後再標 completed。

## Writer 行為

`writeTaskEvent(input)` 目前接受：

```js
{
  type: "task.completed",
  repo: "finance-dashboard",
  commit: "1f0bd74",
  project: "notion-finance",
  task_id: "mc-12",
  summary: "完成月底轉帳 checkbox",
  actor: "codex",
  session_id: "session-id",
  created_at: "2026-06-15T01:00:00.000Z",
  root: "/tmp/example-root"
}
```

必要欄位：

- `type`
- `repo`
- `commit`
- `project`
- `task_id`
- `summary`
- `actor`
- `session_id`

目前支援事件類型：

- `task.completed`
- `task.commit_attached`
- `task.reopened`
- `task.blocked`

輸出位置：

```text
$COLLAB/harness-mc/task-events/pending/<timestamp>-<repo>-<commit>-<project>-<task_id>.json
```

範例檔名：

```text
20260615T010000Z-finance-dashboard-1f0bd74-notion-finance-mc-12.json
```

事件內含：

- `event_id`
- `type`
- `status: "pending"`
- `repo`
- `commit`
- `project`
- `task_id`
- `summary`
- `created_at`
- `actor`
- `session_id`

## 驗證紀錄

已通過：

```bash
cd $COLLAB/harness-mc
npm run test:task-event-outbox
node scripts/generate-data.mjs
```

`npm run test:task-event-outbox` 驗證：

- event 欄位完整
- event 寫入 `task-events/pending/`
- filename 符合預期格式
- `event_id` 符合可追蹤格式
- 缺少必要欄位會 throw

`node scripts/generate-data.mjs` 驗證 MC rebuild 仍可跑：

- 產出 26 projects
- 產出 552 tasks

## 尚未完成

ACP-MC-13 尚未標 completed，原因：

- 尚未 commit。
- 尚未用一次真實 `worktree-commit` 跨 repo 流程驗證 event 產生。
- `worktree-commit` 目前是文件流程更新，尚未提供 CLI wrapper；若 agent 執行時不想用 inline Node import，建議補一支小型 CLI。
- `task-events/pending` 尚無 apply pipeline，這屬於 ACP-MC-14。
- 尚未處理 event reject / duplicate / already-exists 的使用者提示，這可以在 ACP-MC-14 或 ACP-MC-17 補。

## Dirty Worktree 注意

目前 `harness-mc` 和 `notyet-harness` 都有大量既有 dirty changes，不全是本 session 造成。

本 session 相關檔案：

```text
$COLLAB/harness-mc/scripts/task-event-outbox.mjs
$COLLAB/harness-mc/scripts/verify-task-event-outbox.mjs
$COLLAB/harness-mc/task-events/pending/.gitkeep
$COLLAB/harness-mc/package.json
$COLLAB/harness-mc/milestones/harness-mc/tasks.json
$COLLAB/harness-mc/system-workflow/docs/acp-mc-13-task-event-outbox-handoff-260615.md
$COLLAB/notyet-harness/000_Agent/skills/worktree-commit/SKILL.md
```

請不要用 broad `git add .`。

如果要 commit，只 stage 本 session 的檔案或 hunk。特別注意：

- `package.json` 原本已有其他 session 的變更，只能 stage `test:task-event-outbox` 相關 hunk。
- `milestones/harness-mc/tasks.json` 原本已有其他 session 的大量變更，只能 stage `ACP-MC-13` 狀態 / note 相關 hunk；若 ACP-MC-13～17 尚未 committed，也要先確認那些 task 是否屬於同一批要收的變更。
- `notyet-harness/000_Agent/skills/worktree-commit/SKILL.md` 是另一個 repo，需要分開 commit 或明確跨 repo commit 策略。

## 建議下一步

1. Review `scripts/task-event-outbox.mjs` API，決定是否補 CLI wrapper。
2. 跑一次真實跨 repo `worktree-commit` dry-run / manual simulation，確認 event 寫入可操作。
3. 再跑：

```bash
cd $COLLAB/harness-mc
npm run test:task-event-outbox
node scripts/generate-data.mjs
```

4. 安全分批 commit：

- `harness-mc`: event writer、test、task-events `.gitkeep`、task tracking、handoff doc、package script hunk。
- `notyet-harness`: `worktree-commit` skill v1.6 更新。

5. commit 後把 `ACP-MC-13` 標為 completed。
6. 開始 `ACP-MC-14`：apply task events，將 pending events 套用到 canonical `tasks.json`，並移動到 applied / rejected。

## 後續設計邊界

ACP-MC-13 只負責「產生事件」，不負責套用事件。

事件套用責任分工建議：

- ACP-MC-14: apply pipeline，讀 pending event，驗證 task 存在，更新 canonical state。
- ACP-MC-15: 拆出 task state / read model，降低 `tasks.json` 衝突面。
- ACP-MC-16: external sync queue，讓 Heptabase / Canvas / Notion 不直接綁在 commit 流程。
- ACP-MC-17: event dashboard，顯示 pending / applied / rejected。


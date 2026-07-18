# Task Write Command Map

> MC-LIVE-06 / `acp-task-write-command-map`
>
> Purpose: route Vincent's task-related phrases to the correct agent skill,
> script, validator, and stop condition before changing MC source-of-truth data.

## Source Of Truth

MC task state is owned by:

- `milestones/<project>/tasks.json`
- `milestones/<project>/project.json`
- append-only task events under `task-events/pending/` for cross-repo updates

Heptabase cards, Obsidian Canvas, dashboard JSON, screenshots, and browser UI are
visual or read-model mirrors. They may confirm display behavior, but they must
not reverse-write task state.

## Command Routing

| Vincent phrase | Route | Primary skill | Primary script / command | Validator | Stop condition |
|---|---|---|---|---|---|
| `寫 task` / `新增 task` / `加一張 task` | `JV-32/task-lifecycle:create`：先建立 MC canonical task，再開始實作。 | `planning` 或 `project-init` | 追加 `jv32_route` 與 `task_lifecycle.history` 的 `create` event；MorroWise event 必填 `architecture_relation_impact`（none/add/update/retire）；再執行 `node scripts/generate-data.mjs`。 | `npm run test:tasks` | task 有 id、title、status、track、done_condition、create evidence、`from_status: null` 與可判定的關係影響。 |
| `更新 task` / `補 task 說明` | `JV-32/task-lifecycle:amend`：更新既有 task 文字、依賴、note、summary 或 tracking metadata。 | `planning`、`execution` 或 `worktree-commit` | 追加 `amend` event，不覆寫舊 history；MorroWise event 必填 `architecture_relation_impact`。若為 add/update/retire，先更新 Architecture Admission Registry 關係正本再重建 MC data；若異動既有 promoted 子系統的正本、schema、verifier、policy 或 routing，還要記錄 `architecture_decision.admission_review`、更新 Admission Record version review，並跑 architecture sync check。 | `npm run test:tasks`；架構變更另跑對應 subsystem verifier 與 `sync-architecture-subsystems.py --check` | lifecycle history 與 current status 一致，更新可在 `public/data/projects.json` 看見，且未改動無關 task；version improvement 必有 `updated` 或 `no_index_change` 決定。 |
| `暫緩 task` / `停用 task` / `取消 task` / `封存 task` | `JV-32/task-lifecycle:suspend|cancel|archive`：先判斷可恢復、取消或歷史封存。 | `planning` 或 `execution` | `deferred` 必填 reactivation_criteria；`cancelled` 必填 replacement_task_id 或 no_replacement_reason；`archived` 必填封存原因，若有取代者填 superseded_by；MorroWise event 仍必填 `architecture_relation_impact`，退役關係時用 retire。 | `npm run test:tasks` | 不使用 disabled；blocked 不算停用；history、理由、關係影響與 status mapping 均通過 validator。 |
| `恢復 task` | `JV-32/task-lifecycle:resume`：只從 deferred 回到可執行狀態。 | `planning` 或 `execution` | 追加 resume event 與恢復證據，再重建 MC data。 | `npm run test:tasks` | 上一個停用條件已滿足，current status 不再是 deferred。 |
| `task 寫到 Heptabase` / `同步 task 到 Heptabase` | Mirror selected MC tasks to Heptabase as a visual/discussion layer. | `heptabase-task-cards` | `node $COLLAB/notyet-harness/000_Agent/skills/heptabase-task-cards/scripts/create-task-cards.mjs --tasks <tasks.json> --ids <task-id> --sync` | Re-run `npm run test:tasks`; inspect `external_refs.heptabase` if the adapter writes refs. | MC remains source of truth; Heptabase append/write-back only records `external_refs.heptabase` and discussion context. |
| `完成 task` / `mark task done` / `這個 task 完成` | `JV-32/task-lifecycle:complete` 加 `closeout-commit-routing`：只在 artifact evidence 與驗證存在後關閉。 | `worktree-commit` | 追加 complete event，更新 status、completed_at、commits、summary，再執行 `node scripts/generate-data.mjs`；若是 promoted subsystem version improvement，先完成 Admission Record review 與 architecture sync check。 | Task-specific verifier plus `npm run test:tasks` | complete event、closeout route、summary 與 durable artifact／verification 一致；架構 version improvement 的 Admission Record 不得為 stale。 |

## Commit-Time Routing

Use `worktree-commit` whenever task state is committed.

For commits made inside `harness-mc`:

1. Read the staged diff.
2. Commit the artifact or bookkeeping scope with a conventional commit message.
3. If closing a task, update the matching task in `milestones/<project>/tasks.json`.
4. Rebuild MC data with `node scripts/generate-data.mjs`.
5. Run the relevant verifier and `npm run test:tasks`.
6. Commit the task bookkeeping separately when the artifact commit hash is needed
   in `commits`.

For commits made outside `harness-mc`:

1. Commit in the feature repo.
2. Write a task event to `task-events/pending/` with `scripts/task-event-outbox.mjs`.
3. Do not directly edit `harness-mc/milestones/*/tasks.json`.
4. Let the single-writer MC sync actor apply canonical task state later.

## Stop Conditions

Stop before writing task state when any of these are true:

- The task id or project is ambiguous.
- The requested change would close a task without an artifact or verifier.
- The change would update Heptabase, Canvas, or dashboard data without updating MC
  source-of-truth first.
- The diff mixes unrelated tasks or unrelated repos.
- A visual layer suggests a different state than `tasks.json`; inspect the
  generator/read model instead of copying the visual state back.

## Verification Checklist

Before claiming a task write is complete:

- `milestones/<project>/tasks.json` contains the intended state.
- `public/data/projects.json` reflects that state after `node scripts/generate-data.mjs`.
- `npm run test:tasks` passes, allowing only known legacy warnings.
- Any task-specific verifier named in the task summary or done condition passes.
- Heptabase / Obsidian Canvas sync status is reported when the task has visual
  layer refs or belongs to the MC dashboard/control-plane surface.

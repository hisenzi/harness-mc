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
| `寫 task` / `新增 task` / `加一張 task` | Create or update the MC canonical task before implementation starts. | `planning` or `project-init` | Edit `milestones/<project>/tasks.json`; then `node scripts/generate-data.mjs` | `npm run test:tasks` | A task has `id`, `title`, `status`, `track`, `done_condition`, and dependency/order metadata when relevant. |
| `更新 task` / `補 task 說明` | Update existing task text, dependency, note, summary, or tracking metadata. | `planning`, `execution`, or `worktree-commit` | Edit the canonical task file; then rebuild MC data. | `npm run test:tasks` | The update is visible in `public/data/projects.json` and does not change unrelated task state. |
| `task 寫到 Heptabase` / `同步 task 到 Heptabase` | Mirror selected MC tasks to Heptabase as a visual/discussion layer. | `heptabase-task-cards` | `node $COLLAB/notyet-harness/000_Agent/skills/heptabase-task-cards/scripts/create-task-cards.mjs --tasks <tasks.json> --ids <task-id> --sync` | Re-run `npm run test:tasks`; inspect `external_refs.heptabase` if the adapter writes refs. | MC remains source of truth; Heptabase append/write-back only records `external_refs.heptabase` and discussion context. |
| `完成 task` / `mark task done` / `這個 task 完成` | Close a task only after artifact evidence and verification exist. | `worktree-commit` | Update `status`, `completed_at`, `commits`, and `summary`; then `node scripts/generate-data.mjs` | Task-specific verifier plus `npm run test:tasks` | The task summary names the durable artifact and verification; generated project data shows the same completed state. |

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

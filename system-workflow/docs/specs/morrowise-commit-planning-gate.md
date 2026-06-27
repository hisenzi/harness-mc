# MorroWise Commit Planning Gate

> Source of truth: `$COLLAB/harness-mc/system-workflow/registries/morrowise-commit-planning-gate.json`
> Owner task: `morrowise/runtime-scheduler-v0`

## Purpose

`commit-attention` tells the system that local work needs attention.

The next step is not commit. The next step is planning.

```text
commit-attention -> commit planning gate -> worktree-commit confirmation gate
```

This gate turns generated repo/task signals into a commit cleanup plan. It never stages files, commits, pushes, closes tasks, or mutates task state.

The repeatable read model is generated at:

`$COLLAB/harness-mc/public/data/commit-cleanup-plan.json`

## Decision Order

1. Read `commit-attention.json` and `worktrees.json`.
2. Classify each repo.
3. Stop blocked repos with a reason and next action.
4. For allowed repos, run work-anchor preflight.
5. Inspect scoped dirty status and diff.
6. Propose logical commit groups.
7. List excluded files explicitly.
8. Wait for Vincent confirmation.
9. Hand off to `worktree-commit`.

The generator for the repeatable plan is:

```bash
node scripts/generate-commit-cleanup-plan.mjs
```

## Classification

| Input State | Planning State | Next Action |
|---|---|---|
| `needs_reconcile` | `blocked` | Resolve branch divergence or detached HEAD first. |
| `missing_or_unclear_task_anchor` | `blocked` | Create or select MC task anchor first. |
| `diff_scope_too_mixed` | `blocked` | Split or narrow the dirty scope to one MC task anchor first. |
| `task_anchor_available` | `plan_allowed` | Run preflight, inspect scope, propose commit groups. |
| `local_commits` | `push_decision_required` | Verify task/event linkage and ask whether to push. |

## Required Plan Fields

A cleanup plan must include:

- `repo`
- `repo_status`
- `candidate_task_anchor`
- `preflight_result`
- `commit_groups`
- `excluded_files`
- `verification_commands`
- `risks`
- `approval_required`

## Boundary

Allowed:

- read generated status
- read task metadata
- run `git status`
- run `git diff --stat`
- read detailed diffs only after preflight allows the task
- produce a commit cleanup plan

Forbidden:

- `git add`
- `git commit`
- `git push`
- close task
- mutate `tasks.json`
- send external notification

Actual history mutation remains in `worktree-commit`.

## Verification

```bash
npm run test:commit-planning-gate
npm run test:commit-cleanup-plan
```

# Repo Coordination Gate

> Task: `multi-machine-repo-coordination-gate` (`JV-37`)
> Contract: `MW-GIT-AUTH-01`
> Status: contract only; runtime not yet accepted
> Updated: 2026-07-27
> Read when: any Agent is about to modify a Git repo for the first time in a session, or is closing work that must reach remote truth

## Purpose

Make repo collaboration safe across Vincent's machines without asking him to
remember Git commands or clean up Agent-created isolation.

The user-facing result has only two states:

- `READY`: the repos required for this action are safe to modify.
- `BLOCKED`: the Agent stops and reports one reason plus one next action.

## Document Roles

- `$COLLAB/notyet-harness/000_Agent/CORE.md` is the mandatory startup pointer.
- `$COLLAB/AGENTS.md` and `$COLLAB/CLAUDE.md` route supported Agent runtimes to CORE.
- This document is the human-readable coordination contract.
- `$COLLAB/harness-mc/milestones/morrowise/tasks.json#multi-machine-repo-coordination-gate` owns task state and acceptance.
- The future JV-37 script may enforce this contract only after negative fixtures prove it.

Do not copy the complete state table into entry files or another registry.

Cross-repo publication order is fixed: publish this `harness-mc` contract first,
verify remote truth, then publish the `notyet-harness` CORE/Skill references.

## Explicit Vincent Authorization

Creating or switching a Git branch or linked worktree requires explicit Vincent approval.

`MW-GIT-AUTH-01` applies to `git branch`, `git switch`, `git checkout`,
`git worktree add`, and any script or Agent action with the same effect.

Without exact approval:

- read-only inspection of existing branches/worktrees is allowed;
- continue only in the currently checked-out working directory and branch when Repo Ready passes;
- if the current branch, role, or dirty state cannot safely serve the task, return `BLOCKED`;
- do not create or switch isolation as a workaround for dirty files, concurrent work, a routine feature, verification, or an implementation plan.

Approval evidence must name the repo/task, branch/worktree name and path, target
`main`, and cleanup plan. A valid authorization owns one complete lifecycle:

```text
create -> execute -> integrate target main -> verify -> remove the temporary branch/worktree
```

No second approval is required for lifecycle steps already listed in the
approved plan. A conflict, non-fast-forward result, changed remote SHA, changed
scope, or unmerged work invalidates the automatic continuation and returns
`BLOCKED`.

## Scope

At session start, maintained repos may be scanned read-only for fleet visibility.

Before file mutation, the hard gate covers only:

1. the target repo;
2. `$COLLAB/harness-mc`;
3. `$COLLAB/notyet-harness`.

Unrelated dirty or offline repos do not block the current task. Historical
clones, teaching material, non-Git folders, and lifecycle
`excluded|retired` remain outside automatic synchronization.

## Repo Ready

Before the first file mutation:

1. Inspect uncommitted files and unpushed commits from previous work.
2. Run `git fetch --prune` for each hard-gated repo.
3. Read current branch, upstream, HEAD/upstream SHA, ahead/behind, staged,
   unstaged, untracked, detached, and worktree state.
4. Verify `MW-GIT-AUTH-01` if the task is not staying on the current branch/worktree.
5. Apply the decision table.
6. Modify files only after every hard-gated repo is `READY`.

| State | Result | Allowed action |
| --- | --- | --- |
| clean, current authorized branch, ahead `0`, behind `0` | `READY` | Continue without switching refs. |
| clean, behind-only on current authorized branch | recoverable | Run fast-forward-only update, verify `0/0`, then continue. |
| ahead-only with durable exact-scope approval and unchanged remote SHA | recoverable | Retry a normal exact-ref push; never force. |
| generated-only dirty proven by deterministic verifier | warning | Continue only when classifier evidence exists. |
| classified unrelated manual dirty with approved exclusions | warning | Preserve it and use an exact path scope on the current branch. |
| target scope overlaps manual, mixed, or unknown dirty | `BLOCKED` | Preserve files and report the owner. |
| branch/worktree creation or switching lacks exact Vincent approval | `BLOCKED` | Stay read-only and request one bounded authorization. |
| unauthorized ahead, diverged, detached, unknown upstream/base, auth/fetch failure | `BLOCKED` | Stop and report one reversible next action. |

## Remote Closeout

Work is not complete at `committed_local`, on a temporary branch, or with a
pending governance event.

1. Run fresh verification.
2. Use `worktree-commit` with an exact path scope, destination `main`, and Vincent approval.
3. Fetch immediately before push or integration.
4. Push only the exact authorized ref with a normal fast-forward push.
5. If isolation was approved, integrate the authorized result into target `main`.
6. Verify remote `main` contains the approved commit and local/remote parity is `0/0`.
7. Apply required task events with
   `node scripts/apply-task-events.mjs --event-id <event_id>` and verify no
   event generated by this closeout remains pending.
8. Update canonical task state.
9. Remove the authorized temporary branch/worktree after proving it is integrated and clean.

If any required step cannot finish, report `BLOCKED`; do not describe branch-only,
local-only, event-pending, or deploy-pending work as complete.

## Repo Classes

- `shared_core_multi_writer`: repo class controls who may integrate `main`; it does not authorize an Agent to create/switch a branch or worktree.
- `owner_single_writer`: the task owner may update the currently checked-out `main` after the normal SHA/ahead-behind handshake and exact commit approval.

JV-37 A03 remains the only repo scope/classification contract.

## Prohibited Automation

- No autonomous branch/worktree creation or switching.
- No automatic commit of unknown or user-modified files.
- No automatic stash, reset, rebase, conflict resolution, or force push.
- No worktree/branch workaround for dirty ownership or concurrency.
- No heartbeat commit or branch as a second state system.
- No global blocking caused by an unrelated repo.
- No completion while work is only local, only on a branch, deploy-pending, or event-pending.

## Current Enforcement

The verifier proves contract wiring and forbidden fallbacks only. JV-37 runtime
is otherwise still `todo`; Agents must follow this contract explicitly and must
not claim the full coordination workflow is automated.

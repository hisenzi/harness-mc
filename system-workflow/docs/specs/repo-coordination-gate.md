# Repo Coordination Gate

> Task: `multi-machine-repo-coordination-gate` (`JV-37`)
> Contract: `MW-GIT-AUTH-01`
> Status: contract only; runtime not yet accepted
> Updated: 2026-07-28
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

## Default Direct-Main Workflow

For single-developer sequential work, the workflow does not create an
intermediate branch: single-developer sequential work stays on the checked-out `main`
after fetch, upstream, HEAD SHA, ahead/behind, dirty ownership, and exact commit
scope all pass Repo Ready.

There is no duration-based branch category. In particular, a branch does not
become acceptable because it is described as temporary, brief, clean, routine,
or easy to delete.

Known unrelated dirty files stay in place and are excluded with exact path
scope. Overlapping manual, mixed, or unknown dirty files return `BLOCKED`; they
do not trigger Git isolation.

## Explicit Vincent Authorization

Creating or switching a Git branch or linked worktree requires explicit Vincent approval.

`MW-GIT-AUTH-01` applies to `git branch`, `git switch`, `git checkout`,
`git worktree add`, and any script or Agent action with the same effect.

Without exact approval:

- read-only inspection of existing branches/worktrees is allowed;
- new single-developer sequential work continues only on the currently checked-out `main` when Repo Ready passes;
- an existing non-main branch may be inspected or closed out, but it is not the default location for new work;
- if the current ref, role, or dirty state cannot safely serve the task, return `BLOCKED`;
- do not create or switch isolation as a workaround for dirty files, concurrent work, a routine feature, verification, or an implementation plan.

An isolation proposal is valid only when Vincent explicitly chooses it for a
named external PR/review requirement, a genuinely concurrent separately owned
scope, or emergency hotfix isolation. These contexts explain a proposal; they
never authorize it by themselves.

Approval evidence must name the repo/task, branch/worktree name and path, target
`main`, and cleanup plan. A valid authorization owns one complete lifecycle:

```text
create -> execute -> integrate target main -> verify -> remove the approved isolation branch/worktree
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
4. Verify the direct-main default; if the task proposes any branch/worktree creation or switching, verify `MW-GIT-AUTH-01`.
5. Apply the decision table.
6. Modify files only after every hard-gated repo is `READY`.

| State | Result | Allowed action |
| --- | --- | --- |
| clean, checked-out `main`, ahead `0`, behind `0` | `READY` | Continue without switching refs. |
| clean, behind-only on checked-out `main` | recoverable | Run fast-forward-only update, verify `0/0`, then continue. |
| ahead-only with durable exact-scope approval and unchanged remote SHA | recoverable | Retry a normal exact-ref push; never force. |
| generated-only dirty proven by deterministic verifier | warning | Continue only when classifier evidence exists. |
| classified unrelated manual dirty with approved exclusions | warning | Preserve it and use an exact path scope on the current branch. |
| target scope overlaps manual, mixed, or unknown dirty | `BLOCKED` | Preserve files and report the owner. |
| branch/worktree creation or switching lacks exact Vincent approval | `BLOCKED` | Stay read-only and request one bounded authorization. |
| unauthorized ahead, diverged, detached, unknown upstream/base, auth/fetch failure | `BLOCKED` | Stop and report one reversible next action. |

## Remote Closeout

Work is not complete at `committed_local`, on an approved isolation branch, or with a
pending governance event.

The finite task-completion path is:

```text
committed_local -> commit_reviewed -> integrated_main -> delivery_verified -> canonical_applied -> closeout_remote_synced -> residual_zero -> task_completed
```

1. Run fresh verification and use `worktree-commit` with an exact path scope,
   destination `main`, and Vincent approval.
2. Create C1 implementation, then verify its committed diff, message, paths,
   tests and review evidence against the approved plan.
3. Fetch immediately before normal push or integration. Verify destination
   `origin/main` contains C1 or its explicitly mapped equivalent delivery hash.
4. Satisfy the canonical task Test contract at the applicable
   Unit/integration/runtime/E2E levels. Required CI must reach terminal success;
   claimed deployment/runtime behavior requires a smoke probe or real runtime
   evidence. An inapplicable level requires an exemption reason and rerunnable
   alternative verifier.
5. Only after delivery verification, apply the exact required task event with
   `node scripts/apply-task-events.mjs --event-id <event_id>`, process every
   sync request created by this closeout to `synced` or terminal `skipped` with
   an exemption reason and rerunnable verifier, update canonical task state,
   and run required mutating generators/sync.
6. Put canonical task state, completion evidence, applied event/sync state and
   required generated output into C2 closeout commit.
7. All mutating closeout work must happen before the C2 closeout commit.
   C2 must not recursively backfill its own commit hash; Git history and remote
   ancestry are its provenance.
8. Push C2 under the existing exact authorization without asking again, then
   fetch and verify relevant `origin/main` refs contain C1/delivery hash and C2,
   with local/remote parity `0/0`.
9. After C2 remote synchronization, terminal verification is read-only:
   preserve baseline unrelated dirty/exclusions, require current
   scope-owned residuals and closeout-created pending task/sync events to be
   zero, and verify canonical task evidence matches remote truth.
10. Remove an authorized isolation branch/worktree only after proving it is
    integrated and clean.

If any required step cannot finish, report `BLOCKED`; do not describe branch-only,
local-only, event-pending, or deploy-pending work as complete.

## Repo Classes

- `shared_core_multi_writer`: a designated integrator owns exact-scope updates to `main`; the repo class does not make branches/worktrees the default or authorize their creation/switching.
- `owner_single_writer`: the task owner updates the checked-out `main` after the normal SHA/ahead-behind handshake and exact commit approval.

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

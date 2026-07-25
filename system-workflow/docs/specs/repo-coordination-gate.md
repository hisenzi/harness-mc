# Repo Coordination Gate

> Task: `multi-machine-repo-coordination-gate` (`JV-37`)
> Status: contract only; runtime not yet accepted
> Updated: 2026-07-25
> Read when: any Agent is about to modify a Git repo for the first time in a session, or is closing work that must reach remote truth

## Purpose

Make repo collaboration safe across MBA-1, MBA-2, and MBA-3 without asking Vincent to remember Git commands.

The user-facing result has only two states:

- `READY`: the repos required for this action are safe to modify.
- `BLOCKED`: the Agent stops and reports one reason plus one next action.

## Document Roles

- `$COLLAB/notyet-harness/000_Agent/CORE.md` is the mandatory startup pointer.
- `$COLLAB/AGENTS.md` and `$COLLAB/CLAUDE.md` must route each supported Agent runtime to CORE without copying the rules.
- This document is the human-readable coordination contract.
- `$COLLAB/harness-mc/milestones/morrowise/tasks.json#multi-machine-repo-coordination-gate` owns task state, acceptance, and rollout slices.
- The future JV-37 skill/script will be the executable gate after fixtures prove it.

Do not duplicate the state table or safety rules in `AGENTS.md`, `CLAUDE.md`, skills, or another registry. Those surfaces should point to CORE or this contract.

Cross-repo publication order is fixed: publish this `harness-mc` spec first, verify it exists on remote truth, then publish the `notyet-harness` `CORE.md` pointer. Never expose a pointer whose target is not yet reachable.

## Scope

At session start, scan all repos whose JV-37 lifecycle is `maintained` for fleet visibility. This scan is informational and may run in parallel.

Before a file mutation, the hard gate covers only:

1. the target repo;
2. `$COLLAB/harness-mc`;
3. `$COLLAB/notyet-harness`.

Unrelated dirty or offline repos do not block the current task. `*tmp`, `00*` non-Git folders, teaching material, historical clones, and lifecycle `excluded|retired` are outside automatic synchronization.

## Solo Development Default

For a single developer with one active coding stream, Git branch isolation is the default; a second filesystem checkout is not. Use one normal working directory, one short-lived branch, one task, and an exact commit scope. A clean, verified micro-change on an `owner_single_writer` repo may go straight to `main` only after the normal branch/HEAD/upstream/ahead-behind handshake.

Before proposing a linked worktree, run:

```bash
node "$COLLAB/harness-mc/scripts/worktree-exception-preflight.mjs" \
  --reason <reason> --intent implementation|verification \
  --evidence-ref "<durable decision or incident reference>"
```

| Reason | Result | Required next action |
| --- | --- | --- |
| `sequential_single_task` | continue; worktree denied | 使用同一工作目錄的一般 branch。這是成功路徑，不可當成 task BLOCKED。 |
| `known_unrelated_dirty` | continue; worktree denied | 保留已分類 exclusions，使用精準 scope 的一般 branch；不得以 worktree 建立隔離工作區。 |
| `unknown_or_overlapping_dirty` | blocked | Classify the owner or obtain Vincent's decision; do not use a worktree to bypass unknown or same-file changes. |
| `concurrent_active_work` | allow; worktree allowed | 提供 evidence_ref，記錄兩條 active work 的 branch、task 與寫入範圍；再通過 Project Topology gate。 |
| `urgent_hotfix_with_uncommitted_work` | allow; worktree allowed | 提供 incident evidence_ref；以暫時 worktree 處理 hotfix，完成後驗證、提交並收尾。 |
| `explicit_vincent_request` | allow; worktree allowed | 提供 Vincent 指示的 evidence_ref，再通過 Project Topology gate。 |
| `fresh_baseline_verification` | allow only with `intent=verification` | 提供 verifier evidence_ref；僅建立暫時 verification-only worktree，不得在其中實作功能。 |

An approved implementation plan, a routine feature, documentation work, or a desire for a clean-looking directory is not a worktree exception. A permitted worktree still requires `cd "$COLLAB/harness-mc" && npm run health:project-topology`; this policy decides whether one is justified, while the topology gate decides whether its folder mutation is safe.

## Repo Ready

Before the first file mutation:

1. Inspect uncommitted files and unpushed commits from previous work.
2. Run `git fetch --prune` for each hard-gated repo.
3. Read branch, upstream, HEAD, upstream SHA, ahead/behind, staged, unstaged, untracked, detached, and worktree state.
4. Apply the decision table below.
5. Claim the task when the durable claim layer is available.
6. Modify files only after every hard-gated repo is `READY`.

| State | Result | Allowed action |
| --- | --- | --- |
| clean, ahead `0`, behind `0` | `READY` | Continue. |
| clean, behind-only | recoverable | Run fast-forward-only update, verify `0/0`, then continue. |
| ahead-only with durable exact-scope approval and unchanged remote SHA | recoverable | Retry a normal, exact-ref push; never force. |
| generated-only dirty proven by registry and deterministic verifier | warning | Continue only when JV-37 classifier evidence exists. |
| classified manual dirty outside the exact scope, with Vincent-approved exclusions | warning | Preserve it; use a normal branch plus an exact path scope. |
| manual, mixed, or unknown dirty that overlaps the target scope | `BLOCKED` | Preserve files and report the owning scope. Do not auto-commit or auto-create a worktree. |
| new short-lived branch at verified base SHA, no local commits, no upstream | warning | Continue on the exact task scope; establish upstream only at the approved first push. |
| existing local commits or unknown base with no upstream | `BLOCKED` | Stop and report one reversible reconciliation action. |
| unauthorized ahead, diverged, detached, auth/fetch failure | `BLOCKED` | Stop and report one reversible next action. |

## Remote Closeout

Work is not complete at `committed_local`.

1. Run fresh verification.
2. Use `worktree-commit` with an exact path scope and Vincent approval.
3. Fetch again immediately before push.
4. Push only the exact approved ref with a normal fast-forward push.
5. Verify remote SHA equals the approved local SHA and ahead/behind is `0/0`.
6. Apply the task event/integration boundary required by the repo class.
7. Release the claim only after remote truth and canonical task state agree.

## Repo Classes

- `shared_core_multi_writer`: one task per branch; use a worktree only after the exception preflight allows it. Feature workers do not write main; the integrator owns main integration.
- `owner_single_writer`: the task owner may update main after the branch/HEAD/upstream/ahead-behind handshake passes.

JV-37 A03 is the only repo scope/classification contract. Existing worktree inventory consumes it; automation must not create another maintained-repo list.

## Prohibited Automation

- No automatic commit of unknown or user-modified files.
- No automatic stash, reset, rebase, conflict resolution, or force push.
- No heartbeat commits or heartbeat branch used as a second state system.
- No global blocking caused by an unrelated repo.
- No claim release or completion while work is only local.

## Current Enforcement

`worktree-exception-preflight.mjs` and its negative fixtures enforce only the narrow selection rule above. JV-37 is otherwise still `todo`; until the remaining deterministic Repo Ready and Remote Closeout gate is accepted, Agents must follow this contract explicitly and must not claim that the full coordination workflow is automated.

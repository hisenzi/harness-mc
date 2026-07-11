# Repo Coordination Gate

> Task: `multi-machine-repo-coordination-gate` (`JV-37`)
> Status: contract only; runtime not yet accepted
> Updated: 2026-07-12
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
| manual, mixed, or unknown dirty | `BLOCKED` | Preserve files and report the owning scope. Do not auto-commit. |
| unauthorized ahead, diverged, detached, no upstream, auth/fetch failure | `BLOCKED` | Stop and report one reversible next action. |

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

- `shared_core_multi_writer`: one task per branch/worktree; feature workers do not write main; the integrator owns main integration.
- `owner_single_writer`: the task owner may update main after the branch/HEAD/upstream/ahead-behind handshake passes.

JV-37 A03 is the only repo scope/classification contract. Existing worktree inventory consumes it; automation must not create another maintained-repo list.

## Prohibited Automation

- No automatic commit of unknown or user-modified files.
- No automatic stash, reset, rebase, conflict resolution, or force push.
- No heartbeat commits or heartbeat branch used as a second state system.
- No global blocking caused by an unrelated repo.
- No claim release or completion while work is only local.

## Current Enforcement

JV-37 is still `todo`. Until its deterministic gate and negative fixtures are accepted, Agents must follow this contract explicitly and must not claim that Repo Ready or Remote Closeout is automated.

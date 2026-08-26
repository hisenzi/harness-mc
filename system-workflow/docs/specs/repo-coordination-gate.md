# Repo Coordination Gate

> Task: `multi-machine-repo-coordination-gate` (`JV-37`)
> Contract: `MW-GIT-AUTH-01`
> Status: local JV37-E2E-01..05 passed; real multi-session E2E-06 blocked
> Updated: 2026-08-14
> Read when: any Agent is about to modify a Git repo for the first time in a session, or is closing work that must reach remote truth

## Purpose

Make repo collaboration safe across Vincent's supported work environments without asking him to
remember Git commands or clean up Agent-created isolation.

The user-facing result has only two states:

- `READY`: the repos required for this action are safe to modify.
- `BLOCKED`: the Agent stops and reports one reason plus one next action.

## Document Roles

- `$COLLAB/notyet-harness/000_Agent/CORE.md` is the mandatory startup pointer.
- `$COLLAB/AGENTS.md` and `$COLLAB/CLAUDE.md` route supported Agent runtimes to CORE.
- This document is the human-readable coordination contract.
- `$COLLAB/harness-mc/milestones/morrowise/tasks.json#multi-machine-repo-coordination-gate` owns task state and acceptance.
- `$COLLAB/harness-mc/scripts/repo-coordination-runtime.mjs` is the executable Repo Ready／continuation driver.
- `$COLLAB/notyet-harness/000_Agent/skills/multi-machine-repo-coordination/SKILL.md` is the thin Agent entrypoint.
- Local JV37-E2E-01..05 passing is not full acceptance. JV-37 stays incomplete until the source-bound JV37-E2E-06 real multi-session pilot passes.

Do not copy the complete state table into entry files or another registry.

Cross-repo publication order is fixed: publish this `harness-mc` contract first,
verify remote truth, then publish the `notyet-harness` CORE/Skill references.

## Quick bootstrap 例外

本契約的 Repo Ready 與 Remote Closeout 管理一般 repo 修改及所有 Git 生命週期；
不適用於 Quick 的受控原子開案交易。唯一例外是明確執行
`$COLLAB/harness-mc/scripts/new-project.py quick`，並只寫入其定義的 README、
最小 project.json、tasks.json 與 topology record。

Quick 不得先執行 Repo Ready，也不讀取、判定或處理 Git／GitHub、commit、push、
branch、worktree、部署或同步。已正式 commit 但尚未 push 的批次，以及無關 root 的
global maintenance，只能出現在 Quick receipt 的 maintenance 資訊；不得阻擋合法
target。Quick 的安全邊界只由 `project-init` Skill 的三項 Gate Budget 決定。

Quick receipt 回傳後，任何後續 Git 生命週期或一般 repo 修改立即重新適用本契約。
此例外不允許以 Quick 名義繞過 target 自身衝突、非 canonical destination、
path／symlink escape、blocked migration 或無法完整回復的交易。

## Default Direct-Main Workflow

For single-developer sequential work, the workflow does not create an
intermediate branch: single-developer sequential work stays on the checked-out `main`
after fetch, upstream, HEAD 的 Git commit 識別碼（commit SHA）, ahead/behind,
dirty ownership, and exact commit scope all pass Repo Ready.

There is no duration-based branch category. In particular, a branch does not
become acceptable because it is described as temporary, brief, clean, routine,
or easy to delete.

Known unrelated dirty files stay in place and are excluded with exact path
scope. Overlapping manual, mixed, or unknown dirty files return `BLOCKED`; they
do not trigger Git isolation.

### Approved Base Fast-forward Continuation

An already approved direct-main exact plan may classify a changed base as
`safe_non_overlapping_fast_forward` and continue without renewed approval only
when every condition below is freshly proven:

1. the actual base is a fast-forward descendant of the approved base;
2. paths changed from the approved base to the actual base have no intersection
   with `commit_scope`; touching the same scope file is overlap and returns
   `BLOCKED` even when the changed hunk differs;
3. the approved target diff fingerprint is unchanged;
4. every approved commit message and logical grouping is unchanged;
5. the relevant verifier is rerun against the actual base and remains `PASS`;
6. the target scope has no new manual, mixed, or unknown dirty ownership.

Record the approved and actual base commit SHA plus this disposition in the
receipt. This is a bounded continuation of the same approval, not permission to
absorb the intervening commits or alter their files.

A non-fast-forward or diverged base, an intersection with `commit_scope`, a
changed diff fingerprint, message, logical grouping, verifier result, or dirty
ownership returns `BLOCKED` and requires an updated plan. Path overlap is
decided at file level; semantic confidence or different hunks cannot override
it.

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
approved plan. A conflict, non-fast-forward result, changed remote commit SHA,
changed scope, or unmerged work invalidates the automatic continuation and
returns `BLOCKED`. The direct-main
`safe_non_overlapping_fast_forward` classification above does not authorize
changing an approved isolation base.

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
3. Read current branch, upstream, HEAD/upstream commit SHA, ahead/behind, staged,
   unstaged, untracked, detached, and worktree state.
4. Verify the direct-main default; if the task proposes any branch/worktree creation or switching, verify `MW-GIT-AUTH-01`.
5. Apply the decision table.
6. Modify files only after every hard-gated repo is `READY`.

| State | Result | Allowed action |
| --- | --- | --- |
| clean, checked-out `main`, ahead `0`, behind `0` | `READY` | Continue without switching refs. |
| clean, behind-only on checked-out `main` | recoverable | Run fast-forward-only update, verify `0/0`, then continue. |
| ahead-only with durable exact-scope approval and unchanged remote commit SHA | recoverable | Retry a normal exact-ref push; never force. |
| generated-only dirty proven by deterministic verifier | warning | Continue only when classifier evidence exists. |
| classified unrelated manual dirty with approved exclusions | warning | Preserve it and use an exact path scope on the current branch. |
| target scope overlaps manual, mixed, or unknown dirty | `BLOCKED` | Preserve files and report the owner. |
| branch/worktree creation or switching lacks exact Vincent approval | `BLOCKED` | Stay read-only and request one bounded authorization. |
| unauthorized ahead, diverged, detached, unknown upstream/base, auth/fetch failure | `BLOCKED` | Stop and report one reversible next action. |

## Remote Closeout

Work is not complete at `committed_local`, on an approved isolation branch, or with a
pending governance event.

### Air Traffic Controller Full-delivery Continuation

When Vincent says 「確認完整交付」 for the displayed exact C1/C2 plan, the
Air Traffic Controller carries one finite authorization（一次授權）through
`C1 commit -> C1 正常 push -> remote delivery verification -> task event ->
authorized single-writer canonical apply -> closeout sync -> necessary generator
-> MC 儀表板 -> C2 commit -> C2 正常 push -> read-only Terminal Gate`.
These are two normal pushes in physical delivery order: product C1 reaches remote
truth before canonical closeout begins, and Harness C2 is pushed only after every
required mutation and dashboard refresh is complete. This authorization does not
include force push, deployment, scope expansion, or absorption of baseline dirty.

After a session interruption, temporary Repo Ready block, or queued closeout, the
controller rereads immutable evidence and continues from the 首個未滿足 state.
It may 排隊／重試／續跑 only while every authorization 不變量 remains unchanged:
exact scope, no base path overlap, fast-forward safety, diff/message/grouping,
verifier, ownership, and existing human decision. A scope change, base path
overlap, non-fast-forward, verifier change, ownership conflict, or new human
decision（人工決策）returns `BLOCKED` and escalates to Vincent instead of reusing
the old authorization.

This is a role in the existing `closeout-commit-routing` path. It is not a second
task system and does not claim that an independent JV-37 daemon runtime is accepted.

The finite task-completion path is:

```text
committed_local -> commit_reviewed -> integrated_main -> delivery_verified -> canonical_applied -> closeout_remote_synced -> residual_zero -> task_completed
```

1. Run fresh verification and use `worktree-commit` with an exact path scope,
   destination `main`, and Vincent approval or the full-delivery confirmation above.
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
- `owner_single_writer`: the task owner updates the checked-out `main` after the normal commit SHA/ahead-behind handshake and exact commit approval.

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

The JV-37 runtime uses a hidden remote coordination ref and normal Git push as
the compare-and-swap claim boundary. The durable
`task.claimed`／`task.remote_synced`／`task.released` reducer accepts only evidence
whose remote ref/SHA and ancestry can be read back. Crash recovery derives the
first unmet action from that remote chain, canonical overlay and queues rather
than caller-supplied booleans. Multi-clone negative fixtures, live Git
authorization/terminal inspection and the source-bound P3 seam cover the local
acceptance boundary. Run
`npm run test:repo-coordination-runtime` for JV37-E2E-01 through JV37-E2E-05.

Without `--case`, the verifier intentionally exits blocked until a source-bound
JV37-E2E-06 receipt is supplied. JV-37 stays `todo`; Agents must not claim the
full coordination workflow or downstream P3 Final Admission is accepted.

P3 reads this receipt only through
`scripts/morrowise-phase3-jv37-admission.mjs`; its missing／stale／partial／
fixture-only rejection wiring is verified by `npm run test:phase3-jv37-admission`.
The production CLI is pinned to its own harness-mc checkout/origin and verifies
the current matrix, runtime-source digest, verifier ref, claim ancestry, at
least two independently identified fresh-session observation refs and terminal
state. GitHub account/repo permission is the access boundary. A device is never
registered, white-listed or granted C2 authority; observations are remote-bound
Git evidence and may originate from the same or different supported
environments. No hardware fingerprint, machine key or device registry is
collected.

Authorization continuation remains verify-only: its immutable remote approval
record must carry a valid signature from the one active Vincent approver public
key in `system-workflow/registries/jv37-authorization-approvers.json`. That is
one user-level approval root, not a per-device gate, and the runtime never reads
a private key or self-issues approval. Local E2E-01..05 may pass while E2E-06
and P3 remain blocked until a current source-bound multi-session receipt is
available. This is the JV-37 admission seam, not an implementation of the rest
of P3.

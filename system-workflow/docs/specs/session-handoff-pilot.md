# Explicit session handoff pilot

This opt-in adapter adds observations to the existing repo-coordination CLI. It does not change `repo-ready`, the default main-only workflow, ownership, task completion, or approval policy. Select it only for a named isolation lifecycle explicitly approved by the user.

## Sources and responsibility

The original Issue/task/workbook owns intent and acceptance. A handoff packet locates that work and the owner's explicit release; it is not another task registry, a lock, or an approval token. Git supplies checkout, history and dirty state; GitHub supplies PR state; local Git notes retain verification evidence. The receiving session must independently check the original authorization, stopped owner, allowed paths and required checks before acting.

`session-inspect` never fetches, edits source, creates a PR, merges, or deletes. Its `operation_authority` always requires external approval. Its advice is an observation at a point in time; recheck immediately before each approved mutation. A passing inspection cannot override an unknown owner or an active session.

```sh
node scripts/repo-coordination-runtime.mjs session-inspect --repo "$REPO" --input "$PACKET"
node scripts/repo-coordination-runtime.mjs session-verify --repo "$REPO" --input "$PACKET" --session "$SESSION_ID"
node --test scripts/verify-session-handoff.test.mjs
```

Run the CLI from the approved supporting checkout until this adapter is merged. Receiving sessions must record the supporting commit SHA and their own session ID in the original work's evidence.

## Packet

```json
{
  "version": 1,
  "task_ref": "https://github.com/example/repo/issues/6",
  "repository": "example/repo",
  "branch": "codex/approved-lane",
  "target_branch": "main",
  "base_sha": "<full approved base SHA>",
  "scope_paths": ["exact/path.md", "exact/verifier.mjs"],
  "handoff": {
    "source_session": "<stopped source session>",
    "state": "released",
    "head_sha": "<full HEAD SHA>",
    "working_diff_sha256": "<required when transferring dirty scope>"
  },
  "verifier": {
    "id": "approved-check",
    "command": "node",
    "args": ["exact/verifier.mjs"]
  }
}
```

An optional positive integer `pr_number` selects a known PR. Paths must be exact repo-relative files, without globs, traversal or symlinks. `--repo` must resolve to the worktree root, with the named branch and matching GitHub origin. Any tracked path with assume-unchanged or skip-worktree flags blocks inspection: a clean status alone cannot prove its worktree content matches the commit. Dirty paths and all paths touched by commits since the approved base must fit the manifest, including reverted changes. This conservative pilot blocks integration commits that introduce other paths; an authorized integration plan must review and refresh the base/scope as needed, never silently expand them.

The original owner records HEAD and, for dirty handoff, the `local.working_diff_sha256` returned by inspection (separate staged/unstaged diffs and untracked content), then stops writing that scope. The receiving session records its acceptance outside source and refreshes its packet after authorized commits. Editing a packet cannot grant permission. Scope/verifier/base changes must remain within the original authorization or return for a new decision.

## Verification and delivery

`session-verify` executes the reviewed verifier without a shell, against a clean worktree whose HEAD matches the packet. A nonzero exit, timeout, changed HEAD/tree, or newly dirty worktree cannot yield a pass. Within each commit, note append order determines the latest attempt, so clock rollback cannot revive an earlier pass. Each attempt writes a started record before execution, then failed or passed evidence. A crash or a failed retry invalidates the current pass while retaining the historical verified SHA. Remote target/branch/PR are compared before and after verification; a changed or unknown snapshot prevents a pass. Successful evidence binds commit, tree, target SHA, verifier definition, producer implementation, session, timestamp and output digest. It appends to `refs/notes/jv37-session-verification`; it does not replace C1 receipts or write canonical tasks.

Notes are local, mutable evidence shared by linked worktrees on the same machine. They are not authenticated attestations, do not prove absent concurrent writers, and are not automatically pushed or available on another machine. This pilot verifies different Codex sessions on one machine; cross-machine transfer and adversarial evidence are outside its claim.

| Observation | Next action |
| --- | --- |
| Missing release, changed handoff HEAD, unknown dirty scope | Resolve ownership/identity before continuing |
| Exact transferred dirty scope | Review and commit only approved paths |
| No current proof, newer commit, changed verifier/producer | Run the approved verifier on the current clean commit |
| Network/PR state unknown | Refresh evidence, never infer no PR or delivered |
| Main changed since proof, or main not an ancestor | Refresh target and verify integration before review/merge |
| Remote branch differs from verified HEAD | Recheck and push the reviewed immutable SHA to the approved branch |
| Branch pushed, no PR found | Create the authorized Draft PR, then read back |
| Matching open PR | Request the user's merge review; do not merge |
| PR closed without merge | Resolve closed PR; do not clean up |
| PR says merged but objects/ancestry missing | Fetch approved refs and verify the merge |
| Merged PR head matches local HEAD; head and merge SHA reachable from live main | Mark merged_observed and verify the exact merged target; no cleanup permission |

`verification.local` and `verification.integration` are separate. A main change preserves the local result for its tested commit but invalidates the integration result. Source changes cannot borrow an ancestor's pass. A branch push or Draft PR remains distinct from delivery into main. PR data is read live; missing local target objects prevent an ancestry claim.

Merge verification currently recognizes ancestry-preserving merges only. Squash/cherry-pick delivery needs reviewed source-to-target patch mapping outside this adapter and stays unresolved here. Ancestry alone never marks merged_verified or recommends cleanup: conflict resolution can still break the result. An approved integrator must run and record the original checks against the exact merged target SHA, then obtain cleanup approval and verify clean scope, absence of active dependencies/writers and protection of new commits. This adapter leaves that step as verify_merged_target; it does not execute target checks or cleanup. Deployment and CI requirements remain those of the original task; this adapter is not a general CI or acceptance engine.

## Evidence boundary

Fixture tests cover stale commits, dirty source, unknown scope, failed/mutating verifiers, owner release, offline remote, advanced target and PR/merge distinctions. Fixture success is not real session handoff or real sequential merge evidence. The pilot report must separately identify source/receiver sessions, actual branch/PR/commit identities and which merge/cleanup stages await user approval. Before every merge, inspect the latest target and rerun the applicable integration checks; after the first lane merges, the second cannot reuse its old target result.

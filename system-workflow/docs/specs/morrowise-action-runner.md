# MorroWise Action Runner v0

> Task: `morrowise-autonomous-action-runner-v0` (`MC-LIVE-19`)
> Status: low-risk runner v0
> Updated: 2026-06-21
> Module: `$COLLAB/harness-mc/scripts/morrowise-action-runner.mjs`
> Verifier: `$COLLAB/harness-mc/scripts/verify-morrowise-action-runner.mjs`
> Upstream: `morrowise-approval-policy`, `acp-external-sync-queue`

## Purpose

This runner is the first execution surface after trigger, recommendation, and approval policy.

It is intentionally small. It does not make MorroWise autonomous in the broad sense. It only turns approved low-risk recommendation candidates into local, recoverable outputs.

## Allowed Runner Outputs

Runner v0 may produce only:

| Output | Meaning |
|---|---|
| `summary` | Local summary text. |
| `reorder_suggestion` | A proposal only; it does not edit `tasks.json`. |
| `sync_requested_event_plan` | Dry-run preview of a sync event. |
| `sync_requested_event` | A queued local `sync_requested` event when explicitly enabled. |
| `draft_patch` | Patch text only; it does not apply files. |
| `approval_request` | A stop signal for medium/high-risk or approval-required actions. |

## Hard Boundaries

- Medium-risk actions produce `approval_request`.
- High-risk actions produce `approval_request`.
- `commit_now`, `split_commit`, `push`, `deploy`, and release-like work never execute in the runner.
- The runner may only produce commit plans or draft patches. Actual commit must use `worktree-commit` confirmation gate.
- External writes are not performed. A local `sync_requested` event is not the external sync itself.
- The runner never closes tasks and never reverse-writes from visual layers to MC state.

## Sync Event Behavior

By default, the runner is `dry_run_plan_only`.

When called with `writeSyncEvents: true`, only a low-risk `queue_sync_requested` candidate may write a local event under:

```text
$COLLAB/harness-mc/sync-events/pending/
```

The event still needs the downstream external-sync queue and approval policy before any external write.

## Verification

Run:

```bash
npm run test:morrowise-runner
```

The verifier checks:

- low-risk summary candidate produces `summary`;
- low-risk reorder candidate produces `reorder_suggestion` and does not mutate tasks;
- low-risk draft candidate produces `draft_patch` and does not apply files;
- low-risk sync candidate produces dry-run plan by default;
- low-risk sync candidate can queue `sync_requested` only when `writeSyncEvents: true`;
- medium/high-risk candidates produce `approval_request`;
- no real repository sync queue is touched during tests.

## Next Work

`morrowise-proactive-loop-dashboard` should surface runner output next to trigger, recommendation, approval, action, and feedback status.

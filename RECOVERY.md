# Recovery Branch Manifest

- Status: open
- Created: 2026-07-12
- Owner: Vincent
- Branch: `recovery/mba2-core-sync-20260712-harness-mc`
- Base worktree: MBA-2 `main` before core sync
- Target main: `origin/main` at `f0d5ad6`
- Review by: 2026-07-19

## Preserved State

- Five append-only task events under `task-events/pending/`:
  - `travel-finance-dashboard/p2-notion-to-ledger-importer`
  - `dual-blade/mba3-config-consumer-sync`
  - `dual-blade/mba3-safe-restore`
  - `dual-blade/heptabase-cli-integration-record`
  - `morrowise/mba2-catch-up-restore`

## Resolution Rule

1. On updated `main`, inspect these events against the current task state and commit graph.
2. Rehome only valid events to the canonical pending outbox, then run the single-writer reducer with its normal verification.
3. Record applied, rejected, or duplicate outcomes before closing this recovery.
4. After every event has a durable outcome, delete this branch and its remote counterpart.

Do not merge this branch wholesale into `main`.

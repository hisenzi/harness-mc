# MorroWise Live Surface Audit

> Task: `morrowise-live-surface-audit` (`MC-LIVE-SYS-02`)
> Status: audit
> Updated: 2026-06-21
> Standard: `morrowise-live-system-verification-standard.md`
> Scope: MC surfaces for MorroWise / live dashboard. Taiwan.md and Semiont are not audit subjects.

## Verdict

No audited MC surface should currently be called fully `live`.

Most surfaces already read generated data and expose useful action signals, but they do not yet publish a complete living-system contract:

```text
source -> generator -> generated_at -> stale_rule -> next_action -> write_boundary -> verifier
```

Current overall state:

| Classification | Count | Surfaces |
|---|---:|---|
| `live` | 0 | none |
| `semi_live` | 6 | System Attention, MorroWise 活系統, MorroWise 主動閉環, Task Event Pipeline, Worktree Status, Approval Queue |
| `static_display` | 0 | none in this audit set |
| `fake_live_risk` | 0 | none, because visible surfaces mostly preserve read-only semantics and do not claim autonomous writes |

The main gap is not data availability. The main gap is contract visibility and verifier ownership.

## Audit Table

| Surface | source | generator | generated_at | stale_rule | next_action | write_boundary | verifier | classification | gaps |
|---|---|---|---|---|---|---|---|---|---|
| System Attention | `public/data/changes.json`, `public/data/task-events.json` | `sentinel-diff.mjs`, `generate-task-event-data.mjs`, `prebuild` | visible in header/freshness rows | UI uses 15 minutes for freshness | top stale/blocked/queue items | implied read-only, not stated in the card | `npm run build`; no dedicated surface verifier | `semi_live` | Needs explicit write boundary, dedicated verifier, and route/action mapping for each top item. |
| MorroWise 活系統 | `projects.json`, `task-events.json`, `changes.json`, `milestones/harness-mc/tasks.json` via generated projects | `generate-data.mjs`, `generate-task-event-data.mjs`, `sentinel-diff.mjs`, homepage derivation | visible as latest sentinel/pipeline timestamp | derived from upstream freshness, not stated as rule | next MorroWise task is shown | source shown, read-only boundary not explicit in card | covered indirectly by build/tasks tests; no MorroWise live-surface verifier | `semi_live` | Needs its own read model contract, stale/degraded state, write boundary, and verifier. |
| MorroWise 主動閉環 | `public/data/morrowise-proactive-loop.json`, approval policy registry, task-events, sync-events | `generate-morrowise-proactive-loop.mjs`, `morrowise-action-runner.mjs`, `prebuild` | visible in card | not encoded in read model or UI | active scenario shows reason, output type, approval count | explicitly says read-only: no task close, commit, or external sync | `npm run test:morrowise-loop` | `semi_live` | Closest to live, but still lacks stale_rule and a real open-loop persistence model beyond generated fixture scenarios. |
| Task Event Pipeline | `task-events/*`, `sync-events/*`, `public/data/task-events.json`, `task-events/latest-report.json` | `generate-task-event-data.mjs`, `apply-task-events.mjs` for reducer report | present in generated read model; summarized through other cards | no visible stale rule; queue age not surfaced | pending/rejected/sync counts imply reducer/sync action | reducer is local; external sync still approval-bound, but card contract is not visible | `npm run test:task-event-dashboard`, `npm run test:apply-task-events`, `npm run test:sync-event-queue` | `semi_live` | No standalone homepage card in current `app/page.tsx`; queue age, boundary, and verifier are not visible together. |
| Worktree Status | `public/data/worktrees.json`, local git status under `$COLLAB` | `generate-worktree-status.mjs`, `prebuild` | visible in card | stale after any file edit/commit/checkout/handoff, but not visible | each repo carries `suggested_action` | card implies status only; commit/push boundary not explicit in live card | `npm run test:worktree-status` | `semi_live` | Needs visible stale rule, source/generator path, and explicit commit/push approval boundary. |
| Approval Queue | `morrowise-proactive-loop.json`, `morrowise-approval-policy.json`, action runner outputs | `generate-morrowise-proactive-loop.mjs`, `morrowise-action-runner.mjs` | present via proactive loop generated_at | no queue-specific stale rule | approval count and waiting scenario are shown | policy says approval required; standalone queue boundary not visible | `npm run test:morrowise-approval`, `npm run test:morrowise-runner`, `npm run test:morrowise-loop` | `semi_live` | No standalone approval queue read model/surface; lacks payload preview, owner, age, exact requested action, and closure status. |

## Surface Findings

### System Attention

Current strengths:

- Reads current generated data from `changes.json` and `task-events.json`.
- Displays generated timestamp and a 15-minute freshness check.
- Separates stale, blocked, queue pending, and top attention items.

Gaps:

- The card does not explicitly say it is read-only.
- Top attention rows are not yet durable action records; they are summaries without stable route ids for every item.
- Verification is indirect through build and generator behavior, not a dedicated surface verifier.

Classification: `semi_live`.

### MorroWise 活系統

Current strengths:

- Reads MorroWise tasks from generated projects data.
- Combines task state, task-event queue, and sentinel stale state.
- Shows the next executable MorroWise task.
- Shows source text in the card.

Gaps:

- The surface is still derived inside `app/page.tsx`; it does not have a dedicated `morrowise-live-dashboard.json` contract.
- It lacks explicit stale/degraded logic.
- It does not expose write boundary in the card.
- It has no dedicated verifier for the living-system contract.

Classification: `semi_live`.

### MorroWise 主動閉環

Current strengths:

- Has a generated read model: `public/data/morrowise-proactive-loop.json`.
- Has a generator and verifier.
- Shows generated time, read-only boundary, approval count, active scenario, and runner output type.
- Explicitly blocks task close, commit, and external sync from the dashboard surface.

Gaps:

- Stale/degraded rule is not encoded.
- Current scenarios are generated fixtures for loop semantics; they are not yet persisted open-loop records from real runtime events.

Classification: `semi_live`.

### Task Event Pipeline

Current strengths:

- Has a generated read model with pending/applied/rejected task events and pending/synced/failed sync events.
- Has verifiers for outbox, reducer, state merge, sync queue, and dashboard data.
- Feeds System Attention and MorroWise summary counts.

Gaps:

- The current homepage does not have a standalone Task Event Pipeline card in `app/page.tsx`.
- Queue age and exact next reducer action are not surfaced in the homepage.
- The external sync boundary is known from policy/specs, but not visible on the pipeline surface itself.

Classification: `semi_live`.

### Worktree Status

Current strengths:

- Has a generated read model from live git status.
- Shows generated time, repository status categories, file counts, local commits, remote commits, and suggested actions.
- Has a generator that classifies uncommitted, local commits, reconcile pressure, and clean repos.

Gaps:

- The UI title says "待收尾工作"; the audit target name "Worktree Status" appears only in subcopy.
- The stale rule is not visible, even though git state becomes stale after edits, commits, checkouts, or handoff.
- The card suggests actions but does not visibly restate commit/push approval boundaries.

Classification: `semi_live`.

### Approval Queue

Current strengths:

- Approval policy exists and is machine-readable.
- Proactive loop read model counts approval requests and shows waiting approval as a scenario.
- Runner blocks approval-required action classes.

Gaps:

- There is no independent Approval Queue surface or read model.
- The UI does not show exact requested action, destination, payload preview, owner, age, or closure condition.
- Approval queue is currently embedded in MorroWise 主動閉環 rather than auditable as its own surface.

Classification: `semi_live`.

## Required Follow-Up

These gaps should feed the next tasks.

| Gap | Recommended owner |
|---|---|
| Dedicated live dashboard contract for all audited surfaces | `MC-LIVE-SYS-04` |
| Real generated data flow that unifies surface contracts | `MC-LIVE-SYS-05` |
| Stale/degraded states, especially for proactive loop, worktree status, task-event queue, and approval queue | `MC-LIVE-SYS-06` |
| Surface verifier that checks the full SYS-01 contract | `MC-LIVE-SYS-07` |
| Homepage implementation with sidebar, summary, drill-down routes, and explicit boundaries | `MC-LIVE-SYS-08` |

## Acceptance Check

This audit satisfies `MC-LIVE-SYS-02` because it:

1. Applies the `MC-LIVE-SYS-01` standard.
2. Audits System Attention, MorroWise 活系統, MorroWise 主動閉環, Task Event Pipeline, Worktree Status, and Approval Queue.
3. Classifies every required surface.
4. Lists gaps for each surface.
5. Keeps Taiwan.md and Semiont outside the verification subject.


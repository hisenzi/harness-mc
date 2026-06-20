# MorroWise Trigger Rules Registry

> Task: `morrowise-trigger-rules-registry` (`MC-LIVE-16`)
> Status: formal registry
> Updated: 2026-06-20
> Machine-readable registry: `$COLLAB/harness-mc/system-workflow/registries/morrowise-trigger-rules.json`

## Purpose

This registry turns MorroWise from a passive dashboard into a system that can notice when MC should wake up.

The registry does not execute actions. It defines:

```text
source
  -> condition
  -> cooldown
  -> output_event
  -> next owner
```

The next owner is usually `morrowise-recommendation-engine-v0`, `worktree-commit`, `acp-external-sync-queue`, `project-init`, or an approval policy task.

## Boundary

MorroWise is still not autonomous after MC-LIVE-16.

Triggers may:

- detect signals;
- classify risk;
- produce output event candidates;
- feed recommendation work;
- request approval.

Triggers may not:

- mutate external systems;
- close tasks without task-state evidence;
- bypass Vincent approval for approval-required actions;
- use Heptabase or Canvas as source of truth;
- run high-risk actions directly.

## Required Trigger Families

MC-LIVE-16 requires these trigger families:

| Required family | Registry trigger |
|---|---|
| stale / blocked task | `morrowise.stale_blocked_task` |
| sync failed | `morrowise.sync_failed` |
| rejected event | `morrowise.rejected_task_event` |
| weekly review | `morrowise.weekly_review` |
| session startup | `morrowise.session_startup` |
| project-init growth gate missing | `morrowise.project_init_growth_gate_missing` |

Additional families included:

- user phrase;
- task completion / commit boundary;
- docs / state drift;
- visual sync gap;
- approval wait.

## Trigger Contract

Each trigger must have:

| Field | Meaning |
|---|---|
| `trigger_id` | Stable id. |
| `family` | Grouping used by recommendation and dashboard layers. |
| `source` | File, generated data, event, route, or user request to inspect. |
| `condition` | Exact condition that wakes MC. |
| `cooldown` | Suppression window to avoid noisy loops. |
| `output_event` | Event type, target owner, and payload fields. |
| `next_step` | What should happen after the trigger fires. |
| `risk_level` | `low`, `medium`, or `high`. |

## Current Registry

| Trigger | Source | Output |
|---|---|---|
| `morrowise.user_phrase` | current user request | `morrowise.triggered` |
| `morrowise.weekly_review` | `changes.json` | `morrowise.review_requested` |
| `morrowise.stale_blocked_task` | `changes.json` | `morrowise.open_loop_detected` |
| `morrowise.task_completed_without_state_or_commit` | `worktrees.json` | `morrowise.commit_boundary_needed` |
| `morrowise.rejected_task_event` | `task-events.json` | `morrowise.event_repair_requested` |
| `morrowise.sync_failed` | `task-events.json` | `morrowise.sync_repair_requested` |
| `morrowise.session_startup` | `$COLLAB/AGENTS.md` | `morrowise.startup_check_requested` |
| `morrowise.project_init_growth_gate_missing` | `projects.json` | `morrowise.project_anchor_missing` |
| `morrowise.docs_state_drift` | system-workflow docs | `morrowise.drift_detected` |
| `morrowise.visual_sync_gap` | `projects.json` | `morrowise.visual_sync_requested` |
| `morrowise.approval_wait` | future approval queue | `morrowise.approval_required` |

## Data Sources

| Source | Role |
|---|---|
| `public/data/changes.json` | Sentinel changes, stale tasks, blocked tasks. |
| `public/data/task-events.json` | Pending/rejected task events and sync events. |
| `public/data/worktrees.json` | Dirty work and commit pressure. |
| `public/data/projects.json` | Project/task anchors, visual sync refs, current task map. |
| `$COLLAB/AGENTS.md` and shared startup docs | Portable Agent startup / session trigger. |
| `system-workflow/docs/specs` | Routing docs; never current task state when in conflict with `tasks.json`. |

## Output Event Semantics

Output events are recommendation inputs, not actions.

| Event type | Meaning |
|---|---|
| `morrowise.triggered` | User phrase matched MorroWise and needs task routing. |
| `morrowise.review_requested` | Weekly or heartbeat review should produce recommendations. |
| `morrowise.open_loop_detected` | A stale/blocked item needs classification. |
| `morrowise.commit_boundary_needed` | Completed work may need split/commit/task-state update. |
| `morrowise.event_repair_requested` | Task-event reducer rejected something and needs repair. |
| `morrowise.sync_repair_requested` | External sync needs dry-run, retry, approval, or migration. |
| `morrowise.startup_check_requested` | New Agent session must confirm startup chain and work anchor. |
| `morrowise.project_anchor_missing` | Project exists without a valid executable task anchor. |
| `morrowise.drift_detected` | Docs/dashboard/generated/visual state conflicts with canonical state. |
| `morrowise.visual_sync_requested` | Heptabase/Canvas/dashboard visual layer is missing or stale. |
| `morrowise.approval_required` | A side effect must wait for Vincent approval. |

## Cooldown Rule

Cooldown prevents the system from turning one unresolved problem into repeated noise.

The registry uses human-readable cooldowns for v0:

- `none`;
- `session`;
- `session per task_id`;
- `1h per event_id`;
- `2h per target/task_id`;
- `6h per task_id`;
- `24h`;
- `24h per project`.

Future generator work can normalize these into machine timestamps.

## Verification

Run:

```bash
npm run test:morrowise-triggers
```

This verifies:

- registry JSON parses;
- required trigger families exist;
- every trigger has source, condition, cooldown, output event;
- output events have type, target, and payload;
- high-risk triggers do not claim direct execution;
- the markdown spec points to the machine-readable registry.

## Next Work

`morrowise-recommendation-engine-v0` should consume this registry and produce recommendation candidates:

- reason;
- evidence_refs;
- risk_level;
- requires_approval;
- suggested_task_id.


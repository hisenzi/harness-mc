# MorroWise Growth Gate Spec

> Task: `morrowise-growth-gate-spec` (`MC-LIVE-04`)
> Status: formal spec
> Updated: 2026-06-20
> Current source of truth: `$COLLAB/harness-mc/milestones/harness-mc/tasks.json`
> Inputs: `morrowise-living-system-index.md`, `morrowise-mc-task-map.md`, `morrowise-system-audit.md`, `control-plane-operating-loop.md`

## Purpose

MorroWise becomes a living system only when work changes the system's future behavior.

A growth gate is the routing rule that decides:

```text
trigger
  -> source evidence
  -> process decision
  -> output event / state update / task update
  -> MC surface
  -> feedback close rule
```

The rule is not "Vincent remembers to check it." Every accepted gate must leave a durable trace in MC task state, task events, generated read models, or a formal open-loop record.

## Scope

This spec defines the first MorroWise growth gates. It does not implement the generated read model or dashboard UI.

Implementation ownership:

| Area | Current / next owner |
|---|---|
| Gate definitions | `morrowise-growth-gate-spec` |
| Open-loop schema | `morrowise-anatomy-read-model` |
| Trigger registry | `morrowise-trigger-rules-registry` |
| Recommendations | `morrowise-recommendation-engine-v0` |
| Approval classes | `morrowise-approval-policy` |
| Dashboard surface | `morrowise-dashboard-surface` |
| Visual sync coverage | `acp-visual-sync-coverage-report` |
| External sync boundary | `ACP-SYNC-01..05`, `acp-external-sync-queue` |

## Gate Contract

Every growth gate must define these fields:

| Field | Meaning |
|---|---|
| `gate_id` | Stable id used by future read models. |
| `trigger` | What wakes the gate. |
| `source` | Files, generated data, events, or user phrases to read. |
| `process` | Decision steps. |
| `output` | State mutation, task event, open loop, recommendation, or approval request. |
| `surface` | Where MC must make the result visible. |
| `close_rule` | What evidence proves the loop is closed. |

No gate may close from visual-layer evidence alone. Heptabase and Obsidian Canvas are mirrors; `tasks.json`, task events, generated read models, and committed files remain canonical.

## Gate 1: User Phrase Growth Gate

| Field | Definition |
|---|---|
| `gate_id` | `user-phrase-growth-gate` |
| `trigger` | Vincent says `MorroWise`, `活系統`, `system-ops`, `Jarvis`, or asks why the system keeps patching one piece at a time. |
| `source` | Current user request, `milestones/harness-mc/tasks.json`, MorroWise source/index/task-map specs. |
| `process` | Confirm the request maps to an existing MC task. If it is feasible work and no task exists, stop and create/update a task before implementation. If a task exists, report work anchor and continue. |
| `output` | Work anchor, route to existing MC-LIVE/ACP task, or new task proposal when no owner exists. |
| `surface` | MC task list / System Attention should show the active MorroWise task and next executable task. |
| `close_rule` | The response names the task id, source path, done condition, and whether visual sync is needed. |

Required behavior:

```text
User phrase -> task lookup -> work anchor -> execution or task creation -> feedback to tasks.json
```

## Gate 2: Task Completion Growth Gate

| Field | Definition |
|---|---|
| `gate_id` | `task-completion-growth-gate` |
| `trigger` | A task reaches `done_condition`, or an agent is about to say work is complete. |
| `source` | `tasks.json`, changed files, verification output, task events, visual sync coverage, worktree status. |
| `process` | Verify artifact, check dirty-tree scope, decide commit boundary, decide whether task state should be updated, decide whether Heptabase/Canvas sync is required. |
| `output` | Commit plan, task-state update, `completed_at`, `commits`, summary, task event, sync request, or open-loop record. |
| `surface` | System Attention should show completion delta, stale visual sync, pending task events, and uncommitted completed work. |
| `close_rule` | Build/targeted verification passes, task state records completion, related commit hash is recorded, and unresolved sync/open loops are explicit. |

Decision outcomes:

| Outcome | Use when |
|---|---|
| `commit_now` | Scope is coherent, verification passes, and no approval-only side effect is bundled. |
| `split_commit` | Dirty tree contains multiple task families or unrelated user changes. |
| `keep_open_loop` | Artifact exists but state, sync, verification, or approval is incomplete. |
| `request_approval` | External write, destructive action, secret-sensitive read, push/deploy, or ambiguous state mutation is needed. |
| `block_missing_verification` | The result cannot be trusted yet. |

Required behavior:

```text
Task completed
  -> verify artifact
  -> scan dirty tree
  -> decide commit boundary
  -> commit or open loop
  -> update task state
  -> generate data
  -> show feedback in MC
```

## Gate 3: Commit Boundary Gate

| Field | Definition |
|---|---|
| `gate_id` | `commit-boundary-gate` |
| `trigger` | Dirty tree contains completed task artifacts, user asks to commit, or System Attention reports uncommitted work. |
| `source` | `git status`, `git diff --stat`, staged diff, `worktree-commit` rules, active task id. |
| `process` | Apply 4C: Context, Change, Cause, Check. Stage only the intended scope. Keep feature commits and task-state commits separate. |
| `output` | Feature commit, task-state commit, or open-loop record explaining why commit is unsafe. |
| `surface` | Worktree status and System Attention should expose uncommitted/unpushed work by task when possible. |
| `close_rule` | `git diff --cached --name-only` contains only intended paths, commit exists, and task `commits` references the relevant feature commit. |

Commit grouping rule:

```text
feature artifact commit
  -> task-state commit
  -> optional visual sync / generated data commit only when generated files are tracked and intended
```

## Gate 4: Weekly Review Growth Gate

| Field | Definition |
|---|---|
| `gate_id` | `weekly-review-growth-gate` |
| `trigger` | Weekly review, daily closing, or scheduled heartbeat asks what changed and what needs attention. |
| `source` | Sentinel diff, `public/data/projects.json`, `public/data/task-events.json`, worktree status, recent commits, blocked/stale task state. |
| `process` | Summarize done/new/blocked/stale changes, identify unresolved open loops, check pending/rejected events, and produce next-action recommendations. |
| `output` | Review summary, recommendation candidates, follow-up tasks, or open-loop updates. |
| `surface` | System Attention plus future MorroWise dashboard surface. |
| `close_rule` | Review records the latest generated timestamp, recommendations have owners, and stale/open items are either routed or explicitly deferred. |

Weekly review must not be a static markdown checklist. It reads generated/current data first, then writes durable outcomes.

## Gate 5: Stale / Blocked Task Growth Gate

| Field | Definition |
|---|---|
| `gate_id` | `stale-blocked-task-growth-gate` |
| `trigger` | A task is blocked too long, stale after inactivity, newly blocked, or repeatedly appears in Sentinel attention. |
| `source` | `tasks.json`, Sentinel diff, project status, dependencies, task notes, task events. |
| `process` | Classify reason: missing dependency, missing decision, external side effect, stale visual layer, no owner, unclear done condition, or duplicate legacy task. |
| `output` | Recommendation: unblock, split, archive, update dependency, create task event, request approval, or map to existing task. |
| `surface` | System Attention should show only the highest-signal blocked/stale tasks, with link to all projects. |
| `close_rule` | The blocked/stale item has a current reason, owner, next action, or explicit archive/defer reason in task state. |

This gate prevents a dashboard from becoming a graveyard of old statuses.

## Gate 6: New Project Growth Gate

| Field | Definition |
|---|---|
| `gate_id` | `new-project-growth-gate` |
| `trigger` | A new project is created, promoted, or enters MC without enough task structure. |
| `source` | Project `project.json`, project `tasks.json`, project-init output, MC generated projects data. |
| `process` | Confirm project has goals, risks, success criteria, at least one executable task, owner/state, and visual sync intent. |
| `output` | Project task anchor, missing-field report, project-init fix, or open-loop record. |
| `surface` | Projects page and System Attention should show projects with missing executable task anchors. |
| `close_rule` | New project has a valid task source and at least one next executable task before implementation begins. |

Required behavior:

```text
New project -> validate project/task schema -> create first executable task -> generate MC data -> surface freshness
```

## Gate 7: External Sync Growth Gate

| Field | Definition |
|---|---|
| `gate_id` | `external-sync-growth-gate` |
| `trigger` | Dry-run mismatch, sync failed, sync pending too long, legacy fallback usage, external write request, or ACP-SYNC migration step. |
| `source` | `task-events`, sync events, ACP-SYNC tasks, Heptabase/PAI sync scripts, approval policy, changelog/skill docs. |
| `process` | Classify write risk, prefer dry-run parity before external writes, decide retry/migrate/archive/request approval, and record closure evidence. |
| `output` | `sync_requested`, `sync_failed`, `sync_blocked`, migration task update, approval request, or legacy archive note. |
| `surface` | Task Event Pipeline and MorroWise dashboard surface. |
| `close_rule` | External sync has dry-run evidence, approval status when needed, and a task/event outcome. |

External sync is a MorroWise muscle, but it remains implemented by ACP-SYNC/control-plane tasks. MorroWise owns the decision semantics; ACP owns the mechanics.

## Gate 8: Docs / State Drift Gate

| Field | Definition |
|---|---|
| `gate_id` | `docs-state-drift-gate` |
| `trigger` | Markdown status conflicts with `tasks.json`, visual layer shows old data, generated data timestamp is old, or an agent asks why UI and task state disagree. |
| `source` | Markdown docs, `tasks.json`, generated data, browser route, Heptabase/Canvas metadata. |
| `process` | Determine canonical source, mark static docs as historical when appropriate, update task state or docs, regenerate data, and verify route freshness. |
| `output` | Corrected source pointer, task update, docs update, generated data refresh, or open-loop record. |
| `surface` | Every MC surface should show latest generated/update time rather than pretending static data is current. |
| `close_rule` | The canonical state and visible surface agree, or the mismatch is explicitly recorded with next action. |

Freshness rule:

```text
If data can be old, MC must show latest generated/update time.
If data is stale, MC should degrade to "stale data" state instead of presenting it as final truth.
```

## Gate 9: Approval Wait Growth Gate

| Field | Definition |
|---|---|
| `gate_id` | `approval-wait-growth-gate` |
| `trigger` | A task requires approval and remains waiting, or an agent attempts approval-required work. |
| `source` | Current request, approval policy, task event/open-loop state, pending sync/action details. |
| `process` | Classify action as allowed, approval-required, or forbidden. If approval is needed, stop before side effect and surface exact requested action. |
| `output` | Approval request, blocked open loop, or policy update task. |
| `surface` | MorroWise dashboard should show waiting approvals separately from ordinary blocked tasks. |
| `close_rule` | Approval is granted and action completes, approval is denied and task reroutes, or the task is archived/deferred. |

## Source To Output Flow

```text
Source of truth:
  milestones/*/tasks.json
  task-events/*
  committed files
  generated public/data/*.json

Process:
  MorroWise gate
  -> trigger registry
  -> recommendation
  -> approval policy when side effects exist
  -> action or open loop

Output:
  task update
  task event / sync event
  open-loop record
  commit
  generated data refresh
  visual-layer sync request

Surface:
  System Attention
  Task Event Pipeline
  Worktree Status
  Projects page
  future MorroWise dashboard surface
```

## Minimum Open Loop Record

Until `morrowise-anatomy-read-model` creates the generated schema, any open loop should at least carry:

| Field | Meaning |
|---|---|
| `loop_id` | Stable id. |
| `gate_id` | Which growth gate produced it. |
| `source` | User phrase, task, event, audit, or generated data. |
| `condition` | Why the loop remains open. |
| `risk_level` | `low`, `medium`, `high`. |
| `suggested_next_action` | Concrete next action. |
| `requires_approval` | Boolean. |
| `owner` | Vincent, Codex, external system, or future task. |
| `review_after` | When it should be checked again. |
| `evidence_refs` | File paths, task ids, event ids, commit hashes. |

## Required Trigger Coverage

This spec covers the MC-LIVE-04 required triggers:

| Required trigger | Gate |
|---|---|
| Vincent says MorroWise / 活系統 / system-ops | User Phrase Growth Gate |
| weekly review | Weekly Review Growth Gate |
| stale / blocked task | Stale / Blocked Task Growth Gate |
| new project growth gate | New Project Growth Gate |

Additional high-risk triggers are also covered:

- task completion;
- commit boundary;
- external sync;
- docs/state drift;
- approval wait.

## Non-Goals

- Do not build a new scheduler here.
- Do not make Heptabase or Canvas a source of truth.
- Do not unlock autonomous external writes before approval policy.
- Do not add new MC tasks unless a gate discovers missing ownership that cannot map to existing tasks.
- Do not use old `system-ops` completion status as current MC state.

## Next Work Entry

The next MorroWise anatomy task is:

`morrowise-anatomy-read-model` (`MC-LIVE-13`)

Use `tasks.json` as the execution order source of truth. Intermediate MC-LIVE tasks may belong to ACP/control-plane gates before this anatomy task runs.

It should turn this spec into generated data fields:

- `gates`;
- `triggers`;
- `open_loops`;
- `recommendation_candidates`;
- `approval_waiting`;
- `feedback_events`;
- `commit_boundaries`;
- `visual_sync_gaps`.

Only after those fields exist should `morrowise-dashboard-surface` decide the final UI.

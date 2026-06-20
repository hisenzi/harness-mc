# MorroWise Anatomy Read Model

> Task: `morrowise-anatomy-read-model` (`MC-LIVE-13`)
> Status: schema spec
> Updated: 2026-06-20
> Schema: `$COLLAB/harness-mc/system-workflow/schemas/morrowise-system.schema.json`
> Future read model target: `$COLLAB/harness-mc/public/data/morrowise-system.json`

## Purpose

MorroWise needs a read model before it needs another dashboard.

This document defines the shape of `morrowise-system.json` v0 so any AI Agent can read the same data contract and know:

- where Vincent's canonical data lives;
- which signals wake MorroWise;
- which loops are still open;
- which work is ready to commit, blocked, stale, or waiting for approval;
- what evidence proves a task is complete;
- how another Agent can continue without reading the original chat.

## Source Principle

Data belongs to Vincent. AI Agents are replaceable executors.

Therefore, the read model must make this portable:

```text
$COLLAB
  -> startup rules
  -> task source of truth
  -> generated read model
  -> verification commands
  -> handoff evidence
```

No Agent-specific memory, chat transcript, browser tab, Heptabase card, or Canvas node can be the only place where system state exists.

## v0 Schema Location

The machine-readable schema is:

`$COLLAB/harness-mc/system-workflow/schemas/morrowise-system.schema.json`

The future generated read model should be:

`$COLLAB/harness-mc/public/data/morrowise-system.json`

This task only defines the schema. It does not implement the generator because `acp-control-plane-read-model-v0` is still an upstream dependency.

## Required Top-Level Sections

| Section | Role |
|---|---|
| `schema_version` | Fixed version string: `morrowise-system.v0`. |
| `generated_at` | Timestamp for freshness and degraded-state decisions. |
| `source_of_truth` | Canonical files and visual-layer boundaries. |
| `portable_agent_verification` | Checks that prove another Agent can continue from `$COLLAB`. |
| `dna` | MorroWise identity, boundaries, and non-goals. |
| `memory` | Context, evidence tags, commit boundaries, and dirty work. |
| `senses` | Triggers, task events, visual sync gaps, and freshness. |
| `muscles` | Agents, tools, and action candidates. |
| `immune` | Validators, security boundaries, and approval policies. |
| `heartbeat` | Schedules, review cadence, and stale rules. |
| `feedback` | Growth gates, task events, recommendations, approvals. |
| `open_loops` | Explicit unresolved loops with owner, risk, evidence, and review time. |

## Source Of Truth Contract

`source_of_truth` must identify:

| Field | Required meaning |
|---|---|
| `collab_root` | Always `$COLLAB`; never a hard-coded local user path. |
| `canonical_task_state` | `harness-mc/milestones/*/tasks.json`, and later state/event overlays when adopted. |
| `generated_data` | Generated read models such as `projects.json`, `task-events.json`, `worktrees.json`, and future `morrowise-system.json`. |
| `visual_layers` | Heptabase, Obsidian Canvas, and dashboard routes as mirrors/read models, not sources that can close tasks. |
| `docs_are` | `routing_and_decision_evidence`; docs explain routing but do not override current task state. |

## Portable Agent Verification

`portable_agent_verification` is the schema home for Vincent's principle:

> Data belongs to Vincent; AI Agents are replaceable executors.

It requires:

| Field | Required meaning |
|---|---|
| `entry_chain` | The startup files any Agent should read from `$COLLAB`. |
| `work_anchor_required` | Must be `true`. Execution starts only after finding a task anchor. |
| `required_checks` | Commands or checks another Agent can rerun. |
| `handoff_evidence` | Required handoff facts: task id, done condition, changed files, verification output, commit hash, task summary, next task. |

This is the validation layer that catches chat-only progress.

## Anatomy Sections

### DNA / Persona

Defines the stable identity:

- formal name: MorroWise;
- Jarvis / `system-ops` as historical references only;
- boundary: MorroWise is the growth layer over MC/control-plane, not a separate product UI;
- non-goals: no autonomous external writes before approval policy, no Heptabase/Canvas source-of-truth drift.

### Memory / Context

Turns scattered context into data:

- `context`: source-linked summaries from specs, tasks, events, audits;
- `evidence_tags`: tags such as `docs-drift`, `task-completion`, `external-sync`, `portable-agent`;
- `commit_boundaries`: task-to-diff-to-verification-to-commit state;
- `dirty_work`: uncommitted work classified as active-task scope, unrelated dirty tree, or needs triage.

### Senses / Events

Represents what MorroWise can notice:

- trigger rules from `morrowise-growth-gate-spec`;
- task events from `task-events`;
- visual sync gaps across Heptabase, Canvas, dashboard, and generated data;
- freshness state with degraded mode when data may be stale.

### Muscles / Agents / Tools

Represents what MorroWise can do or ask an Agent to do:

- agents as replaceable executors;
- tools and scripts as capabilities;
- action candidates classified before approval policy runs.

### Immune / Validators / Security

Represents protection mechanisms:

- `validate-tasks.mjs`;
- skill validator;
- ADR backlink check;
- approval policy classes;
- security boundaries such as secrets, external writes, deletes, history rewrites.

### Heartbeat / Schedules

Represents review and stale detection:

- weekly review growth gate;
- stale/blocked task gate;
- schedule source status;
- review cadence and cooldowns.

### Feedback / Task Events

Represents the growth loop:

- growth gates;
- task events;
- recommendation candidates;
- approval waiting records.

### Open Loops

Every unresolved issue must have:

| Field | Meaning |
|---|---|
| `loop_id` | Stable id. |
| `gate_id` | Which growth gate produced it. |
| `source` | File/task/event/commit/route/user request/generated data. |
| `condition` | Why the loop is still open. |
| `risk_level` | `low`, `medium`, or `high`. |
| `suggested_next_action` | What an Agent should do next. |
| `requires_approval` | Whether Vincent must approve before action. |
| `owner` | Vincent, Codex, Claude Code, future Agent, or external system. |
| `review_after` | When to look again. |
| `evidence_refs` | Concrete source references. |

## Minimum v0 Example

The future generator should produce data shaped like this:

```json
{
  "schema_version": "morrowise-system.v0",
  "generated_at": "2026-06-20T23:30:00+08:00",
  "source_of_truth": {
    "collab_root": "$COLLAB",
    "canonical_task_state": [
      "$COLLAB/harness-mc/milestones/harness-mc/tasks.json"
    ],
    "generated_data": [
      "$COLLAB/harness-mc/public/data/projects.json",
      "$COLLAB/harness-mc/public/data/task-events.json",
      "$COLLAB/harness-mc/public/data/worktrees.json"
    ],
    "visual_layers": [
      { "name": "Heptabase", "role": "mirror", "may_close_task": false },
      { "name": "Obsidian Canvas", "role": "mirror", "may_close_task": false },
      { "name": "MC dashboard", "role": "dashboard", "may_close_task": false }
    ],
    "docs_are": "routing_and_decision_evidence"
  },
  "portable_agent_verification": {
    "principle": "Data belongs to Vincent; AI agents are replaceable executors.",
    "entry_chain": [
      "$COLLAB/AGENTS.md",
      "$COLLAB/notyet-harness/000_Agent/CORE.md",
      "$COLLAB/notyet-harness/000_Agent/ARCHITECTURE.md",
      "$COLLAB/harness-mc/milestones/harness-mc/tasks.json"
    ],
    "work_anchor_required": true,
    "required_checks": [
      {
        "check_id": "task-schema",
        "command": "npm run test:tasks",
        "scope": "harness-mc",
        "expected": "changed control-plane / MorroWise task schema has no errors"
      },
      {
        "check_id": "build",
        "command": "npm run build",
        "scope": "harness-mc",
        "expected": "generated data and Next build pass"
      }
    ],
    "handoff_evidence": [
      "task_id",
      "done_condition",
      "changed_files",
      "verification_output",
      "commit_hash",
      "task_summary",
      "next_task"
    ]
  },
  "dna": {
    "system_name": "MorroWise",
    "identity": "Growth layer over MC and the agent control plane.",
    "boundaries": ["tasks.json remains canonical", "visual layers are mirrors"],
    "non_goals": ["external writes without approval policy"]
  },
  "memory": {
    "context": [],
    "evidence_tags": [],
    "commit_boundaries": [],
    "dirty_work": []
  },
  "senses": {
    "triggers": [],
    "events": [],
    "visual_sync_gaps": [],
    "freshness": {
      "generated_at": "2026-06-20T23:30:00+08:00",
      "degraded": false,
      "reason": "generated from current MC source"
    }
  },
  "muscles": {
    "agents": [],
    "tools": [],
    "actions": []
  },
  "immune": {
    "validators": [],
    "security_boundaries": [],
    "approval_policy": []
  },
  "heartbeat": {
    "schedules": [],
    "review_cadence": [],
    "stale_rules": []
  },
  "feedback": {
    "gates": [],
    "task_events": [],
    "recommendation_candidates": [],
    "approval_waiting": []
  },
  "open_loops": []
}
```

## Generator Rules For Future MC-LIVE Work

When implementing `public/data/morrowise-system.json`:

1. Read `tasks.json` and generated MC data first.
2. Read docs only as routing/decision evidence.
3. Never close a task from Heptabase or Canvas alone.
4. Include `generated_at` and degraded freshness state.
5. Include portable agent verification checks so a different Agent can rerun the workflow.
6. Represent unknowns as `open_loops`, not as hidden assumptions.

## Next Work Entry

After `acp-control-plane-read-model-v0` exists, implement the generator that writes:

`$COLLAB/harness-mc/public/data/morrowise-system.json`

Then `morrowise-dashboard-surface` can use that read model instead of static markdown.


# MorroWise Live Dashboard Read Model Contract

> Task: `morrowise-live-dashboard-read-model-contract` (`MC-LIVE-SYS-04`)
> Status: contract
> Updated: 2026-06-21
> Target read model: `$COLLAB/harness-mc/public/data/morrowise-live-dashboard.json`
> Upstream: `MC-LIVE-SYS-01`, `MC-LIVE-SYS-02`, `MC-LIVE-SYS-03`
> Routing map: `morrowise-live-dashboard-routing.md`

## Purpose

`morrowise-live-dashboard.json` is the single read entry for the MorroWise live dashboard.

It does not replace `tasks.json`, task events, worktree status, approval policy, or any other canonical source. It gives the dashboard one auditable envelope so every visible surface can answer:

```text
source_of_truth -> source_files -> generator -> generated_at -> stale_rule -> freshness_state -> next_action -> write_boundary -> worktree_commit_gate -> verifier_ref
```

This contract turns the `MC-LIVE-SYS-03` mockup into data requirements. `MC-LIVE-SYS-05` owns the generator and real data flow; `MC-LIVE-SYS-06` owns stale/degraded generation; `MC-LIVE-SYS-07` owns the verifier; `MC-LIVE-SYS-08` owns the production homepage UI.

The dashboard completion sequence must put `worktree-commit` before final verification result:

```text
implementation evidence
  -> local checks
  -> worktree-commit plan / gate evidence
  -> verification result
  -> completed handoff
```

This does not mean every local check waits for commit. It means the final dashboard verdict cannot present a task as fully closed unless the commit gate state is known: `not_required`, `required_pending`, `plan_ready`, `confirmed_committed`, or `blocked`.

## Source Boundary

The read model is read-only.

Allowed:

- summarize generated state;
- expose freshness, evidence, next actions, and drill-down routes;
- point to task ids, files, verifiers, and approval requests;
- mark a surface `fresh`, `stale`, `degraded`, `manual`, or `unknown`.

Forbidden:

- close or mutate tasks;
- write Heptabase, Notion, Obsidian Canvas, Telegram, or other external systems;
- commit, push, deploy, or rewrite git history;
- make dashboard data the canonical task state;
- treat chat, browser screenshots, Heptabase cards, or Canvas nodes as the only evidence.

## Required Top-Level Shape

```json
{
  "schema_version": "morrowise-live-dashboard.v0",
  "generated_at": "2026-06-21T00:00:00+08:00",
  "read_only": true,
  "source_of_truth": {
    "collab_root": "$COLLAB",
    "canonical_task_state": ["$COLLAB/harness-mc/milestones/*/tasks.json"],
    "generated_data": ["$COLLAB/harness-mc/public/data/*.json"],
    "visual_layers_are": "mirrors_only"
  },
  "summary": {
    "overall_freshness_state": "unknown",
    "highest_attention_level": "normal",
    "primary_next_action": null,
    "approval_wait_count": 0,
    "stale_surface_count": 0,
    "degraded_surface_count": 0
  },
  "surfaces": [],
  "routes": [],
  "approval_queue": [],
  "completion_gate": {
    "worktree_commit": {
      "state": "required_pending",
      "skill_ref": "$COLLAB/notyet-harness/000_Agent/skills/worktree-commit/SKILL.md",
      "required_before_verification_result": true,
      "required_evidence": [
        "repo",
        "task_id",
        "dirty_tree_scan",
        "grouped_scope",
        "full_diff_review",
        "4c_review",
        "local_check_output",
        "path_policy_check",
        "commit_message",
        "vincent_confirmation",
        "commit_hash_or_blocker"
      ]
    }
  },
  "verification": {
    "standard_ref": "$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-live-system-verification-standard.md",
    "audit_ref": "$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-live-surface-audit.md",
    "verifier_ref": "MC-LIVE-SYS-07",
    "last_verified_at": null
  }
}
```

## Top-Level Fields

| Field | Required meaning |
|---|---|
| `schema_version` | Fixed version string: `morrowise-live-dashboard.v0`. |
| `generated_at` | Timestamp when this read model was generated. |
| `read_only` | Must be `true`. The dashboard cannot write canonical state from this file. |
| `source_of_truth` | Canonical source rules for all surfaces. |
| `summary` | Homepage-level rollup only: freshness, attention, approval wait, and primary next action. |
| `surfaces` | Full list of auditable dashboard surfaces. |
| `routes` | Drill-down route contracts for details that should not crowd the homepage. |
| `approval_queue` | Read-only approval requests waiting for Vincent or an allowed gate. |
| `completion_gate` | Required pre-verification closure gates, including `worktree-commit` state and evidence. |
| `verification` | Standard, audit, and future verifier references. |

## Surface Contract

Every item in `surfaces` must include at least these fields:

| Field | Required meaning |
|---|---|
| `id` | Stable surface id. It must not depend on UI copy. |
| `label` | Human-readable label matching the visible surface. |
| `source_of_truth` | Canonical state owner or generated read model class. |
| `source_files` | Durable files or glob patterns another Agent can inspect. |
| `generator` | Script, build step, or manual owner that produces the displayed state. |
| `generated_at` | Timestamp of the surface data, or `null` when not generated yet. |
| `stale_rule` | Rule used to degrade the surface. |
| `freshness_state` | One of `fresh`, `stale`, `degraded`, `manual`, or `unknown`. |
| `next_action` | Concrete next task, route, approval, verifier, or owner action. |
| `write_boundary` | Explicit read/write authority for the surface. |
| `verifier_ref` | Command, verifier task, checklist, or pending verifier reference. |

Recommended fields:

| Field | Meaning |
|---|---|
| `classification` | One of `live`, `semi_live`, `static_display`, or `fake_live_risk` from `MC-LIVE-SYS-01`. |
| `attention_level` | `normal`, `watch`, `needs_review`, or `blocked`. |
| `evidence_refs` | Task ids, file paths, generated data paths, event ids, or commit hashes. |
| `drilldown_route` | Route id in `routes` for full detail. |
| `open_loops` | Explicit unresolved gaps with owner and follow-up task. |

## Completion Gate Contract

`completion_gate.worktree_commit` must appear before `verification` in the read model and in dashboard presentation.

It answers: "Can this task be considered closed, or is the work still local/uncommitted?"

Required fields:

| Field | Meaning |
|---|---|
| `state` | One of `not_required`, `required_pending`, `plan_ready`, `confirmed_committed`, or `blocked`. |
| `skill_ref` | `$COLLAB/notyet-harness/000_Agent/skills/worktree-commit/SKILL.md`. |
| `required_before_verification_result` | Must be `true` for task-completion and commit-boundary surfaces. |
| `required_evidence` | Evidence bundle required by the `worktree-commit` skill. |
| `repo` | Repo being considered for commit. |
| `task_id` | Active MC task id or `auto-task` candidate. |
| `grouped_scope` | Commit grouping after dirty-tree and diff review. |
| `local_checks` | Local checks already run before the commit gate. |
| `path_policy_check` | Result of hard-coded local path scan. |
| `four_c_review` | Context, Change, Cause, Check review from `worktree-commit`. |
| `vincent_confirmation_state` | `not_requested`, `waiting`, `confirmed`, or `rejected`. |
| `commit_hash` | Short hash when the gate has produced a commit; otherwise `null`. |
| `blocker` | Reason the gate cannot proceed, if state is `blocked`. |

The dashboard may show a local verifier result before commit, but the final task closure verdict must distinguish:

| Gate state | Dashboard wording |
|---|---|
| `not_required` | No commit boundary is needed for this surface. |
| `required_pending` | Work exists but commit gate has not been prepared. |
| `plan_ready` | `worktree-commit` plan exists and is waiting for Vincent confirmation. |
| `confirmed_committed` | Commit gate completed and hash is recorded or ready for task-state follow-up. |
| `blocked` | Commit gate cannot proceed; verification result must be degraded or kept open. |

## Enumerations

### `freshness_state`

| Value | Meaning |
|---|---|
| `fresh` | Data was generated inside the surface's stale rule and can be trusted for display. |
| `stale` | Data exists but is older than the stale rule allows. |
| `degraded` | Required upstream data or verifier is missing; show limited state and route to repair. |
| `manual` | Freshness depends on a human/manual mirror until a generator exists. |
| `unknown` | Contract exists but the generator has not yet produced enough metadata. |

### `classification`

Use the `MC-LIVE-SYS-01` definitions:

| Value | Meaning |
|---|---|
| `live` | Full source, generator, freshness, next action, write boundary, verifier, and evidence pass. |
| `semi_live` | Current data exists but at least one loop field remains incomplete. |
| `static_display` | Useful mockup or documentation view without current generated state. |
| `fake_live_risk` | Looks operational while hiding stale data, missing source, unsafe write authority, or unverifiable state. |

## Required Initial Surfaces

The first generator must emit these six surfaces from `MC-LIVE-SYS-02`.

```json
[
  {
    "id": "system_attention",
    "label": "System Attention",
    "source_of_truth": "generated_attention_state",
    "source_files": [
      "$COLLAB/harness-mc/public/data/changes.json",
      "$COLLAB/harness-mc/public/data/task-events.json"
    ],
    "generator": [
      "scripts/sentinel-diff.mjs",
      "scripts/generate-task-event-data.mjs",
      "npm run build"
    ],
    "generated_at": null,
    "stale_rule": "stale when generated attention data is older than 15 minutes during an active session, or after task-event/worktree regeneration changes upstream state",
    "freshness_state": "unknown",
    "classification": "semi_live",
    "next_action": {
      "type": "route_or_task",
      "target": "surface.system_attention.drilldown",
      "label": "Review stale, blocked, or queue items before claiming live dashboard health."
    },
    "write_boundary": {
      "mode": "read_only",
      "allowed": ["display generated attention state", "link to evidence"],
      "forbidden": ["close tasks", "reduce event queues", "write mirrors"]
    },
    "verifier_ref": "MC-LIVE-SYS-07"
  },
  {
    "id": "morrowise_living_system",
    "label": "MorroWise 活系統",
    "source_of_truth": "canonical_tasks_and_generated_project_state",
    "source_files": [
      "$COLLAB/harness-mc/milestones/harness-mc/tasks.json",
      "$COLLAB/harness-mc/public/data/projects.json",
      "$COLLAB/harness-mc/public/data/task-events.json",
      "$COLLAB/harness-mc/public/data/changes.json"
    ],
    "generator": [
      "scripts/generate-data.mjs",
      "scripts/generate-task-event-data.mjs",
      "scripts/sentinel-diff.mjs",
      "npm run build"
    ],
    "generated_at": null,
    "stale_rule": "stale when generated project, event, or attention data is older than the newest canonical task/event/worktree input used by the dashboard",
    "freshness_state": "unknown",
    "classification": "semi_live",
    "next_action": {
      "type": "task",
      "target": "morrowise-live-dashboard-real-data-flow",
      "label": "Connect the contract to real generated dashboard data."
    },
    "write_boundary": {
      "mode": "read_only",
      "allowed": ["summarize MorroWise task chain", "show next executable task", "link to source files"],
      "forbidden": ["change task status", "mark MorroWise autonomous", "write visual mirrors"]
    },
    "verifier_ref": "MC-LIVE-SYS-07"
  },
  {
    "id": "morrowise_proactive_loop",
    "label": "MorroWise 主動閉環",
    "source_of_truth": "generated_proactive_loop_state_and_policy_registry",
    "source_files": [
      "$COLLAB/harness-mc/public/data/morrowise-proactive-loop.json",
      "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json",
      "$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-approval-policy.md"
    ],
    "generator": [
      "scripts/generate-morrowise-proactive-loop.mjs",
      "scripts/morrowise-action-runner.mjs",
      "npm run build"
    ],
    "generated_at": null,
    "stale_rule": "stale when proactive-loop data predates approval policy, runner, or task-event input changes",
    "freshness_state": "unknown",
    "classification": "semi_live",
    "next_action": {
      "type": "route_or_verifier",
      "target": "npm run test:morrowise-loop",
      "label": "Verify proactive-loop state before presenting it as operational."
    },
    "write_boundary": {
      "mode": "read_only_with_approval_policy",
      "allowed": ["display recommendations", "display approval-required actions", "display runner dry-run output"],
      "forbidden": ["execute approval-required actions", "commit", "push", "deploy", "external sync without approval"]
    },
    "verifier_ref": "npm run test:morrowise-loop"
  },
  {
    "id": "task_event_pipeline",
    "label": "Task Event Pipeline",
    "source_of_truth": "task_event_outbox_and_generated_event_read_model",
    "source_files": [
      "$COLLAB/harness-mc/task-events/**/*.json",
      "$COLLAB/harness-mc/sync-events/**/*.json",
      "$COLLAB/harness-mc/public/data/task-events.json",
      "$COLLAB/harness-mc/task-events/latest-report.json"
    ],
    "generator": [
      "scripts/generate-task-event-data.mjs",
      "scripts/apply-task-events.mjs",
      "npm run build"
    ],
    "generated_at": null,
    "stale_rule": "stale when pending or rejected queues change without a regenerated task-events read model, or when queue age exceeds the dashboard threshold",
    "freshness_state": "unknown",
    "classification": "semi_live",
    "next_action": {
      "type": "route_or_command",
      "target": "task-event-pipeline.drilldown",
      "label": "Inspect pending, rejected, and sync queues before applying or syncing events."
    },
    "write_boundary": {
      "mode": "read_only_summary",
      "allowed": ["display queue counts", "link to reducer reports", "prepare review action"],
      "forbidden": ["apply events", "sync external mirrors", "overwrite task files without explicit reducer approval"]
    },
    "verifier_ref": "npm run test:task-event-dashboard"
  },
  {
    "id": "worktree_status",
    "label": "Worktree Status",
    "source_of_truth": "local_git_status_read_model",
    "source_files": [
      "$COLLAB/harness-mc/public/data/worktrees.json",
      "$COLLAB/*/.git"
    ],
    "generator": [
      "scripts/generate-worktree-status.mjs",
      "npm run build"
    ],
    "generated_at": null,
    "stale_rule": "stale after any file edit, commit, checkout, branch switch, pull, push, or agent handoff",
    "freshness_state": "unknown",
    "classification": "semi_live",
    "next_action": {
      "type": "command_or_policy",
      "target": "worktree-commit",
      "label": "Use the commit gate before committing, pushing, or marking work closed."
    },
    "write_boundary": {
      "mode": "read_only_commit_gate",
      "allowed": ["display dirty files", "display local commits", "suggest commit grouping"],
      "forbidden": ["commit", "push", "rebase", "reset", "delete files", "rewrite history"]
    },
    "verifier_ref": "npm run test:worktree-status"
  },
  {
    "id": "approval_queue",
    "label": "Approval Queue",
    "source_of_truth": "approval_policy_and_generated_approval_requests",
    "source_files": [
      "$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json",
      "$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-approval-policy.md",
      "$COLLAB/harness-mc/public/data/morrowise-proactive-loop.json"
    ],
    "generator": [
      "scripts/generate-morrowise-proactive-loop.mjs",
      "scripts/morrowise-action-runner.mjs",
      "npm run build"
    ],
    "generated_at": null,
    "stale_rule": "stale when approval policy, pending request payload, runner output, or task-event queue changes without regeneration",
    "freshness_state": "unknown",
    "classification": "semi_live",
    "next_action": {
      "type": "approval",
      "target": "approval_queue.drilldown",
      "label": "Show exact requested action, destination, owner, age, payload preview, and closure condition before approval."
    },
    "write_boundary": {
      "mode": "approval_required",
      "allowed": ["display pending approvals", "display policy reason", "prepare an approval request"],
      "forbidden": ["approve on Vincent's behalf", "execute external writes", "commit or push without commit gate approval"]
    },
    "verifier_ref": "npm run test:morrowise-approval"
  }
]
```

## Drill-Down Route Contract

The homepage must stay compact. Details belong to `routes`.

Each `routes[]` item should include:

| Field | Meaning |
|---|---|
| `id` | Stable route id, usually matching a surface drill-down target. |
| `label` | Visible route label. |
| `surface_ids` | Surfaces covered by the route. |
| `route` | Future app route or static mockup path. |
| `required_fields` | Detail fields the route must expose. |
| `write_boundary` | Same or stricter than the related surface. |

Minimum initial routes:

| Route id | Covered surfaces | Purpose |
|---|---|---|
| `surface.system_attention.drilldown` | `system_attention` | Full stale/blocked/queue evidence with task/event refs. |
| `morrowise_living_system.drilldown` | `morrowise_living_system`, `morrowise_proactive_loop` | MorroWise state chain, open loops, trigger/recommendation/approval/action feedback. |
| `task_event_pipeline.drilldown` | `task_event_pipeline` | Pending/applied/rejected/sync queues, reducer reports, event age. |
| `worktree_status.drilldown` | `worktree_status` | Dirty files, local commits, remote divergence, commit gate status. |
| `approval_queue.drilldown` | `approval_queue` | Requested action, destination, owner, age, payload preview, closure condition. |

## Approval Queue Item Contract

Each `approval_queue[]` item must include:

| Field | Meaning |
|---|---|
| `id` | Stable approval request id. |
| `source_surface_id` | Surface that raised the request. |
| `action_class` | Approval policy class such as `worktree_commit_gate`, `external_sync`, or `task_state_mutation`. |
| `requested_action` | Exact action requested. |
| `destination` | File, system, route, or external target. |
| `owner` | Person or system that can approve. |
| `created_at` | Request creation timestamp. |
| `age_label` | Human-readable age for dashboard display. |
| `payload_preview` | Safe summary of the payload; no secrets. |
| `policy_ref` | Policy file or registry rule id. |
| `closure_condition` | What makes this request resolved. |
| `write_boundary` | Must say approval is required before execution. |

## Acceptance Criteria

This contract satisfies `MC-LIVE-SYS-04` when:

1. It defines `public/data/morrowise-live-dashboard.json`.
2. It requires every surface to include `id`, `label`, `source_of_truth`, `source_files`, `generator`, `generated_at`, `stale_rule`, `freshness_state`, `next_action`, `write_boundary`, and `verifier_ref`.
3. It maps the six audited surfaces from `MC-LIVE-SYS-02`.
4. It keeps the read model read-only and states that it cannot write task state.
5. It puts `completion_gate.worktree_commit` before `verification` so the final verification result cannot hide uncommitted work.
6. It clearly routes generator, stale/degraded, verifier, and UI implementation to `MC-LIVE-SYS-05` through `MC-LIVE-SYS-08`.

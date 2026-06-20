# MorroWise Recommendation Engine v0

> Task: `morrowise-recommendation-engine-v0` (`MC-LIVE-17`)
> Status: formal registry
> Updated: 2026-06-20
> Machine-readable registry: `$COLLAB/harness-mc/system-workflow/registries/morrowise-recommendation-engine.json`
> Upstream: `morrowise-trigger-rules-registry`, `morrowise-anatomy-read-model`, `acp-control-plane-read-model-v0`

## Purpose

MorroWise should not only notice a system signal. It should propose why a next step is worth considering.

This task defines the v0 recommendation engine contract. It consumes trigger outputs and read-model evidence, then emits next-best-action candidates. A candidate is not an action. It is an evidence-backed proposal that can later enter approval policy, runner, dashboard, or open-loop tracking.

## Boundary

The recommendation engine may:

- read trigger events, generated read models, task state, specs, and verifier output;
- produce ranked recommendation candidates;
- explain reason, evidence, risk, approval need, and suggested task id;
- attach HC thinking references and confidence.

The recommendation engine may not:

- mutate `tasks.json`;
- commit, push, sync, delete, rewrite history, or edit external systems;
- close tasks from HC reasoning alone;
- bypass Vincent approval when approval policy is required.

## Candidate Contract

Every candidate must include:

| Field | Meaning |
|---|---|
| `recommendation_id` | Stable id for the candidate. |
| `trigger_id` | Trigger rule that produced or justified the candidate. |
| `reason` | Plain-language reason this is the next best action candidate. |
| `suggested_action` | Action class, such as `commit_now`, `split_commit`, `create_open_loop`, or `request_external_write_approval`. |
| `suggested_task_id` | Existing or proposed task anchor. Work should not start without a task anchor. |
| `evidence_refs` | Pointers to `tasks.json`, generated data, trigger registry, specs, or verifier output. |
| `risk_level` | `low`, `medium`, or `high`. |
| `requires_approval` | Boolean approval gate. |
| `hc_refs` | HC methods used as thinking checks. |
| `hc_reasoning` | Short explanation of how HC affected the recommendation. |
| `hc_confidence` | Number from 0 to 1. |

Evidence refs are mandatory. HC refs are thinking aids, not evidence substitutes.

## HC Router Decision

HC should be connected as a method selector, not as a source of truth.

The HC source is:

`$COLLAB/notyet-harness/300_Obsidian_brain/HC`

The routing entry is:

`$COLLAB/notyet-harness/300_Obsidian_brain/HC/_index/hc-registry.md`

Default HC checks:

| HC | Use |
|---|---|
| `#rightProblem` | Ensure the candidate solves the actual loop, not a symptom. |
| `#breakItDown` | Reduce broad recommendations to one executable next action plus follow-ups. |
| `#risk` | Classify uncertainty, side effects, approval needs, and rollback cost. |
| `#utility` | Rank expected value and opportunity cost. |
| `#confirmationBias` | Ask what contrary evidence would make the recommendation wrong. |
| `#systemDynamics` | Prefer closing feedback loops over one-off patches. |

This is a deliberate partial connection. MorroWise should not load all 116 HC files for every candidate. It should route to a small set based on trigger family and action risk.

## Recommendation Types

The v0 registry allows:

| Type | When allowed | Approval |
|---|---|---|
| `commit_now` | Verified completed work has a clean task boundary. | Usually no, but still follows commit gate. |
| `split_commit` | Dirty tree mixes multiple capabilities or task scopes. | Usually no. |
| `wait_for_approval` | Next step would mutate canonical state, external systems, deletion, secrets, schedules, or history. | Yes. |
| `create_task_event` | Another repo needs portable task-state evidence. | Usually no. |
| `refresh_visual_layer` | Canonical task state is current but visual mirrors are stale. | Usually no for generated local data; yes before external writes. |
| `dry_run_external_sync` | Sync can be checked without writing outside `$COLLAB`. | No. |
| `request_external_write_approval` | Heptabase, Notion, Telegram, LaunchAgent, or other external write is needed. | Yes. |
| `create_open_loop` | Evidence or owner is missing. | No. |

## Risk And Approval Rule

High-risk candidates always require approval.

Medium-risk candidates require approval when they mutate:

- canonical task state;
- version history;
- external systems;
- user-facing visual layers.

Low-risk candidates may proceed only when they stay inside evidence gathering, dry-run verification, or explicit open-loop recording.

## Sample Candidate Shape

```json
{
  "recommendation_id": "rec.sync-failed.visual-layer.001",
  "trigger_id": "morrowise.sync_failed",
  "reason": "Sync failure is a high-risk external boundary; dry-run parity should be checked before any write.",
  "suggested_action": "dry_run_external_sync",
  "suggested_task_id": "acp-visual-sync-coverage-report",
  "evidence_refs": [
    {
      "type": "generated_data",
      "ref": "$COLLAB/harness-mc/public/data/task-events.json"
    }
  ],
  "risk_level": "medium",
  "requires_approval": false,
  "hc_refs": ["#risk", "#confirmationBias"],
  "hc_reasoning": "Check whether the failure is reproducible before assuming the external system is stale.",
  "hc_confidence": 0.78
}
```

## Verification

Run:

```bash
npm run test:morrowise-recommendations
```

The verifier checks:

- the registry has the expected id and task id;
- the engine cannot execute actions, close tasks, or write external systems;
- candidate contract includes `reason`, `evidence_refs`, `risk_level`, `requires_approval`, `suggested_task_id`, `hc_refs`, `hc_reasoning`, and `hc_confidence`;
- high-risk sample candidates require approval;
- every sample has evidence refs and valid HC refs;
- the schema's `recommendationCandidate` definition matches the registry contract.

## Next Work

`morrowise-approval-policy` should consume these candidates and decide which actions require Vincent approval before runner or external sync work can proceed.

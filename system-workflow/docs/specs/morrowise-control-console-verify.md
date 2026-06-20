# MorroWise Control Console Verification

> Task: `morrowise-control-console-verify` (`MC-LIVE-VERIFY-1`)
> Status: verified
> Updated: 2026-06-20
> Scope: First MorroWise control-console loop, not proactive automation.

## Verdict

PASS with explicit boundary.

MC can now answer the first control-console questions:

1. source-of-truth;
2. current task map;
3. growth trigger conditions;
4. state pipeline;
5. read model contract;
6. dashboard surface;
7. visible feedback / open loops.

MC must not claim MorroWise is proactive or autonomous yet. The proactive loop starts after trigger registry, recommendation engine, approval policy, runner, and proactive dashboard tasks are completed.

## Source-Of-Truth Answer

Current canonical state:

| Question | Answer | Evidence |
|---|---|---|
| Where is current task state? | `$COLLAB/harness-mc/milestones/harness-mc/tasks.json` and other `milestones/*/tasks.json` files. | `morrowise-source-inventory.md`, `morrowise-anatomy-read-model.md`, `CORE.md`. |
| Are Heptabase and Canvas canonical? | No. They are mirrors / visual layers. They cannot close tasks alone. | `morrowise-growth-gate-spec.md`, `morrowise-anatomy-read-model.md`. |
| Can markdown override current task status? | No. Markdown is routing and decision evidence. | `morrowise-anatomy-read-model.md`. |
| Does data belong to a specific AI Agent? | No. Data belongs to Vincent. Agents are replaceable executors. | `morrowise-anatomy-read-model.md` `portable_agent_verification`. |

Verification result:

PASS. The source-of-truth rule is represented in shared rules, specs, and the schema.

## Current Task Map Answer

The current MorroWise control-console chain is:

| Order | Task | Status | Role |
|---|---|---|---|
| MC-LIVE-01 | `morrowise-source-inventory` | completed | Source inventory and source hierarchy. |
| MC-LIVE-02 | `morrowise-system-index` | completed | Durable MorroWise capability index. |
| MC-LIVE-03 | `morrowise-mc-task-map` | completed | Legacy `system-ops` t1-t30 mapped into current MC tasks. |
| MC-LIVE-04 | `morrowise-growth-gate-spec` | completed | Trigger to source to process to output to surface rules. |
| MC-LIVE-05 | `acp-task-schema-validator` | completed | Task schema gate for portable Agent writes. |
| MC-LIVE-13 | `morrowise-anatomy-read-model` | completed | `morrowise-system.json` v0 schema and portable verification contract. |
| MC-LIVE-14 | `morrowise-dashboard-surface` | completed | Homepage MorroWise surface. |
| MC-LIVE-VERIFY-1 | `morrowise-control-console-verify` | this report | First control-console verification. |

Verification result:

PASS. The task map is visible from `tasks.json`; old `system-ops` work is mapped rather than duplicated.

## Growth Trigger Conditions Answer

Defined trigger families:

| Trigger family | Where defined | Surface status |
|---|---|---|
| User phrase: MorroWise / 活系統 / system-ops | `morrowise-growth-gate-spec.md` | Homepage MorroWise surface shows user-phrase route. |
| Weekly review | `morrowise-growth-gate-spec.md` | Homepage MorroWise surface reads sentinel brief. |
| Stale / blocked task | `morrowise-growth-gate-spec.md` | Homepage MorroWise surface shows blocked/open task counts. |
| New project growth gate | `morrowise-growth-gate-spec.md` | Homepage MorroWise surface shows schema-guarded project/task anchor rule. |
| Task completion / commit boundary | `morrowise-growth-gate-spec.md` | Covered by worktree / task-state flows. |
| External sync / docs drift / approval wait | `morrowise-growth-gate-spec.md` | Covered as high-risk gates; not autonomous yet. |

Verification result:

PASS for first control-console visibility. The formal trigger registry is still future work (`morrowise-trigger-rules-registry`).

## State Pipeline Answer

Current pipeline:

```text
tasks.json / task-events / worktrees
  -> generate-data.mjs
  -> generate-task-event-data.mjs
  -> generate-worktree-status.mjs
  -> sentinel-diff.mjs
  -> public/data/*.json
  -> MC homepage surfaces
```

Visible surfaces:

| Surface | Data source |
|---|---|
| System Attention | `changes.json`, `task-events.json` |
| MorroWise 活系統 | `projects.json`, `task-events.json`, `changes.json` |
| Worktree Status | `worktrees.json` |
| Task 視覺同步 | `projects.json` |
| Projects page | `projects.json` |

Verification result:

PASS. MC uses generated data rather than static markdown for live status.

## Read Model Answer

Current read model contract:

| Read model | Status |
|---|---|
| `projects.json` | implemented |
| `task-events.json` | implemented |
| `worktrees.json` | implemented |
| `changes.json` | implemented |
| `morrowise-system.json` | schema defined; generator not yet implemented |

`morrowise-system.json` v0 schema exists at:

`$COLLAB/harness-mc/system-workflow/schemas/morrowise-system.schema.json`

Its verifier is:

`npm run test:morrowise-schema`

Verification result:

PASS with boundary. Schema exists and is verified; generator remains future work.

## Dashboard Surface Answer

Homepage now contains:

| UI block | Required answer |
|---|---|
| `MorroWise 活系統` | Living-system state, trigger sources, next executable task, feedback / open loops, canonical source pointer. |
| `System Attention` | Freshness, stale/blocked counts, queue pending, top attention items. |
| `Task Event Pipeline` | Pending/rejected/sync state. |
| `Worktree Status` | Uncommitted / local commits / reconcile pressure. |
| `Task 視覺同步` | Heptabase / Canvas gaps from MC source. |

Verification result:

PASS. MorroWise status is visible on the homepage and is not only inside project detail.

## Feedback / Open Loops Answer

Current visible open-loop signals:

| Signal | Current representation |
|---|---|
| Open MorroWise tasks | Homepage MorroWise surface lists next/open tasks from `projects.json`. |
| Pending task/sync events | Homepage MorroWise surface and Task Event Pipeline read `task-events.json`. |
| Stale/blocked attention | System Attention and MorroWise surface read `changes.json`. |
| Dirty work / commit pressure | Worktree Status reads `worktrees.json`. |
| Visual sync gaps | Task visual sync surface derives from `projects.json` refs. |

Verification result:

PASS for control-console visibility. Formal `open_loops` data generation remains future work in the `morrowise-system.json` generator.

## Boundary: Not Proactive Yet

MorroWise is not yet proactive automation.

The following are still todo:

| Task | Why boundary remains |
|---|---|
| `morrowise-trigger-rules-registry` | Formal registry with source, condition, cooldown, output event is not yet complete. |
| `morrowise-recommendation-engine-v0` | Next-best-action candidates are not generated yet. |
| `morrowise-approval-policy` | Auto / approval-required / forbidden policy is not complete. |
| `morrowise-autonomous-action-runner-v0` | Low-risk runner does not exist yet. |
| `morrowise-proactive-loop-dashboard` | Trigger to recommendation to approval to action to feedback UI does not exist yet. |
| `morrowise-proactive-loop-verify` | Proactive loop has not been verified. |

Verification result:

PASS. The control-console loop is observable; proactive automation is explicitly not claimed.

## Verification Commands

Run from `$COLLAB/harness-mc`:

```bash
npm run test:morrowise-schema
npm run test:tasks
npm run build
curl --max-time 10 -s -o /tmp/hmc-home.html -w "%{http_code} %{size_download}\n" http://localhost:3001/
```

Expected:

- MorroWise system schema verification passes.
- Task validator passes for changed `harness-mc` tasks; legacy warnings are allowed.
- Build regenerates MC data and compiles routes.
- Homepage returns `200`.

## Final Decision

`morrowise-control-console-verify` can be marked completed.

Reason:

MC can answer source-of-truth, current task map, trigger conditions, state pipeline, read model contract, dashboard surface, and feedback/open-loop visibility from durable files and generated data.

Boundary:

Do not mark MorroWise proactive or autonomous. That belongs to MC-LIVE-16 through MC-LIVE-VERIFY-2.


# MorroWise Living System Index

> Task: `morrowise-system-index` (`MC-LIVE-02`)
> Status: active index
> Updated: 2026-06-20
> Source of truth: `$COLLAB/harness-mc/milestones/harness-mc/tasks.json`
> Historical references: Jarvis / `system-ops`

## Purpose

This index turns MorroWise from a strong idea into a navigable system.

MorroWise is not a separate project outside Mission Control. It is the growth layer of the current MC / Agent Control Plane: it watches work, identifies open loops, recommends next actions, respects approval boundaries, and writes feedback back into the task system.

The historical names Jarvis and `system-ops` remain evidence only. The current system name is MorroWise.

## Working Definition

MorroWise is a living system for turning intention into durable execution.

Its operating loop is:

```text
intention
  -> task / decision / source
  -> sensing
  -> interpretation
  -> recommendation
  -> approval boundary
  -> action or queued side effect
  -> feedback write-back
  -> visible next loop
```

It is alive only when feedback returns to the source of truth. A dashboard that only displays stale snapshots is not alive.

## Source Hierarchy

| Level | Source | Role | Rule |
|---|---|---|---|
| S0 | MC milestone files | Current executable state | Decide task status, dependencies, next actions, and completion. |
| S1 | Legacy `system-ops` files | Original capability evidence | Use for capability mapping, not current status. |
| S2 | Obsidian project notes | Human-readable mirror | Read for context, never override MC state. |
| S3 | Daily memory / session logs | Timeline evidence | Useful for why decisions happened; may be stale. |
| S4 | Heptabase / Canvas / screenshots | Visual layers | Help humans see work; never reverse-write task state. |

Primary current source:

`$COLLAB/harness-mc/milestones/harness-mc/tasks.json`

Primary current generated views:

- `$COLLAB/harness-mc/public/data/projects.json`
- `$COLLAB/harness-mc/public/data/changes.json`
- `$COLLAB/harness-mc/public/data/task-events.json`
- `$COLLAB/harness-mc/public/data/worktrees.json`

## Capability Anatomy

### 1. Intention / DNA

Role: define what the system is trying to grow toward.

Current evidence:

- MorroWise formal naming and rename cleanup.
- `morrowise-source-inventory`
- `morrowise-system-audit`
- `control-plane-operating-loop`

Current gap:

- The name and source hierarchy are clear, but the growth rules are not yet executable.

Next task:

- `morrowise-mc-task-map`
- `morrowise-growth-gate-spec`

### 2. Memory / Context

Role: retain context without letting old notes become false current state.

Historical source family:

- Three-layer memory, daily logs, monthly memory, Obsidian project mirrors.
- Old memory tag taxonomy: safety, data, flow, performance, docs, integration, config, dependency, judgment, tools.

Current MC mapping:

- Shared Agent files under `$COLLAB/notyet-harness/000_Agent/`
- Agent Control Plane README and protocols.
- MC generated data as task-state read models.

Outdated assumption:

- Old memory entries can describe decisions, but they cannot decide current task state.

Needed rule:

- Future MorroWise read models should read current task status from MC data, not from markdown tables.

Next task:

- `morrowise-anatomy-read-model`

### 3. Senses / Events

Role: detect changes, stale work, blocked work, dirty work, rejected events, and external sync pressure.

Current MC mapping:

- `sentinel-diff.mjs`
- `changes.json`
- `task-events/pending/*.json`
- `task-events/rejected/*.json`
- `worktrees.json`
- System Attention homepage
- Worktree Status homepage

Historical source family:

- SRE notification classification: Page / Ticket / Log.
- Weekly ops checks.
- Cron redesign and timeout diagnosis.

Needed additions:

- Uncommitted completed work as a trigger.
- Task completed but not committed as a trigger.
- Commit exists but task state missing as a trigger.
- Rejected task event as a trigger.
- External sync failed or pending too long as a trigger.
- Static docs drifting from `tasks.json` as a trigger.

Next task:

- `morrowise-growth-gate-spec`
- `morrowise-trigger-rules-registry`

### 4. Muscles / Tools / Agents

Role: perform low-risk work or prepare actions for approval.

Current MC mapping:

- worktree-commit discipline.
- task-event outbox.
- apply-task-events reducer.
- sync-event queue.
- Obsidian Canvas sync.
- Heptabase task-card adapter.
- Heptabase PAI sync migration line.

Historical source family:

- Connector packaging.
- Persona template.
- Agent routing.
- WARROOM / customer-facing reference implementation.

Current boundary:

- MorroWise should reuse ACP infrastructure. It should not reimplement task events, sync queues, or visual sync.

Next task:

- `morrowise-mc-task-map`
- `heptabase-pai-sync-migration-spec`
- `morrowise-autonomous-action-runner-v0`

### 5. Immune System / Validators / Safety

Role: stop unsafe mutation, stale assumptions, broad writes, and external side effects without approval.

Current MC mapping:

- `acp-task-schema-validator`
- `acp-skill-validator`
- visual-layer transition protocol.
- task-before-work gate.
- visual sync coverage gate.
- commit 4C review.

Historical source family:

- Security scan skill.
- Pre-launch SOP.
- Backup / rollback discipline.
- SRE postmortem idea: fix the environment, not the person.

Needed additions:

- Approval policy for task mutation, commit, push, external writes, deletion, secret access, and history rewrite.
- Validator output in a generated control-plane read model.

Next task:

- `acp-task-schema-validator`
- `morrowise-approval-policy`

### 6. Heartbeat / Schedules

Role: keep the system reviewing itself without relying on a person remembering.

Historical source family:

- Cron redesign.
- Weekly ops check.
- Monthly review with toil trend and 50% rule.

Current MC mapping:

- sentinel session startup checks.
- `sn-7` launchd daily schedule.
- agnostic scheduler project.
- `com.hisenzi.harness-mc` LaunchAgent for the MC dashboard runtime.

Current gap:

- The runtime exists, but MorroWise trigger rules are not yet represented as a registry.

Next task:

- `morrowise-trigger-rules-registry`

### 7. Feedback / Open Loops

Role: ensure every completed action either closes a loop or creates the next visible loop.

Current MC mapping:

- task completion fields: `completed_at`, `commits`, `summary`.
- task-event outbox and reducer.
- sync queue.
- System Attention freshness.
- Worktree status.

Needed open-loop fields:

| Field | Purpose |
|---|---|
| `loop_id` | Stable identity. |
| `source` | Trigger, task, event, audit, or user request. |
| `condition` | Why the loop remains open. |
| `risk_level` | low / medium / high. |
| `suggested_next_action` | Next best action. |
| `requires_approval` | Whether Vincent must approve. |
| `owner` | Vincent / codex / external / system. |
| `review_after` | Prevents silent aging. |
| `evidence_refs` | File paths, task ids, event ids, commits. |

Next task:

- `morrowise-anatomy-read-model`
- `morrowise-recommendation-engine-v0`

## Historical Source Families

| Family | Keep | Migrate To | Caution |
|---|---|---|---|
| SRE / PDCA / Kaizen | Repair loop, toil reduction, Check/Act discipline | Growth gates and verification tasks | Do not turn every repair into extra manual process. |
| Jarvis capability decomposition | Long-term anatomy categories | MorroWise anatomy schema | Jarvis is not the current name. |
| Productization blueprint | Reference Implementation direction | Future product packaging after MC loop works | Do not build product UI before living-system loop exists. |
| Cron redesign | Preprocessor scripts, timeout causes, schedule consolidation | Trigger registry and heartbeat model | Old cron counts are historical. |
| Memory tag taxonomy | Issue/risk categories | Recommendation evidence and immune-system labels | Old OpenClaw memory is not current state. |
| Connector / Persona templates | Future deployability | Tool / agent muscle mapping | Do not bypass approval policy for external writes. |
| Historical `system-ops` tasks | Capability backlog | `morrowise-mc-task-map` | Never import wholesale. |

## Current MC Mapping Targets

| MorroWise capability | Current MC / ACP target | Status |
|---|---|---|
| Task source of truth | `milestones/*/tasks.json` | active |
| Task write discipline | task-before-work gate, `acp-task-write-command-map` | planned |
| Task schema protection | `acp-task-schema-validator` | planned |
| Cross-repo feedback | `acp-task-event-outbox` | completed |
| Event apply loop | `acp-apply-task-events` | completed |
| External sync boundary | `acp-external-sync-queue` | completed |
| Queue visibility | `acp-task-event-dashboard` | completed |
| Visual mirror policy | visual-layer transition protocol, Canvas sync hook | active |
| Freshness surface | `acp-system-attention-freshness-contract` | completed |
| Dirty work sensing | `acp-worktree-status-inventory` | completed |
| Visual sync coverage | `acp-visual-sync-coverage-report` | in progress |
| Control-plane read model | `acp-control-plane-read-model-v0` | planned |
| MorroWise anatomy | `morrowise-anatomy-read-model` | planned |
| MorroWise surface | `morrowise-dashboard-surface` | planned |
| Trigger registry | `morrowise-trigger-rules-registry` | planned |
| Recommendation | `morrowise-recommendation-engine-v0` | planned |
| Approval policy | `morrowise-approval-policy` | planned |
| Low-risk runner | `morrowise-autonomous-action-runner-v0` | planned |

## ACP-SYNC As External Sync Muscle

ACP-SYNC is not the MorroWise core loop, but it is part of MorroWise's external sync muscle.

| Task | MorroWise role |
|---|---|
| `heptabase-pai-sync-migration-spec` | Define external sync boundary and migration plan. |
| `heptabase-cli-pai-shared-lib` | Extract reusable integration muscle. |
| `heptabase-cli-pai-decouple` | Promote CLI driver to main path. |
| `heptabase-pai-legacy-archive` | Prevent future agents from using the wrong legacy path. |
| `heptabase-sync-skill-version-record` | Close the skill/changelog feedback loop. |

Growth rules must treat PAI / Notion writes as external side effects. Dry-run, retry, archive, and fallback are different action classes and need approval policy.

## Outdated Or Superseded Assumptions

| Assumption | Current decision |
|---|---|
| Build a separate Jarvis project. | Superseded. MorroWise lives inside MC / ACP. |
| Heptabase or Canvas can define task status. | Superseded. They are visual layers only. |
| Markdown tables can carry current status. | Risky. Use generated read models for status. |
| The dashboard is the living system. | False. Dashboard is only a surface; feedback write-back makes the loop alive. |
| All proactive automation should come next. | False. Trigger registry, recommendation, and approval policy come first. |
| External sync can be automatic by default. | False. External writes need explicit policy and often approval. |
| Old ACP-MC dashboard tasks are the main path. | Superseded by ACP-MC-19/20 plus MC-LIVE read model and dashboard surface tasks. |

## Unresolved Gaps

1. MorroWise has no generated `morrowise-system.json` read model yet.
2. Open loops are not yet represented as data.
3. Growth gates are not formalized for task completion, commit boundaries, external sync, or docs/status drift.
4. Visual sync coverage has a partial homepage surface but not a dedicated read model.
5. Trigger registry is not defined.
6. Recommendation candidates are not generated from evidence.
7. Approval policy is not explicit enough to permit any autonomous runner.
8. External delivery paths remain blocked or pending: Notion, Telegram, schedule integration.
9. Historical `system-ops` tasks are not yet mapped one by one to current MC tasks.

## Next Executable Tasks

| Order | Task | Why next |
|---|---|---|
| 1 | `morrowise-mc-task-map` | Convert this index into a concrete mapping from old system-ops capabilities to current MC tasks. |
| 2 | `morrowise-growth-gate-spec` | Define when work becomes a growth signal and what output each gate produces. |
| 3 | `acp-task-schema-validator` | Protect future task writes before read models depend on them. |
| 4 | `acp-task-write-command-map` | Make Vincent's task-related phrases route to concrete commands and stop conditions. |
| 5 | `acp-visual-sync-coverage-report` | Turn current visual sync coverage from partial UI into a proper read model. |
| 6 | `acp-control-plane-read-model-v0` | Provide the first generated control-plane decision model. |

## Minimum Growth Gates To Add

### Task Completion Growth Gate

```text
Input:
- task id
- done_condition
- changed files
- verification result
- Heptabase / Canvas sync state
- task event state

Decision:
- commit now
- split commit
- keep open loop
- request approval
- block because verification is missing

Output:
- commit plan or open-loop record
- task event or MC state update
- sync_requested event when applicable
- dashboard-visible feedback
```

### External Sync Growth Gate

```text
Input:
- sync task id
- target system
- dry-run result
- external write risk
- legacy fallback state
- approval policy

Decision:
- dry-run only
- migrate implementation
- retry sync
- archive legacy path
- request approval
- block due to external write risk

Output:
- sync migration plan or open-loop record
- sync_requested / sync_failed / sync_blocked event
- legacy path status
- skill or changelog closure task
```

### Docs / State Drift Gate

```text
Input:
- markdown claim
- current MC task state
- generated read model
- visual layer state

Decision:
- update docs
- update task state
- mark docs as historical evidence
- create mapping task
- stop and ask Vincent when state conflict is ambiguous

Output:
- corrected source-of-truth pointer
- drift note
- task or open loop
```

## Index Rule

This document is a map, not a status source.

If any status in this document conflicts with `tasks.json` or generated MC data, the MC source wins. Update the index only to clarify structure, capability families, and routing.

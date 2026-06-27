# MorroWise Source Map Reconciliation

> Task: `morrowise/v0-source-map-mc-reconcile`
> Status: reconciliation evidence
> Updated: 2026-06-27
> Source map: `$COLLAB/notyet-harness/000_Agent/docs/morrowise/source-map-v0.md`
> Scope: Map source-map-v0 families to existing MC specs, registries, read models, future scanners, or known gaps.

## Purpose

This document reconciles `source-map-v0.md` with the existing MorroWise / MC control-plane specs.

It is not a new architecture source of truth. It is routing evidence for future generators, especially `morrowise-system-json-generator-v0` and `morrowise-manual-live-sync`.

Canonical state remains in:

- `$COLLAB/harness-mc/milestones/*/tasks.json`
- `$COLLAB/harness-mc/system-workflow/registries/*.json`
- generated read models under `$COLLAB/harness-mc/public/data/`
- verified MorroWise specs under `$COLLAB/harness-mc/system-workflow/docs/specs/`

## Reconciliation Rules

| Decision | Meaning |
|---|---|
| `merge` | Fold source-map-v0 intent into an existing MC spec, registry, or generated read model path. |
| `reference` | Keep as evidence or context; do not copy current status into another source. |
| `supersede` | Existing older assumption is replaced by a newer MorroWise decision. |
| `gap` | No sufficient scanner/read model/verifier exists yet; represent as `open_loops` or future scanner work. |

## Family Mapping

`source-map-v0.md` currently lists 14 source families. The original task acceptance says 13 families; this reconciliation treats the newer `approval_policy` family as an additional required family instead of dropping it.

| Source family | Decision | Existing MC / MorroWise target | Generator input role | Gap / next action |
|---|---|---|---|---|
| `entry_rules` | `merge` | `$COLLAB/AGENTS.md`, `$COLLAB/notyet-harness/000_Agent/CORE.md`, `$COLLAB/harness-mc/AGENTS.md`, `morrowise-anatomy-read-model.md` portable agent verification | Startup chain and work-anchor policy for `portable_agent_verification.entry_chain` | Add source existence and path-policy checks to `morrowise-system-json-generator-v0`. |
| `architecture_docs` | `merge` | `auditor-mvp.md`, `architecture-pulse-mvp.md`, `morrowise-control-console-verify.md`, `$COLLAB/notyet-harness/000_Agent/ARCHITECTURE.md` | Architecture drift target and docs-as-routing-evidence signal | Keep `ARCHITECTURE.md` under auditor loop; do not use `MANUAL.md` to rewrite it. |
| `tool_connectors` | `merge` | `morrowise-api-cli-mcp-capability-registry.json`, `morrowise-wiring-gate.json`, `morrowise-live-system-admission.json`, `morrowise-live-system-verification-standard.md` | Capability metadata, auth boundary, write boundary, verifier refs | Local runtime probes remain metadata-only; no secrets or runtime auth files. |
| `script_workflows` | `merge` | `$COLLAB/harness-mc/scripts/`, `morrowise-wiring-gate.json`, `morrowise-commit-planning-gate.json`, `runtime-scheduler-v0` task | Script existence, generator refs, npm script/verifier chain | Add script existence checks to future source-map generator or wiring gate expansion. |
| `safety_boundaries` | `merge` | `CORE.md`, `$COLLAB/notyet-harness/000_Agent/skills/worktree-commit/SKILL.md`, `morrowise-approval-policy.json`, `morrowise-live-system-admission.json` | Security and write-boundary rules for `immune` and `approval_policy` sections | Keep approval classes explicit before autonomous actions. |
| `memory_layer` | `reference` | `$COLLAB/notyet-harness/000_Agent/memory/MEMORY.md`, daily memory, `cc-log` skill, `morrowise-anatomy-read-model.md` memory/context section | Context and handoff evidence, not current task status | Memory freshness scanner is future work; represent unknowns in `open_loops`. |
| `second_brain` | `gap` | `$COLLAB/notyet-harness/300_Obsidian_brain/HC/`, Heptabase/Obsidian mirror refs, `morrowise-anatomy-read-model.md` memory/context section | Knowledge area metadata only | `knowledge_health_metrics_missing`: need last_used_at, reference_count_30d, completeness_state, workflow_links, known_gaps. |
| `project_state` | `merge` | `$COLLAB/harness-mc/milestones/*/project.json`, `$COLLAB/harness-mc/milestones/*/tasks.json`, `$COLLAB/harness-mc/public/data/projects.json`, `validate-tasks.mjs` | Canonical task/project state for `source_of_truth`, `feedback`, `open_loops` | Generator must read tasks first and docs second. |
| `task_events` | `merge` | `$COLLAB/harness-mc/task-events/**/*.json`, `$COLLAB/harness-mc/public/data/task-events.json`, `verify-task-event-outbox.mjs`, `verify-apply-task-events.mjs` | Event pipeline, pending/rejected/applied status, feedback signals | Pending events should appear as `open_loops` until reducer applies them. |
| `commit_control` | `merge` | `$COLLAB/harness-mc/public/data/worktrees.json`, `worktree-commit` skill, `morrowise-commit-planning-gate.json`, closeout residual ledger | Dirty/ahead/behind/diverged status and commit evidence pressure | Use read-only audit; never stage/commit/push from generated data. |
| `skills_workflows` | `reference` | `$COLLAB/notyet-harness/000_Agent/skills/`, `SKILLS-INDEX.md`, `validate-skills.mjs`, routing notes in `CORE.md` and `AGENTS.md` | Skill refs and verifier refs for agent handoff | Future skill graph scanner should detect renamed skills or stale trigger rules. |
| `dashboard_surfaces` | `merge` | `morrowise-live-dashboard-read-model-contract.md`, `morrowise-live-dashboard-routing.md`, `morrowise-live-dashboard-drilldown-pages.md`, `$COLLAB/harness-mc/public/data/morrowise-live-dashboard.json` | Surface freshness, route, next_action, write_boundary, verifier refs | `dashboard_not_connected`: do not mark a surface live until source/generator/verifier are present. |
| `external_mirrors` | `reference` | visual-layer transition protocol, Obsidian Canvas sync, Heptabase task-card refs, `morrowise-live-dashboard-read-model-contract.md` visual layer boundary | Mirror status and sync gap evidence only | Mirrors must never close task state or override MC canonical files. |
| `approval_policy` | `merge` | `morrowise-approval-policy.json`, `morrowise-approval-policy.md`, `morrowise-action-runner.md`, `morrowise-live-system-admission.json` | Approval queue, allowed/forbidden classes, external write boundary | Autonomous runner remains blocked until approval policy and verifier prove safe classes. |

## Known Gap Mapping

| Gap ID | Applies to | Current handling | Next task / owner |
|---|---|---|---|
| `local_runtime_boundary` | `tool_connectors`, `script_workflows`, `safety_boundaries`, `dashboard_surfaces` | Treat as metadata-only. Safe probes may check existence/version/process label; no token, cookie, private key, browser auth, or runtime auth content may be read. | `morrowise-system-json-generator-v0` should emit `open_loops` for local runtime items without safe probes. |
| `knowledge_health_metrics_missing` | `second_brain` | Keep `second_brain` as `gap` until health fields exist. Do not display it as healthy based only on folder existence. | Future knowledge scanner or `morrowise-system-json-generator-v0` placeholder open loop. |
| `scanner_not_implemented` | all live candidates | Use `manual` or `unknown` freshness when a source has a spec but no generator. | `morrowise-system-json-generator-v0` should distinguish schema-defined from generator-ready. |
| `dashboard_not_connected` | `dashboard_surfaces` | Surfaces are candidates unless source, generator, generated_at, stale_rule, next_action, write_boundary, and verifier all exist. | Existing live-dashboard verifier plus wiring gate expansion. |

## Superseded Or Historical Inputs

| Input | Current treatment |
|---|---|
| Historical `harness-mc` `morrowise-system` track | Historical implementation lineage and schema evidence. New system tasks belong to `$COLLAB/harness-mc/milestones/morrowise/tasks.json`. |
| `Jarvis` / `system-ops` naming | Historical evidence only. Formal name is MorroWise. |
| Markdown status tables in older specs | Routing/decision evidence only. Current state must come from tasks, registries, generated read models, and verifiers. |
| Dashboard as living system | Superseded. Dashboard is a surface; feedback write-back and verifier loops make the system alive. |

## Generator Input Priority

Future `morrowise-system-json-generator-v0` should use this order:

1. Read canonical task and project files.
2. Read registries: admission, wiring, approval, trigger, recommendation, capability, commit planning.
3. Read generated data: projects, task events, worktrees, live dashboard, capabilities, residual ledger.
4. Read MorroWise specs as routing and decision evidence.
5. Read manual docs such as `README.md`, `ARCHITECTURE.md`, and future `MANUAL.md` only as identity, boundary, and routing context.
6. Emit unresolved or unsafe state as `open_loops`; do not hide it in prose.

## Acceptance Matrix

| ID | Check | Result | Evidence |
|---|---|---|---|
| `SMR-01` | Every source-map-v0 family has a target classification. | pass | The family mapping covers all 14 current families. |
| `SMR-02` | Required known gaps are explicit. | pass | `local_runtime_boundary`, `knowledge_health_metrics_missing`, `scanner_not_implemented`, and `dashboard_not_connected` are mapped. |
| `SMR-03` | Existing MorroWise specs are used as evidence, not copied into a new architecture source. | pass | This doc records routing decisions and points to specs/registries; it does not define current state. |
| `SMR-04` | Next generator can decide read priority. | pass | Generator Input Priority defines task/registry/generated/spec/manual order. |

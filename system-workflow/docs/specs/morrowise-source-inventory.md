# MorroWise Source Inventory

> Created: 2026-06-20
> Scope: `morrowise-system` track in `$COLLAB/harness-mc/milestones/harness-mc`

MorroWise is the current system name. Jarvis and `system-ops` are historical references only.

## Source-Of-Truth Levels

| Level | Role | Rule |
|---|---|---|
| S0 | Current executable state | Current MC milestone files decide task status, dependencies, next actions, and dashboard/read-model behavior. |
| S1 | Legacy canonical evidence | Historical `system-ops` project files define the original intent, capability map, methodology, and productization plan. |
| S2 | Current knowledge mirror | Obsidian Project notes summarize historical project state, but do not override MC task state. |
| S3 | Timeline evidence | Daily memory explains when decisions happened and why, but may contain outdated status. |
| S4 | Visual layers | Heptabase and Obsidian Canvas help operators see work; they must not reverse-overwrite MC state. |

## S0 Current MC Sources

| Path | Source type | Source level | Use for MorroWise |
|---|---|---:|---|
| `$COLLAB/harness-mc/milestones/harness-mc/project.json` | Current project definition | S0 | Current goals, risks, success criteria, decisions, and naming policy. |
| `$COLLAB/harness-mc/milestones/harness-mc/tasks.json` | Current task source of truth | S0 | `morrowise-system` task chain, dependencies, external Heptabase refs, and current task state. |
| `$COLLAB/harness-mc/system-workflow/docs/specs/workflow-dashboard.md` | Current dashboard/workflow spec | S0 | Existing MC dashboard assumptions to reuse or supersede in MorroWise surface design. |
| `$COLLAB/harness-mc/system-workflow/docs/mockups/dashboard.html` | Dashboard mockup | S4 | Visual reference only; not a task-state source. |
| `$COLLAB/harness-mc/system-workflow/docs/mockups/worktree-status.html` | Worktree status mockup | S4 | Related control-plane surface for unfinished local work; visual reference only. |

### Current MorroWise Task Chain

Control-console batch:

| Order | Task | Status | Role |
|---:|---|---|---|
| 1 | `morrowise-source-inventory` | completed | Inventory and source-of-truth grading. |
| 2 | `morrowise-system-index` | todo | Durable MorroWise index and capability summary. |
| 3 | `morrowise-mc-task-map` | todo | Map historical capabilities into current MC tasks. |
| 4 | `morrowise-growth-gate-spec` | todo | Define triggers, flow, surfaces, and feedback loop. |
| 13 | `morrowise-anatomy-read-model` | todo | Define `morrowise-system.json` v0 schema. |
| 14 | `morrowise-dashboard-surface` | todo | Show MorroWise status on MC surface. |
| 15 | `morrowise-control-console-verify` | todo | Verify the observable control-console loop. |

Proactive-loop batch:

| Order | Task | Status | Role |
|---:|---|---|---|
| 16 | `morrowise-trigger-rules-registry` | todo | Define event triggers, cooldowns, and output events. |
| 17 | `morrowise-recommendation-engine-v0` | todo | Produce evidence-backed next-best-action candidates. |
| 18 | `morrowise-approval-policy` | todo | Split auto, approval-required, and forbidden actions. |
| 19 | `morrowise-autonomous-action-runner-v0` | todo | Implement low-risk runner behavior. |
| 20 | `morrowise-proactive-loop-dashboard` | todo | Display trigger to feedback status. |
| 21 | `morrowise-proactive-loop-verify` | todo | Verify the proactive closed loop. |

## S1 Legacy System-Ops Sources

| Path | Source type | Source level | Use for MorroWise |
|---|---|---:|---|
| `$COLLAB/.openclaw_260418/workspace/milestones/projects/system-ops/BLUEPRINT.md` | Productization blueprint | S1 | Defines the original "internal system becomes product" strategy and four-phase Jarvis roadmap. |
| `$COLLAB/.openclaw_260418/workspace/milestones/projects/system-ops/project.json` | Historical project definition | S1 | Original goals and success criteria for system maintenance, reference implementation, WARROOM, connector/persona templates, and proactive sensing. |
| `$COLLAB/.openclaw_260418/workspace/milestones/projects/system-ops/tasks.json` | Historical task list | S1 | 30 old tasks. Use for migration mapping only; do not treat statuses as current MC state. |
| `$COLLAB/.openclaw_260418/workspace/milestones/projects/system-ops/references/methodology.md` | Methodology source | S1 | SRE toil, PDCA, Kaizen, "repair loop" method, and Jarvis capability decomposition. |
| `$COLLAB/.openclaw_260418/workspace/milestones/projects/system-ops/references/cron-redesign.md` | Scheduling redesign plan | S1 | Cron consolidation, timeout causes, and preprocessor-script pattern. |
| `$COLLAB/.openclaw_260418/workspace/milestones/projects/system-ops/references/memory-tag-spec.md` | Memory taxonomy | S1 | Issue classification tags for safety, data, flow, performance, docs, integration, config, dependency, judgment, and tools. |
| `$COLLAB/.openclaw_260418/workspace/milestones/projects/system-ops/references/merge-sop.md` | Project merge SOP | S1 | Historical integration plan for backup-system, subagent-tracker, OpenClaw upgrade, and multi-module work. |
| `$COLLAB/.openclaw_260418/workspace/milestones/projects/system-ops/references/pre-launch-sop.md` | Safety and rollback SOP | S1 | Worktree, backup, rollback, remote sync cleanup, and impact-category discipline. |

## S2 Current Obsidian Mirror

| Path | Source type | Source level | Use for MorroWise |
|---|---|---:|---|
| `$COLLAB/notyet-harness/300_Obsidian_brain/Projects/system-ops.md` | Project knowledge mirror | S2 | Human-readable historical project page. Use to understand what Vincent saw in Obsidian, but do not override MC task state. |
| `$COLLAB/notyet-harness/300_Obsidian_brain/Projects/README.md` | Project index | S2 | Confirms the Obsidian-facing project entry and link target. |

## S3 Timeline Memory

| Path | Source type | Source level | Why it matters |
|---|---|---:|---|
| `$COLLAB/.openclaw_260418/workspace/memory/2026-03-14.md` | Daily memory | S3 | Earlier Jarvis capability decomposition: proactive monitoring, context awareness, multimodal control, autonomous learning, prediction, multi-agent coordination, humor, privacy/security, self-maintenance. |
| `$COLLAB/.openclaw_260418/workspace/memory/2026-03-21.md` | Daily memory | S3 | system-ops opening moment, method research, and the first "repair loop" framing. |
| `$COLLAB/.openclaw_260418/workspace/memory/2026-03-22.md` | Daily memory | S3 | Productization blueprint, project merge decisions, rollback lessons, cron inventory, and later corrections. |
| `$COLLAB/.openclaw_260418/workspace/memory/2026-03-26.md` | Daily memory | S3 | system-ops t1 completion. |
| `$COLLAB/.openclaw_260418/workspace/memory/2026-03-28.md` | Daily memory | S3 | Later system-ops task additions, including backup and project-init related follow-up. |
| `$COLLAB/.openclaw_260418/workspace/memory/2026-04-03.md` | Daily memory | S3 | system-ops t11, t12, and t2 completion records. |
| `$COLLAB/.openclaw_260418/workspace/memory/monthly/2026-03.md` | Monthly memory | S3 | Compact month-level pointer to system-ops opening and major dates. |

## Current Control-Plane And Sentinel Neighbors

MorroWise should reuse these current MC/control-plane tasks instead of reopening them as new work:

| Task | Status | Relationship |
|---|---|---|
| `acp-task-event-outbox` | completed | Cross-repo task events; useful feedback/event bridge. |
| `acp-apply-task-events` | completed | Single-writer reducer; useful feedback write-back mechanism. |
| `acp-task-state-split` | completed | Definition/state separation; useful read-model precedent. |
| `acp-external-sync-queue` | completed | External sync queue; useful for Heptabase/Obsidian/Notion feedback. |
| `acp-task-event-dashboard` | completed | Existing visibility surface for task event pipeline. |
| `acp-worktree-status-inventory` | in_progress | Nearby unfinished-work visibility surface. |
| `acp-control-plane-read-model-v0` | todo | Direct dependency for MorroWise anatomy read model. |
| `acp-dashboard-spec` | deferred | Superseded by `morrowise-growth-gate-spec`; keep as historical reference. |
| `acp-system-workflow-migration-note` | deferred | Superseded by `morrowise-system-index`; fold into index work. |
| `acp-home-control-plane-card` | deferred | Wait for MorroWise read model/surface before UI decision. |
| `acp-project-detail-control-plane` | deferred | Wait for MorroWise task map and control-plane read model. |
| `sn-1` to `sn-4` | completed | Existing sentinel data and MC "today changes" surface. |
| `sn-5`, `sn-6` | blocked | External delivery paths still blocked; treat as gaps for proactive loop. |
| `sn-7` | todo | Scheduler integration still pending; relevant to trigger automation. |

## Initial Classification

| Source family | Keep | Migrate | Archive / Caution |
|---|---|---|---|
| Jarvis capability decomposition | Capabilities as long-term anatomy categories | Map into MorroWise index and anatomy schema | Do not keep Jarvis as formal product/system name. |
| SRE / PDCA / Kaizen method | Core repair-loop principle | Convert to feedback-loop and growth-gate language | Do not treat old task completion counts as current. |
| Cron redesign | Timeout causes, preprocessing pattern, schedule consolidation | Map into trigger registry and scheduler surface | Old cron counts are historical. Verify current schedule before action. |
| Memory tag taxonomy | Issue classification categories | Reuse as evidence/risk categories in recommendation engine | Old OpenClaw memory policy may differ from current shared-agent memory. |
| Productization blueprint | Reference Implementation path and WARROOM idea | Keep as product-direction background | Do not build product UI before MC living-system surface exists. |
| Historical system-ops tasks | Capability backlog | Map each old task to current MC task, superseded task, or archive reason | Never import wholesale; avoid duplicate ACP/sentinel work. |

## Next Work Input

`morrowise-system-index` should use this inventory to produce:

1. capability anatomy: intention, memory/context, events/senses, tools/agents, validators/immune system, schedules/heartbeat, feedback/open loops;
2. historical source summary by source family;
3. current MC mapping targets;
4. outdated or superseded assumptions;
5. unresolved gaps before dashboard or proactive automation work begins.

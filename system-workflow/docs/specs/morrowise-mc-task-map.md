# MorroWise To MC Task Map

> Task: `morrowise-mc-task-map` (`MC-LIVE-03`)
> Status: active map
> Updated: 2026-06-20
> Current source of truth: `$COLLAB/harness-mc/milestones/harness-mc/tasks.json`
> Legacy evidence: `$COLLAB/.openclaw_260418/workspace/milestones/projects/system-ops/tasks.json`

## Purpose

This map prevents MorroWise from reopening old `system-ops` / Jarvis work as duplicate MC tasks.

The rule is:

```text
Legacy system-ops capability
  -> keep as evidence
  -> map to current MC task
  -> migrate into existing MC-LIVE / ACP-SYNC task
  -> or archive with reason
```

Do not import old task status into current MC. Current state is decided by `harness-mc/milestones/harness-mc/tasks.json`.

## Mapping Legend

| Disposition | Meaning |
|---|---|
| `mapped_to` | Existing MC task already owns the work. |
| `migrate_to` | Capability should be folded into an upcoming MC task's scope. |
| `superseded_by` | Old task is replaced by a newer MC mechanism. |
| `archive_reason` | Keep only as historical evidence. |
| `no_new_task` | Do not create a new task now. |

## Executive Decision

No new MC tasks are required from this mapping.

The old `system-ops` backlog is adequately absorbed by:

- MorroWise main line: `MC-LIVE-02` to `MC-LIVE-20`;
- ACP control-plane infrastructure: `ACP-MC-13` to `ACP-MC-20`, `ACP-MC-REPORT-01`;
- ACP-SYNC migration line: `ACP-SYNC-01` to `ACP-SYNC-05`;
- Sentinel line: `sn-5` to `sn-7`;
- Deferred legacy references: `LEGACY-P2-*`, `LEGACY-INF-8`, `ACP-MC-01` to `ACP-MC-07`.

The next work should refine existing tasks, not add parallel tasks.

## Legacy Task Mapping

| Legacy task | Legacy title | Disposition | Current MC target | Notes |
|---|---|---|---|---|
| `t1` | Cron 重整：清除 10 個停用殭屍 job | `mapped_to` | `sn-7`, agnostic-scheduler milestones | Historical cleanup. Current scheduler work should live in agnostic-scheduler and sentinel schedule integration. |
| `t2` | Cron 重整：建立 daily-briefing.py | `mapped_to` | `sn-2`, `sn-3`, `sn-4` | Sentinel and MC changes surface now provide briefing-like behavior. |
| `t3` | Cron 重整：建立 daily-closing.py | `migrate_to` | `morrowise-trigger-rules-registry`, `sn-7` | Closing should become a trigger/output rule, not a standalone legacy cron task. |
| `t4` | nightly-ops.sh（備份+repo+dashboard） | `migrate_to` | `morrowise-trigger-rules-registry`, `morrowise-recommendation-engine-v0` | Nightly ops becomes heartbeat + recommendations. Backup details belong outside MorroWise unless surfaced as triggers. |
| `t5` | 合併 job（22→14）+ 避免撞車 | `mapped_to` | agnostic-scheduler milestones, `sn-7` | Keep as scheduler evidence; do not reopen inside harness-mc. |
| `t6` | 觀察一週驗證無 timeout | `migrate_to` | `morrowise-control-console-verify` | Becomes verification evidence for heartbeat stability. |
| `t7` | CORE.md 加「修完三問」規則 | `superseded_by` | `morrowise-growth-gate-spec` | Repair questions become Growth Gate rules. |
| `t8` | memory 日誌格式加問題分類 tag | `migrate_to` | `morrowise-anatomy-read-model`, `morrowise-recommendation-engine-v0` | Tags become evidence/risk fields, not separate memory UI work. |
| `t9` | 方法論文件整理 + Jarvis 能力藍圖整合 | `superseded_by` | `morrowise-living-system-index` | Completed by MC-LIVE-02; keep as historical source. |
| `t10` | how-i-work 敏感資料清除 | `mapped_to` | security-scan skill, `morrowise-approval-policy` | Safety capability maps to immune system / approval policy. |
| `t11` | weekly-ops-check.py | `migrate_to` | `morrowise-trigger-rules-registry` | Weekly review becomes a named trigger. |
| `t12` | 週日 cron + Ops 維護 + toil 歸類 | `migrate_to` | `morrowise-trigger-rules-registry`, `morrowise-recommendation-engine-v0` | Toil categories should feed recommendations. |
| `t13` | Obsidian 週維護手動 Checklist | `mapped_to` | visual-layer transition protocol, `acp-visual-sync-coverage-report` | Manual checklist becomes coverage/read-model work. |
| `t14` | 月復盤升級：toil 趨勢 + 50% 規則 | `migrate_to` | `morrowise-anatomy-read-model`, `morrowise-dashboard-surface` | Needs model fields before dashboarding. |
| `t15` | 一個月後覆盤閉環是否生效 | `mapped_to` | `morrowise-control-console-verify`, `morrowise-proactive-loop-verify` | Split into console verify and proactive verify. |
| `t16` | 專案歸類完成 + 子專案同步 | `mapped_to` | `acp-visual-sync-coverage-report`, project milestones | Current visual sync coverage is the right owner. |
| `t17` | Reference Architecture 文件化 | `migrate_to` | `morrowise-dashboard-surface`, future product docs | Not first-phase MC work; keep as productization background. |
| `t18` | MC 擴充 Persona / Connector / Agent 協作視圖 | `superseded_by` | `morrowise-dashboard-surface`, `acp-runtime-policy-surface` | Do not build product UI before living-system read model. |
| `t19` | Connector 標準化 | `migrate_to` | `heptabase-pai-sync-migration-spec`, future connector tasks | Current concrete connector work is Heptabase PAI sync decoupling. |
| `t20` | 統一同步引擎 | `mapped_to` | `acp-external-sync-queue`, `ACP-SYNC-01..05` | Current sync architecture is queue + migration line. |
| `t21` | Obsidian → Notion 雙向回寫 | `archive_reason` | none now | Too broad and risky; external writes require approval policy first. |
| `t22` | Persona 模板化 | `archive_reason` | future productization | Not part of current living-system core. |
| `t23` | Event Stream + Trigger Rules | `mapped_to` | `morrowise-trigger-rules-registry`, `acp-task-event-outbox` | Existing event queue plus future trigger registry covers this. |
| `t24` | Context Accumulator | `migrate_to` | `morrowise-anatomy-read-model`, `acp-control-plane-read-model-v0` | Becomes context/read-model schema, not standalone DB yet. |
| `t25` | 預測建議：週復盤 AI 主動建議 | `mapped_to` | `morrowise-recommendation-engine-v0` | Recommendation engine owns this. |
| `t26` | 多模態控制：Canvas 整合 | `mapped_to` | visual-layer transition protocol, Canvas sync hook | Canvas is mirror/surface, not control source. |
| `t27` | 幽默個性：SOUL.md 風格迭代 | `archive_reason` | none now | Valuable identity work, but outside MorroWise operational loop. |
| `t28` | backup.sh + worktree-commit 整合 | `mapped_to` | `acp-worktree-status-inventory`, worktree-commit skill | Dirty work and commit boundary sensing already covered. |
| `t29` | new-project.py 加 --type + promote | `archive_reason` | project-init history | Already historical; no current MorroWise action needed. |
| `t30` | check-repos.py type vs repos.json | `migrate_to` | `morrowise-trigger-rules-registry`, `morrowise-recommendation-engine-v0` | Repo/project drift can become a trigger, not a standalone port. |

## Capability Family Mapping

| Capability family | Legacy sources | Current owner | Required adjustment |
|---|---|---|---|
| Repair loop / Kaizen | `t7`, `t11`, `t12`, methodology.md | `morrowise-growth-gate-spec` | Add Task Completion Growth Gate and Docs/State Drift Gate. |
| Scheduler / heartbeat | `t1` to `t6`, cron-redesign.md | `sn-7`, agnostic-scheduler, `morrowise-trigger-rules-registry` | Model weekly/daily/monthly checks as trigger rules. |
| Memory / context | `t8`, `t24`, memory-tag-spec.md | `morrowise-anatomy-read-model` | Add context, evidence tags, and drift-risk fields. |
| Feedback / event stream | `t23`, `t28` | `acp-task-event-outbox`, `acp-apply-task-events`, `acp-external-sync-queue` | MorroWise should name these as feedback spine. |
| Dashboard / surface | `t18`, `t26` | `morrowise-dashboard-surface`, `acp-visual-sync-coverage-report` | Surface should show open loops and visual sync gaps, not become source of truth. |
| External sync / connectors | `t19`, `t20`, `t21` | `ACP-SYNC-01..05`, `acp-external-sync-queue` | External writes need approval policy and dry-run parity. |
| Recommendation | `t25` | `morrowise-recommendation-engine-v0` | Recommendations must include evidence, risk, approval, and suggested task id. |
| Productization | BLUEPRINT.md, `t17`, `t22` | future product docs | Keep out of first living-system loop until MC is observable and safe. |
| Safety / rollback | `t10`, pre-launch-sop.md | `morrowise-approval-policy`, security-scan skill | Classify allowed / approval-required / forbidden actions. |

## Current MC Task Adjustments

No new tasks are needed.

Existing tasks should be refined as follows:

| Current task | Adjustment |
|---|---|
| `morrowise-growth-gate-spec` | Include Task Completion Growth Gate, Commit Boundary Gate, External Sync Growth Gate, and Docs/State Drift Gate. |
| `morrowise-anatomy-read-model` | Include `context`, `evidence_tags`, `commit_boundaries`, `dirty_work`, `feedback_events`, and `open_loops`. |
| `morrowise-trigger-rules-registry` | Include stale/blocked, rejected event, sync failure, dirty completed work, docs/status drift, weekly review, and legacy fallback usage triggers. |
| `morrowise-recommendation-engine-v0` | Allow recommendations: commit now, split commit, wait, create task event, refresh visual layer, dry-run external sync, archive legacy path, request approval. |
| `morrowise-approval-policy` | Classify commit, push, task mutation, external writes, dry-run, sync retry, legacy archive, delete, secret, and history rewrite. |
| `acp-visual-sync-coverage-report` | Keep as formal read model owner for task/Heptabase/Canvas coverage; do not fold into dashboard-only work. |
| `heptabase-pai-sync-migration-spec` | Treat as the first concrete external sync muscle and integration boundary case. |

## Tasks To Keep Deferred

| Deferred task | Keep deferred because |
|---|---|
| `p2-1` | Memory spec is now part of MorroWise anatomy, not a separate pillar. |
| `p2-2` | `/memory` page should wait for read model and dashboard surface. |
| `inf-8` | Git log backfill is covered by task events and control-plane read model. |
| `acp-dashboard-spec` | Superseded by ACP-MC-20 and MorroWise growth-gate/dashboard tasks. |
| `acp-system-workflow-migration-note` | Superseded by MC-LIVE-02 and this task map. |
| `acp-control-plane-data-generator` | Superseded by `acp-control-plane-read-model-v0`. |
| `acp-home-control-plane-card` | Superseded by `morrowise-dashboard-surface` and System Attention. |

## Archive-Only Legacy Material

The following should not generate near-term tasks:

- WARROOM v2 product UI.
- Persona template packaging.
- Customer onboarding / multi-tenant productization.
- Humor/personality iteration.
- Bidirectional Notion writes.

These are not rejected. They are simply downstream of a working MC living-system loop with approval policy.

## Next Work Entry

The next executable MorroWise task is:

`morrowise-growth-gate-spec` (`MC-LIVE-04`)

It should use this map to define the actual gates:

1. Task Completion Growth Gate.
2. Commit Boundary Gate.
3. External Sync Growth Gate.
4. Docs / State Drift Gate.
5. Weekly Review / Toil Growth Gate.

Only after those gates exist should `morrowise-anatomy-read-model` turn them into data.

## Map Rule

This map is an interpretation layer. It does not override current task state.

If a future task, dashboard, Heptabase card, or Canvas node disagrees with `tasks.json`, use `tasks.json` as current state and update this map only to clarify migration meaning.

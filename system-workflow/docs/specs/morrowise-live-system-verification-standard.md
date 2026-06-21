# MorroWise Live System Verification Standard

> Task: `morrowise-live-system-verification-standard` (`MC-LIVE-SYS-01`)
> Status: verification standard
> Updated: 2026-06-21
> Scope: MorroWise / MC dashboard surfaces, not Taiwan.md or Semiont.

## Purpose

This standard defines when a Mission Control dashboard surface may be called part of a living system.

The goal is to prevent this failure mode:

```text
has data on screen
  -> looks current
  -> gets called alive
  -> no one can tell source, freshness, boundary, or next action
```

A surface is alive only when another Agent can answer:

```text
source -> generator -> generated_at -> stale_rule -> next_action -> write_boundary -> verifier
```

If any required field is missing, the surface must degrade to `semi_live`, `static_display`, or `fake_live_risk`.

## Classification

| Classification | Meaning | Allowed wording |
|---|---|---|
| `live` | The surface reads canonical or generated current data, exposes freshness and next action, respects write boundaries, and has a verifier. | "已活" |
| `semi_live` | The surface has some current data, but one or more loop fields are incomplete or not yet generated. | "半活" |
| `static_display` | The surface is a useful mockup, documentation view, or static summary without a current generator. | "靜態展示" |
| `fake_live_risk` | The surface appears operational but hides stale data, missing source, unsafe write authority, or unverifiable state. | "假活風險" |

Do not use "alive", "live system", "proactive", or "closed loop" for `semi_live`, `static_display`, or `fake_live_risk` surfaces without explicitly naming the classification.

## Required Surface Contract

Every dashboard surface must publish or make inspectable these fields.

| Field | Required answer | Pass condition | Fail condition |
|---|---|---|---|
| `surface_id` | Stable id for audit and future read models. | Id is stable across UI copy changes. | Only title text exists. |
| `label` | Human-readable surface name. | Label matches the UI. | Audit cannot map data to a visible block. |
| `source` | Canonical task/event/data source. | Points to `tasks.json`, task events, generated read model, committed spec, or approved local read model. | Points only to chat, screenshot, Heptabase, Canvas, or memory. |
| `generator` | Script, build step, or manual process that creates the displayed state. | Generator is named and rerunnable or explicitly marked manual. | No one knows how the value appeared. |
| `generated_at` | Timestamp of the displayed data. | Visible in UI or present in read model. | Surface presents time-sensitive data with no timestamp. |
| `stale_rule` | Rule for when data degrades. | Has a threshold or manual freshness rule. | Data can become old but never says so. |
| `next_action` | Concrete next step when attention is needed. | Names task id, route, approval request, verifier, or owner action. | Shows red/yellow state without a path forward. |
| `write_boundary` | What the surface is allowed and forbidden to write. | Explicitly states read-only or approved write class. | UI implies task close, sync, commit, push, or deploy without approval boundary. |
| `verifier` | Command, script, checklist, or future verifier that proves the surface. | Verifier exists or the missing verifier is recorded as an open loop. | Status is trusted because it looks right. |
| `evidence_refs` | File paths, task ids, event ids, commit hashes, or generated data paths. | Another Agent can trace the claim. | Evidence lives only in conversation. |

Minimum pass:

```text
source + generator + generated_at + stale_rule + next_action + write_boundary + verifier
```

Optional fields may improve the surface, but they cannot replace the minimum pass.

## Pass / Fail Checklist

Use this checklist for `MC-LIVE-SYS-02` and later verifier work.

| Check | Question | Pass | Classification if fail |
|---|---|---|---|
| C1 Source | Does the surface name the current source of truth? | Source is canonical or generated from canonical data. | `fake_live_risk` if it looks current; otherwise `static_display`. |
| C2 Generator | Can the data be regenerated? | Script/build/manual owner is named. | `semi_live` if source exists; `static_display` if not. |
| C3 Freshness | Can the surface tell whether data is stale? | `generated_at` and `stale_rule` exist. | `fake_live_risk` for operational metrics; `semi_live` for low-risk summaries. |
| C4 Next action | Does attention lead to a concrete action? | Task id, owner, route, verifier, or approval request exists. | `semi_live`. |
| C5 Write boundary | Is the surface clear about side effects? | Read-only or approved write class is explicit. | `fake_live_risk`. |
| C6 Verifier | Can the claim be checked without trust? | Command/checklist/verifier exists or is explicitly pending. | `semi_live`; `fake_live_risk` if surface claims closure. |
| C7 Evidence | Can a new Agent continue from files? | Evidence refs are durable paths/ids. | `static_display` or `fake_live_risk` depending on implied authority. |

A surface is `live` only if C1 through C7 pass.

## Surface Type Rules

### Homepage Summary

The homepage should answer only:

- now: whether Vincent or the next Agent needs to care;
- priority: which item to handle first;
- freshness: whether displayed data is current enough;
- approval: whether a human gate is blocking action.

Homepage surfaces may summarize. They must link or route to deeper evidence rather than expanding every detail.

### Drill-Down Surface

Drill-down pages own detail:

- full task list;
- pipeline events;
- sync/replay details;
- dirty files and commit grouping;
- audit history;
- verifier output.

Drill-down surfaces must still expose source, freshness, boundary, and verifier. Detail volume does not excuse missing living-system fields.

### Mockup

A mockup is `static_display` by default.

It may be accepted for information architecture if it clearly labels:

- intended source;
- intended generator;
- intended freshness;
- intended next action;
- intended write boundary;
- intended verifier owner.

It must not be marked `live` until connected to real generated data and verified.

## Write Boundary Standard

Dashboard surfaces are read-only unless a later task explicitly introduces a controlled write flow.

Forbidden from dashboard surface alone:

- closing tasks;
- changing task status;
- writing Heptabase, Notion, Obsidian Canvas, Telegram, or other external systems;
- committing, pushing, deploying, or rewriting git history;
- using visual layers or chat as the canonical source of truth.

Allowed without extra approval:

- displaying current generated state;
- linking to source files or routes;
- producing a local draft patch inside the active task;
- producing an approval request or commit plan.

Approval required:

- task state mutation;
- external write or sync;
- visual-layer overwrite;
- commit, push, or deploy.

## Stale / Degraded Rules

Every time-sensitive surface must choose a stale rule.

| Data class | Suggested stale rule | Degraded state |
|---|---|---|
| Generated MC data | stale if `generated_at` is older than the current build/session expectation. | Show `stale data` and route to generator. |
| Task events | stale if pending/rejected queue has not been reduced or explained after review. | Show queue age and next reducer action. |
| Worktree status | stale after any commit, checkout, file edit, or agent handoff. | Ask for fresh dirty-tree scan. |
| External mirrors | manual unless dry-run/sync metadata exists. | Show `manual mirror` or `sync approval required`. |
| Mockups/specs | static unless explicitly regenerated. | Show `static_display`. |

If freshness cannot be determined, the surface cannot be `live`.

## Standard Surface Audit Template

Use this table in `MC-LIVE-SYS-02`.

| Surface | source | generator | generated_at | stale_rule | next_action | write_boundary | verifier | classification | gaps |
|---|---|---|---|---|---|---|---|---|---|
| `<surface label>` | `<source path/data>` | `<script/manual>` | `<timestamp/location>` | `<rule>` | `<task/route/action>` | `<read-only/approval>` | `<command/check>` | `<live/semi_live/static_display/fake_live_risk>` | `<missing fields>` |

## Initial Surfaces To Audit

`MC-LIVE-SYS-02` must audit at least:

| Surface | Expected owner of evidence |
|---|---|
| System Attention | `changes.json`, task events, generated data freshness. |
| MorroWise 活系統 | projects, task events, changes, MorroWise task chain. |
| MorroWise 主動閉環 | `morrowise-proactive-loop.json`, approval policy, runner boundary. |
| Task Event Pipeline | task-event outbox/reducer/sync queue generated data. |
| Worktree Status | `worktrees.json`, dirty-tree classification. |
| Approval Queue | approval policy, pending approval records, external write boundaries. |

If a surface is not yet implemented, classify it as `static_display` or `semi_live` and record the task that should make it live.

## Acceptance Criteria For This Standard

This standard passes `MC-LIVE-SYS-01` when:

1. It defines `live`, `semi_live`, `static_display`, and `fake_live_risk`.
2. It requires `source`, `generator`, `generated_at`, `stale_rule`, `next_action`, `write_boundary`, and `verifier`.
3. It states that visual layers cannot close tasks or override canonical task state.
4. It provides a reusable audit table for `MC-LIVE-SYS-02`.
5. It names the required initial surfaces to audit.
6. It keeps Taiwan.md and Semiont out of the verification subject.


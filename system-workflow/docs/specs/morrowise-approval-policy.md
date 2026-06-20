# MorroWise Approval Policy

> Task: `morrowise-approval-policy` (`MC-LIVE-18`)
> Status: formal policy
> Updated: 2026-06-20
> Machine-readable policy: `$COLLAB/harness-mc/system-workflow/registries/morrowise-approval-policy.json`
> Upstream: `morrowise-recommendation-engine-v0`

## Purpose

MorroWise can now notice triggers and produce recommendations. Before any runner exists, the system needs a safety gate that decides which action candidates may run, which must stop for Vincent approval, and which are forbidden.

This policy is the gate between:

```text
trigger -> recommendation -> approval -> action -> feedback
```

Without this policy, MorroWise must not claim autonomous execution.

## Sources Reviewed

The machine-readable policy records the full reviewed source list. The sources include:

- `$COLLAB/notyet-harness/000_Agent/CORE.md`
- `$COLLAB/notyet-harness/000_Agent/docs/agent-control-plane/openclaw-security-extract-260613.md`
- `$COLLAB/notyet-harness/000_Agent/docs/agent-control-plane/mcp-tools-boundary-map-260613.md`
- `$COLLAB/notyet-harness/000_Agent/docs/agent-control-plane/visual-layer-transition-protocol.md`
- `$COLLAB/notyet-harness/000_Agent/skills/security-scan/`
- `$COLLAB/notyet-harness/000_Agent/skills/browser-setup/SKILL.md`
- `$COLLAB/notyet-harness/000_Agent/skills/worktree-commit/SKILL.md`
- `$COLLAB/.openclaw_260418/workspace/AGENTS.md`
- `$COLLAB/.openclaw_260418/workspace/CORE.md`
- `$COLLAB/.openclaw_260418/workspace/skills/security-scan/references/rules.md`
- `$COLLAB/.openclaw_260418/workspace/skills/git-worktree/dist/SKILL.md`

OpenClaw is historical source material only. The active policy is `$COLLAB` centered and Vincent-owned.

## Core Rules

1. Direction agreement is not operation approval.
2. MC `tasks.json` is the canonical task source. Heptabase, Obsidian Canvas, screenshots, chat, and daily logs are mirrors or evidence, not authorities.
3. Agents must not proactively read, print, summarize, copy, or exfiltrate secrets, credentials, private keys, runtime auth files, app storage, or local databases.
4. Destructive or irreversible work requires explicit Vincent approval and a recovery plan. Prefer recoverable trash/archive over deletion.
5. Anything that leaves the machine, writes to an external service, submits a browser form, sends a message/email/post, or changes shared automation requires explicit approval.

## Tier 1: Allowed

Allowed actions may proceed when they stay inside the active task scope and have no external side effects.

| Action class | Examples | Conditions |
|---|---|---|
| `read_mc_docs_tasks_public_data` | Read `tasks.json`, specs, generated JSON, repo text. | Task relevant; no secret/auth/runtime store access. |
| `generate_local_read_model` | `npm run build`, `node scripts/generate-data.mjs`, verifier output. | Local generated artifacts only; no external API write. |
| `dry_run_or_preview` | External sync dry-run, diff preview, validation report, security scan report. | No external write; no credential content output. |
| `low_risk_local_verification` | Tests, schema validation, localhost curl. | Bounded to local repo or dev server. |
| `draft_patch_inside_active_task` | Edit docs/schema/verifier/mockups in the active task. | Vincent asked to implement; task anchor exists; diff remains reviewable. |

## Tier 2: Approval Required

Approval-required actions must stop and show the exact intended action, evidence, risk, and recovery plan when applicable.

| Action class | Examples | Required evidence |
|---|---|---|
| `task_state_mutation` | Reorder, create, update, close, or bulk change tasks. | Task id, diff preview, reason, verification plan. |
| `memory_write_or_update` | CORE, long-term memory, private/shared memory write. | Target file, exact text, reason for persistence. |
| `schedule_mutation` | Add/edit/delete cron, LaunchAgent, recurring automation. | Old state, new state, rollback path. |
| `external_sync_or_write` | Heptabase, Notion, Telegram, Obsidian API, public posting, email. | Destination, payload preview, driver, dry-run when available. |
| `third_party_repo_skill_intake` | Install skill, copy repo into workspace, add unknown dependency. | Isolation path, security-scan verdict, L1-L4 review, source/license notes. |
| `commit_push_deploy` | Git commit, push, deploy, release. | Staged paths, diff summary, verification output, message, path check. |
| `visual_layer_overwrite_or_reverse_sync` | Overwrite Canvas, refresh Heptabase, use visual layer to edit task state. | Canonical source, mirror destination, manual edit risk check. |
| `browser_submit_or_message` | Submit form, send message/email, payment, account deletion, OAuth approval. | Screenshot/page state, exact action, account/session context, risk. |

## Tier 3: Forbidden

Forbidden actions are hard stops for recommendation engine and runner.

| Action class | Examples | Reason |
|---|---|---|
| `read_or_output_secrets` | `secrets/`, `.env*`, auth profiles, runtime auth files, app storage, local DB, private keys, `~/.ssh`. | Secret contents must not be proactively read or exposed. |
| `bypass_vincent_approval` | Treat direction agreement as operation approval; execute approval-required action from recommendation alone. | Advice must not become side effects without consent. |
| `reverse_write_from_visual_or_chat` | Heptabase/Canvas/screenshot/chat to canonical task state. | MC task state owns truth. |
| `destructive_without_recovery` | `rm -rf`, bulk delete, account delete, discard data without backup. | Every step must be recoverable. |
| `history_rewrite_without_explicit_request` | `git reset --hard`, force push, rebase published branch, delete branch with unmerged work. | History is evidence and collaboration context. |
| `unreviewed_third_party_execution` | Run downloaded script, source unknown env, execute unknown postinstall. | Third-party code requires isolation, scan, and review. |

## Runner Gate

The future runner must evaluate action candidates in this order:

1. If the action class matches `forbidden`, stop.
2. If the action class matches `approval_required`, or the recommendation says `requires_approval: true`, request Vincent approval.
3. If the action class matches `allowed`, proceed only inside the active task scope.
4. If no rule matches, default to `approval_required`.

Required runner input:

- `recommendation_id`
- `suggested_action`
- `risk_level`
- `requires_approval`
- `evidence_refs`
- `suggested_task_id`

## Verification

Run:

```bash
npm run test:morrowise-approval
```

The verifier checks:

- the policy has all three tiers: `allowed`, `approval_required`, `forbidden`;
- required action classes are present;
- forbidden classes include secrets, reverse visual/chat writes, destructive work, history rewrite, and unreviewed third-party execution;
- approval-required classes include task state, memory, schedule, external sync/write, third-party intake, commit/push/deploy, visual-layer overwrite, and browser submit/message;
- the runner default policy is `approval_required`;
- no shared policy file uses hard-coded local `$COLLAB` absolute paths.

## Next Work

`morrowise-action-runner-dry-run` should consume this policy before it presents any action plan. The first runner version should be dry-run only.

# MorroWise Approval Policy

> Task: `morrowise-approval-policy` (`MC-LIVE-18`)
> Status: formal policy
> Contract: `MW-GIT-AUTH-01`
> Updated: 2026-07-28
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
6. A runner may produce a commit plan or draft patch only. Actual `git commit` must go through the `worktree-commit` confirmation gate. `push` and `deploy` require explicit Vincent approval.
7. `worktree-commit` is the only approved local commit gate. It is not just a recommendation label; it requires dirty-tree scan, per-file diff review, logical commit grouping, 4C review, path policy check, explicit Vincent confirmation, commit execution, and task-state/event follow-up.
8. Creating or switching a Git branch or linked worktree is an approval-required mutation. Dirty files, concurrent work, verification, or an implementation plan never substitute for exact Vincent approval.
9. Single-developer sequential work stays on the checked-out `main` after Repo Ready. There is no temporary or duration-based branch default. A branch/worktree may be proposed only for a named external PR/review requirement, genuinely concurrent separately owned scope, or emergency hotfix isolation, and still requires exact Vincent approval.

For MorroWise semantic task writes, approval evidence is recorded inside the latest `semantic_intake`; `reuse` remains read-only. Selecting, reframing, suspending, cancelling, or completing the single `weekly_core` slot requires a separate `weekly_core_review` approval record. An arrived review date cannot be extended by silence, scheduler behavior, or an unapproved date edit.

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
| `task_state_mutation` | Reorder, create, update, close, or bulk change tasks. | Task id, diff preview, reason, verification plan, semantic intake for MorroWise semantic writes, and weekly core review evidence when applicable. |
| `memory_write_or_update` | CORE, long-term memory, private/shared memory write. | Target file, exact text, reason for persistence. |
| `schedule_mutation` | Add/edit/delete cron, LaunchAgent, recurring automation. | Old state, new state, rollback path. |
| `external_sync_or_write` | Heptabase, Notion, Telegram, Obsidian API, public posting, email. | Destination, payload preview, driver, dry-run when available. |
| `third_party_repo_skill_intake` | Install skill, copy repo into workspace, add unknown dependency. | Isolation path, security-scan verdict, L1-L4 review, source/license notes. |
| `commit_push_deploy` | Git commit, push, deploy, release. Runner may only produce a commit plan or draft patch. | Staged paths, diff summary, verification output, message, path check. |
| `worktree_commit_gate` | Run the `worktree-commit` process for a proposed commit. | Repo, task id, dirty-tree scan, grouped scope, full diff review, 4C review, verification output, path policy check, commit message, Vincent confirmation. |
| `git_isolation_mutation` | Create/switch a branch; add/switch a linked worktree; run an equivalent script. | Named exceptional context, exact Vincent approval, repo/task, branch/worktree name and path, target main, full lifecycle and cleanup plan. Branch duration is not evidence. |
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
| `autonomous_git_isolation` | Create or switch a branch/worktree from Agent judgment, a temporary label, preflight output, dirty files, concurrency, or verification alone. | Direct checked-out `main` is the solo sequential default; only Vincent can choose an exceptional isolation lifecycle. |
| `unreviewed_third_party_execution` | Run downloaded script, source unknown env, execute unknown postinstall. | Third-party code requires isolation, scan, and review. |

## Runner Gate

The future runner must evaluate action candidates in this order:

1. If the action class matches `forbidden`, stop.
2. If the action class is `commit_push_deploy`, stop at commit plan or draft patch. Actual commit must be reclassified as `worktree_commit_gate`; push/deploy remain `commit_push_deploy` and require explicit Vincent approval.
3. If the action class is `worktree_commit_gate`, require the full `worktree-commit` evidence bundle and Vincent confirmation before any `git commit` runs.
4. If the action class is `git_isolation_mutation`, require `MW-GIT-AUTH-01` evidence before any branch/worktree creation or switching.
5. If the action class matches `approval_required`, or the recommendation says `requires_approval: true`, request Vincent approval.
6. If the action class matches `allowed`, proceed only inside the active task scope.
7. If no rule matches, default to `approval_required`.

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
- `worktree_commit_gate` exists as an approval-required class and requires the `worktree-commit` 4C evidence bundle;
- `git_isolation_mutation` requires exact Vincent approval, target `main`, and cleanup evidence;
- direct checked-out `main` is the single-developer sequential default, with no duration-based branch exception;
- autonomous branch/worktree creation or switching is forbidden;
- the runner default policy is `approval_required`;
- no shared policy file uses hard-coded local `$COLLAB` absolute paths.

## Next Work

`morrowise-action-runner-dry-run` should consume this policy before it presents any action plan. The first runner version should be dry-run only.

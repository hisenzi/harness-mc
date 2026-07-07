# JV-04 Secure Proactive Notification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete JV-04 as a safe proactive notification loop where Agent-owned code can request notifications without gaining file deletion, shell execution, or `$COLLAB` mutation power.

**Architecture:** `$COLLAB` stays in Downloads as the protected source of truth. Agent-owned code writes append-only notification data to one JSONL outbox; a trusted Notifier reads only that one file, validates schema, displays macOS notifications, and records delivered state in its own app storage. The Notifier must never execute `$COLLAB` scripts, shell, node, git, callbacks, action URLs, or write back to `$COLLAB`.

**Tech Stack:** Node.js ESM verifier/writer inside `harness-mc`; JSON registry/spec files as source of truth; Swift local Notifier source compiled with command line tools; manual single-file authorization by Vincent.

---

## Non-Negotiable Boundaries

- Do not grant `/bin/bash`, Terminal, launchd, or Codex full disk access.
- Do not move `$COLLAB` out of Downloads as a shortcut.
- Do not let launchd execute `$COLLAB/notyet-harness/schedule/dispatch.sh` for JV-04.
- Do not let the Notifier run shell, node, git, `$COLLAB` scripts, callbacks, or action URLs.
- Do not let the Notifier write back to `$COLLAB`.
- Do not close JV-04 until Vincent sees a non-manual notification and the safety verifier passes.

## Current State To Stabilize

Some first-slice files may already exist from the interrupted implementation:

- `scripts/notification-outbox.mjs`
- `scripts/verify-notification-outbox-contract.mjs`
- `system-workflow/registries/morrowise-notification-outbox-contract.json`
- `system-workflow/docs/morrowise/trusted-notifier.md`
- `package.json` script `test:notification-outbox`
- JV-04 note edits in `milestones/morrowise/tasks.json`

Do not assume they are correct. Task 1 below decides whether to keep, adjust, or replace them.

2026-07-07 update: The selected Notifier form is a small Swift local app/runner with file picker grant. The Notifier source lives at `tools/morrowise-notifier/MorroWiseNotifier.swift` and is verified by `npm run test:morrowise-notifier-source`.

---

### Task 1: Stabilize Existing JV-04 Work-In-Progress

**Files:**
- Inspect: `milestones/morrowise/tasks.json`
- Inspect: `package.json`
- Inspect: `scripts/notification-outbox.mjs`
- Inspect: `scripts/verify-notification-outbox-contract.mjs`
- Inspect: `system-workflow/registries/morrowise-notification-outbox-contract.json`
- Inspect: `system-workflow/docs/morrowise/trusted-notifier.md`

**Step 1: List current JV-04 diff only**

Run:

```bash
git diff -- milestones/morrowise/tasks.json package.json scripts/notification-outbox.mjs scripts/verify-notification-outbox-contract.mjs system-workflow/registries/morrowise-notification-outbox-contract.json system-workflow/docs/morrowise/trusted-notifier.md
```

Expected: Shows only JV-04 related changes. If unrelated edits appear, stop and separate scope before continuing.

**Step 2: Run current tests**

Run:

```bash
npm run test:notification-outbox
npm run test:notification-adapter-contract
node scripts/validate-tasks.mjs --changed-only --project morrowise
```

Expected: All pass. If any fail, fix only the JV-04 scoped files listed above.

**Step 3: Decide keep/adjust**

Keep the current first-slice implementation only if it satisfies:

- Writer is append-only.
- Contract rejects command/script/action/path fields.
- Notifier spec forbids shell/node/git/`$COLLAB` writes/deletes.
- JV-04 remains `in_progress`.

No commit yet unless Vincent explicitly asks for commit.

---

### Task 2: Finalize Outbox Contract

**Files:**
- Modify: `system-workflow/registries/morrowise-notification-outbox-contract.json`
- Modify: `scripts/verify-notification-outbox-contract.mjs`

**Step 1: Write/confirm failing contract checks**

The verifier must fail if:

- `command`, `script_path`, `action_url`, `delete_path`, or unknown fields are accepted.
- `title` exceeds 80 chars.
- `body` exceeds 240 chars.
- `level` is outside `info | watch | amber | red`.
- TTL is below 60 or above 86400 seconds.
- Notifier boundary lacks explicit bans on shell/node/git/`$COLLAB` write/delete.

Run:

```bash
npm run test:notification-outbox
```

Expected before implementation: FAIL for missing or incomplete contract checks.

**Step 2: Implement minimal contract**

Update the contract so it defines:

- Outbox path: `$COLLAB/notyet-harness/schedule/outbox/notifications.jsonl`
- Schema version: `notification.v0`
- Allowed fields: `schema_version`, `id`, `level`, `title`, `body`, `created_at`, `ttl_seconds`, `dedupe_key`, `source`, `task_anchor`
- Forbidden fields: command/script/shell/action/path/callback-like fields
- Rate limit: default 3 per minute; overflow becomes one merged digest
- Delivered state: `$HOME/Library/Application Support/MorroWiseNotifier/delivered.sqlite`

**Step 3: Run contract verifier**

Run:

```bash
npm run test:notification-outbox
```

Expected: PASS.

---

### Task 3: Finalize Append-Only Writer

**Files:**
- Modify: `scripts/notification-outbox.mjs`
- Modify: `scripts/verify-notification-outbox-contract.mjs`

**Step 1: Verify writer tests cover behavior**

The verifier must prove:

- `appendNotification()` appends JSONL, not rewrite.
- Invalid payload throws before writing.
- CLI can queue a notification without sending it.
- Writer does not import or call `child_process`.
- Writer does not call `osascript`, `notify.sh`, `launchctl`, `git`, or shell.

Run:

```bash
npm run test:notification-outbox
```

Expected before any missing coverage is fixed: FAIL if these checks are absent.

**Step 2: Implement minimal writer behavior**

Writer responsibilities only:

- Build notification object.
- Validate schema.
- Create outbox directory if missing.
- Append one JSONL line.

Writer forbidden behavior:

- No delivery.
- No shell.
- No deletion.
- No delivered mark.

**Step 3: Run verifier**

Run:

```bash
npm run test:notification-outbox
```

Expected: PASS.

---

### Task 4: Define Trusted Notifier Implementation Choice

**Files:**
- Modify: `system-workflow/docs/morrowise/trusted-notifier.md`
- Modify: `system-workflow/registries/morrowise-notification-outbox-contract.json`
- Do not implement app code until Vincent chooses the runtime form.

**Step 1: Document accepted implementation forms**

Chosen form:

- Small Swift local app/runner that reads only the outbox file selected by Vincent through a file picker.

Rejected choices:

- launchd running `/bin/bash`.
- launchd running `$COLLAB` scripts.
- Automator/Shortcut that accepts arbitrary shell command.
- Any runner that receives command/path/action fields from the outbox.

**Step 2: Add manual authorization checklist**

The spec must say:

- Vincent grants read access to one file only.
- Delivered state is stored outside `$COLLAB`.
- If a tool asks for folder-wide Downloads access, stop.

**Step 3: Verify spec**

Run:

```bash
npm run test:notification-outbox
```

Expected: PASS and spec contains the required restrictions.

---

### Task 5: Queue A Safe Test Notification

**Files:**
- Runtime output: `$COLLAB/notyet-harness/schedule/outbox/notifications.jsonl`
- Do not modify source files except the append-only outbox line.

**Step 1: Queue a test notification**

Run:

```bash
node scripts/notification-outbox.mjs \
  --id jv04-manual-outbox-test \
  --level amber \
  --title "MorroWise" \
  --body "JV-04 outbox test" \
  --source manual \
  --task-anchor '$COLLAB/harness-mc/milestones/morrowise/tasks.json#notification-first-delivery'
```

Expected: `notification queued: jv04-manual-outbox-test`

**Step 2: Inspect the outbox**

Run:

```bash
tail -n 3 "$COLLAB/notyet-harness/schedule/outbox/notifications.jsonl"
```

Expected: Last line is valid `notification.v0` JSON and contains no command/script/action/path fields.

**Step 3: Verify again**

Run:

```bash
npm run test:notification-outbox
```

Expected: PASS.

---

### Task 6: Install / Authorize Trusted Notifier

**Files:**
- Local app/Shortcut outside repo: chosen by Vincent.
- Delivered state: `$HOME/Library/Application Support/MorroWiseNotifier/delivered.sqlite`
- Source spec remains: `system-workflow/docs/morrowise/trusted-notifier.md`

**Manual Vincent step required**

Vincent grants the Notifier read access to the single outbox file:

`$COLLAB/notyet-harness/schedule/outbox/notifications.jsonl`

Stop if macOS asks for:

- Full Disk Access
- Downloads folder-wide access
- Terminal or `/bin/bash` access
- permission to execute scripts

**Acceptance**

Notifier can read the outbox and display a notification. It cannot write to `$COLLAB`.

---

### Task 7: End-To-End JV-04 Acceptance

**Files:**
- Modify only after acceptance: `milestones/morrowise/tasks.json`

**Step 1: Queue a non-manual/system notification**

Use the writer from a MorroWise-owned script or a controlled manual simulation with `source=system-pulse-fixture`. The payload must still be data only.

**Step 2: Vincent observes notification**

Acceptance requires Vincent to confirm the macOS notification appeared without clicking a manual delivery command.

**Step 3: Check safety invariant**

Run:

```bash
npm run test:notification-outbox
git diff -- "$COLLAB"
```

Expected:

- `test:notification-outbox` PASS.
- No Notifier write-back to `$COLLAB`.
- Delivered mark exists only in Notifier storage.

**Step 4: Close JV-04**

Only after the above:

- Set `notification-first-delivery.status` to `completed`.
- Set `completed_at`.
- Add `summary`.
- Add commit hash after commit exists.

Run:

```bash
node scripts/validate-tasks.mjs --changed-only --project morrowise
```

Expected: PASS.

---

## Final Verification Bundle

Before claiming JV-04 complete:

```bash
npm run test:notification-outbox
npm run test:notification-adapter-contract
node scripts/validate-tasks.mjs --changed-only --project morrowise
```

And manual evidence:

- Vincent saw the notification.
- Notifier did not request broad permission.
- Notifier did not write to `$COLLAB`.

## Current Recommendation

Continue only with the selected small local app/runner with file picker grant. Do not reopen Shortcut or launchd alternatives unless Vincent explicitly changes the decision.

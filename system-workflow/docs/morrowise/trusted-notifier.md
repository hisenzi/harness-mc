# MorroWise Trusted Notifier Boundary

Source of truth: `$COLLAB/harness-mc/system-workflow/registries/morrowise-notification-outbox-contract.json`

Task anchor: `$COLLAB/harness-mc/milestones/morrowise/tasks.json#notification-first-delivery`

## Purpose

The trusted Notifier exists to display local proactive notifications without turning a background runner into an Agent privilege amplifier.

Agent-owned code may only append notification data to the outbox. The Notifier consumes that data and displays a macOS notification after schema validation.

## Chosen Implementation

Use a small local app with a file picker grant.

Vincent selects exactly one outbox file:

`$COLLAB/notyet-harness/schedule/outbox/notifications.jsonl`

The app stores that selected-file permission in its own app storage. It must not request folder-wide Downloads access, Full Disk Access, Terminal access, `/bin/bash` access, or permission to execute scripts.

## Allowed

- Reads one Vincent-approved outbox file.
- Validates `notification.v0` JSONL entries.
- Applies TTL, dedupe, rate limit, and merge rules.
- Displays macOS notifications.
- Writes delivered marks to its own app storage.

## Forbidden

- Never runs shell.
- Never runs node.
- Never runs git.
- Never runs `$COLLAB` scripts.
- Never writes back to `$COLLAB`.
- Never deletes files.
- Never mutates source files.
- Never accepts command, script, callback, path, or action URL fields from notification payloads.

## Authorization Rule

Vincent may authorize the Notifier to read the single outbox file only. Do not authorize `/bin/bash`, Terminal, launchd, or a broad directory grant as a substitute for this Notifier boundary.

## Delivery State

Delivered marks belong in:

`$HOME/Library/Application Support/MorroWiseNotifier/delivered.sqlite`

They must not be written to `$COLLAB`, because write-back would convert the Notifier from a display-only reader into a shared-source mutator.

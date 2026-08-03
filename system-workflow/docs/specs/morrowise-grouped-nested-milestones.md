# MorroWise Grouped Nested Milestones v1

Owner task：`$COLLAB/harness-mc/milestones/morrowise/tasks.json#grouped-nested-milestone-support-v1`

## Canonical layout

- Flat v1 remains valid：`milestones/<project-id>/project.json|tasks.json|state.json`.
- Grouped v1：`milestones/<group>/<yymmdd>-<project-id>/project.json|tasks.json|state.json`.
- A group is valid only when `milestones/<group>/group.json` conforms to `morrowise.milestone-group.v1`.
- Grouped project depth is exactly one; project ID is globally unique across flat and grouped layouts.

## Identity and public refs

Grouped `project.json` must contain a `milestone` object whose `layout`、`project_id`、`group`、`folder_date` and `$COLLAB`-relative `relative_ref` match the directory. Generated read models expose `project=<project-id>`、`group` and `milestone_ref`; they never expose local absolute paths and never become task state truth.

## Write order

`project-init` validates slug、group marker、calendar-valid 20YY `yymmdd`、global duplicate ID and path containment before topology admission. Non-dry writes may start only after admission; dry-run never creates directories、sync events、repos or generated files. Repository creation remains separately gated by an exact Vincent receipt.

## Discovery and mutation

All general project consumers use `scripts/lib/milestone-projects.mjs`. `event.project` and CLI `--project` always mean the global project ID, never a folder basename or group. Task mutations remain governed by JV-40 and write only the resolved canonical tasks/state files.

## Fail-closed conditions

Unknown/invalid group marker、invalid date/folder metadata、duplicate global project ID、nested project below the allowed depth、absolute/path-escape candidate or ambiguous identity must exit non-zero before any project write.

# JV-33 CC本機協作_無Git 資料治理與固定備份規格

> Status: spec
> Owner: MorroWise
> Anchor task: `$COLLAB/harness-mc/milestones/morrowise/tasks.json#local-nongit-data-backup-spec`
> Scope root: `$COLLAB/CC本機協作_無Git`
> Inventory date: 2026-07-09
> Source boundary: This document defines governance, backup gates, and health metadata. It does not move files, run rsync, install launchd jobs, or create future tasks.

## 1. Execution Boundary

JV-33 is a Roadmap-in-Anchor Task. It records the full plan but only this anchor task exists now.

Allowed in JV-33:

- Read-only inventory of folder names, file counts, directory counts, sizes, mtimes, cache/temp/log/build-like names, and suspicious sensitive-name hit counts.
- Backup governance specification.
- Future slice definitions using `JV-33.Rn`.
- Task note/status updates for this anchor.

Forbidden in JV-33:

- Moving, deleting, renaming, or reorganizing files under `$COLLAB/CC本機協作_無Git`.
- Writing backup scripts.
- Running rsync backup jobs.
- 不允許 --delete。
- Installing or loading launchd jobs.
- Creating future tasks for JV-33.R1~R4 before Vincent explicitly approves implementation.

## 2. R1 Read-Only Inventory

Inventory method: metadata-only `lstat` and `readdir`. No file content was opened. Suspicious sensitive filenames were counted but not emitted.

| Metric | Value |
| --- | ---: |
| Total size | 355.70 GB |
| Files | 308,522 |
| Directories | 29,158 |
| Media-like files | 120,604 |
| Document-like files | 9,771 |
| Cache/temp/log/build-like name hits | 54,468 |
| Suspicious sensitive-name hits | 560 |
| Latest mtime | 2026-07-09 |
| Scan errors | 0 |

Top-level inventory:

| Path under scope root | Size | Files | Dirs | Media files | Cache-like hits | Sensitive-name hits | Initial tier |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `01_照片整理區` | 135.73 GB | 11,396 | 203 | 9,178 | 8 | 0 | MIRROR |
| `00_Creative_Tools` | 129.79 GB | 216,905 | 16,421 | 80,460 | 33,834 | 296 | MIRROR with QUARANTINE subpaths |
| `House123_人生房產全修班` | 24.13 GB | 347 | 49 | 292 | 0 | 0 | MIRROR |
| `250826_Fonts_王明嘉字卡120` | 17.04 GB | 18,292 | 591 | 1,375 | 202 | 5 | MIRROR with review |
| `02_筆記整理_Heptabase` | 15.32 GB | 6,825 | 661 | 5,438 | 0 | 0 | SNAPSHOT |
| `整理Download` | 14.83 GB | 19,372 | 4,006 | 8,263 | 19,168 | 96 | QUARANTINE first |
| `04_雜項分類整理` | 11.40 GB | 4,186 | 634 | 2,395 | 921 | 1 | QUARANTINE first |
| `maxmodel` | 2.90 GB | 1,161 | 236 | 949 | 5 | 0 | SNAPSHOT |
| `六年一貫_自然科複習自學系統` | 1.61 GB | 342 | 34 | 149 | 0 | 0 | SNAPSHOT |
| `03_第二大腦知識庫整理` | 1.00 GB | 324 | 54 | 282 | 0 | 2 | SNAPSHOT |
| `site-www.house123.com.tw-20250723-153138cst` | 0.76 GB | 27,956 | 5,962 | 11,160 | 325 | 157 | QUARANTINE first |
| Small client/project folders | < 0.50 GB each | mixed | mixed | mixed | low | low | SNAPSHOT |

Large subpath observations:

- `01_照片整理區/Mac_Win_Photo待整理` is 52.63 GB and contains mostly media. Treat as non-reproducible until backed up and restore-tested.
- `01_照片整理區/99_360_照片_集中區` is 29.49 GB. Treat as non-reproducible until backed up and restore-tested.
- `01_照片整理區/250913_Photos_iPhone15` is 24.67 GB. Treat as non-reproducible until backed up and restore-tested.
- `00_Creative_Tools/01_圖庫` is 58.78 GB with 135,984 files. Mirror first, but later review duplicate/cache pressure.
- `00_Creative_Tools/Sample` is 51.44 GB. Mirror first because it is asset-like, then review whether it contains replaceable sample packs.
- `00_Creative_Tools/Website_Tools` is only 4.56 GB but has 33,633 cache-like hits and 268 sensitive-name hits. It must not become the first backup quality benchmark.
- `整理Download/250806_Joomla_3升5級相關檔案_temp` is 2.64 GB with 19,152 cache-like hits and 95 sensitive-name hits. Quarantine first.
- `site-www.house123.com.tw-20250723-153138cst` has many web/runtime-like directories and 157 sensitive-name hits. Quarantine first; do not inspect or emit sensitive filenames in shared docs.

## 3. Data Tiers

### MIRROR

Use for large, low-churn, non-reproducible or asset-like data. Desired future behavior is a one-to-one target copy, but first backup must still be no-delete.

Initial MIRROR candidates:

- `01_照片整理區`
- `00_Creative_Tools`, except cache/runtime-like subpaths
- `House123_人生房產全修班`
- `250826_Fonts_王明嘉字卡120`, after sensitive-name review by count only

### SNAPSHOT

Use for changing project/knowledge folders where dated retention and restore history matter.

Initial SNAPSHOT candidates:

- `02_筆記整理_Heptabase`
- `03_第二大腦知識庫整理`
- `maxmodel`
- `KJ`
- `FJ`
- `JPmodel`
- `Roger`
- `maminshan`
- `森之設計`
- `00_HiSenzi`
- `六年一貫_自然科複習自學系統`
- other small active project folders

### QUARANTINE

Use for mixed, temporary, duplicated, runtime-like, or review-needed folders. Quarantine means "do not delete"; it means the first backup policy is conservative and separated from clean mirror/snapshot lanes. Future cleanup candidates must be moved into `90_QUARANTINE_待判斷可刪/`, not deleted by rsync or automation.

Initial QUARANTINE candidates:

- `整理Download`
- `04_雜項分類整理`
- `site-www.house123.com.tw-20250723-153138cst`
- cache/temp/log/build/runtime-like subpaths under otherwise useful folders
- folders or files with suspicious sensitive-name hits, without exposing names
- future cleanup candidates under `90_QUARANTINE_待判斷可刪/`

### NO_BACKUP

NO_BACKUP can only be assigned after Vincent approval or when a future verifier proves the path is reproducible cache/build output. In JV-33, no existing user data is assigned permanent NO_BACKUP. When in doubt, place the path under `90_QUARANTINE_待判斷可刪/` for human review instead of deleting or silently excluding it.

Default NO_BACKUP candidates for future dry-run only:

- `.DS_Store`
- cache/temp/log/build output that can be regenerated
- package caches or dependency folders, if present and proven reproducible

## 4. First Backup Gate

The first backup must use a no-delete sequence:

1. Disk qualification.
2. rsync dry-run；不允許 --delete。
3. no-delete actual backup.
4. manifest/log generation.
5. restore drill.

Forbidden in first backup:

- 不允許 --delete
- overwriting-only assumptions without manifest evidence
- using hard-link snapshots before target disk support is proven
- excluding quarantine paths silently

The first backup output must include:

- backup run id
- source root
- target disk label or safe disk id
- target mount path
- strategy summary by tier
- started_at and finished_at
- dry_run status
- actual no-delete status
- file count and byte count copied or skipped
- log path
- manifest path
- excluded/quarantined path count
- restore drill status

## 5. Disk Qualification

A target disk is eligible only if all checks pass:

| Check | Requirement |
| --- | --- |
| Mounted | target path exists under `/Volumes` or an approved mount path |
| Writable | a future script can create and remove a probe file in a dedicated test directory |
| Capacity | free space must cover first full backup plus reserve; current source is 355.70 GB, so minimum practical target is 1 TB, recommended 2 TB |
| Filesystem | must preserve filenames and mtimes correctly |
| Hard-link probe | required before enabling `--link-dest` snapshot mode |
| Safety | target must not be the source root or a child of the source root |
| Identity | log safe disk label/id, but do not log private volume contents |

If hard-link probe fails, snapshot mode must degrade to no-link dated copies or mirror-only until a supported disk is chosen.

## 6. Restore Drill

Restore drill is required before JV-33.R2 can be considered successful.

Minimum sample set:

- one photo/media subset from `01_照片整理區`
- one creative asset subset from `00_Creative_Tools`
- one small project or note subset from SNAPSHOT candidates

Verification method:

- Prefer checksum for small files.
- Use size + mtime comparison for large media when checksum cost is high.
- Record sample path category, not sensitive filenames.

Passing restore drill requires:

- restore target is outside source root and outside backup root
- restored sample count matches manifest
- checksum or size/mtime comparison passes
- no restore sample requires reading secrets or auth content

## 7. Quarantine Review Gate

不允許 --delete。Backup jobs must not use rsync deletion as a cleanup mechanism.

Cleanup candidates follow a quarantine-first sequence:

1. No-delete dry-run passed.
2. No-delete actual backup passed.
3. Manifest/log exists.
4. Restore drill passed.
5. Move table or final tier map is reviewed.
6. Candidate cleanup paths are moved only into `90_QUARANTINE_待判斷可刪/` by a future explicitly approved implementation task.
7. Human review happens after quarantine; automated backup logic still does not delete.

Before human review, health state should be `quarantine_pending_review`, not `failed`.

## 8. Future Fixed Backup Design

Fixed backup should eventually inherit the proven v4 pattern: mount check, same-day duplicate guard, log, manifest, notification, failure codes, and retention.

Desired future trigger model:

- weekly launchd schedule
- insert-disk trigger or mount-path watcher
- no run when target disk is absent; emit `no_target_disk`
- no run when last successful backup is fresh enough; emit `skipped_fresh`

JV-33 does not implement these triggers.

## 9. MorroWise Health Metadata Boundary

MorroWise may only read safe metadata produced by a future backup manifest/log. MorroWise must not execute rsync, launchd, shell backup commands, file moves, quarantine moves, or deletes.

Allowed metadata:

- `last_success_at`
- `last_attempt_at`
- `last_restore_drill_at`
- `target_disk_label`
- `strategy_summary`
- `state`
- `next_action`
- `source_total_gb`
- `manifest_ref`
- `log_ref`
- `failure_code`

Forbidden metadata:

- file contents
- secret values
- full sensitive filename lists
- credentials
- tokens
- private keys
- runtime auth files
- personal browser/profile state

Failure states:

- `no_target_disk`
- `disk_not_supported`
- `dry_run_failed`
- `backup_failed`
- `restore_unverified`
- `stale_backup`
- `quarantine_pending_review`

## 10. MC Dashboard Future Surface

MC may later add a read-only status card. It is a surface, not the backup source of truth and not an execution button.

Future card fields:

- `state`
- `last_success_at`
- `last_restore_drill_at`
- `target_disk`
- `strategy_summary`
- `next_action`

The MC surface must not list private paths beyond tier-level or redacted path labels.

## 11. Roadmap Slices

Future slices remain note-only until split gate passes.

| Slice | Purpose | Input | Output | Split gate |
| --- | --- | --- | --- | --- |
| `JV-33.R1` | Read-only inventory | `$COLLAB/CC本機協作_無Git` | inventory manifest, tier proposal, quarantine/exclude candidate list, sensitive-name redaction report | Already executed as metadata-only inventory in this spec |
| `JV-33.R2` | no-delete first backup + restore drill | confirmed target disk and R1 manifest | no-delete backup log, manifest, restore-drill evidence | Vincent approves implementation and target disk |
| `JV-33.R3` | backup health read model + notification loop | backup manifest/log | `local-backup-health.json`, failure mapping, notification rules | R2 evidence exists; MorroWise reads metadata only |
| `JV-33.R4` | MC dashboard read-only surface | `local-backup-health.json` | MC status card with safe metadata | R3 read model exists and has verifier |

When a slice becomes an implementation task, it must receive the next available `JV-xx` at that time and record:

- `origin_anchor=JV-33`
- `origin_slice=JV-33.Rn`
- `origin_task_id=local-nongit-data-backup-spec`

Roadmap placeholders must never reserve bare future `JV-xx` ids.

## 12. Acceptance Matrix

| ID | Requirement | Evidence |
| --- | --- | --- |
| A01 | Read-only inventory only; no file content opened | Inventory method and metrics in section 2 |
| A02 | Data tiers define MIRROR, SNAPSHOT, QUARANTINE, NO_BACKUP | Section 3 |
| A03 | First backup is no-delete dry-run -> no-delete actual -> manifest/log | Section 4 |
| A04 | Hard-link snapshot requires disk qualification | Section 5 |
| A05 | Restore drill is mandatory | Section 6 |
| A06 | Cleanup candidates use quarantine review；不允許 --delete | Section 7 |
| A07 | Fixed backup ideal state is defined but not implemented | Section 8 |
| A08 | MorroWise only reads health metadata | Section 9 |
| A09 | MC dashboard is future read-only surface | Section 10 |
| A10 | Failure states are listed | Section 9 |
| A11 | Roadmap-in-Anchor numbering is preserved | Section 11 |

# MorroWise Dev Workflow Source Map

Status: intake map
Owner task: `$COLLAB/harness-mc/milestones/morrowise/tasks.json#morrowise-dev-workflow-catalog`
Scanned: 2026-07-08

## Boundary

`$COLLAB/.tmp/skills-main/docs` and `$COLLAB/.tmp/skills-main/skills` are intake evidence only, not source of truth. The durable MorroWise source of truth is the catalog registry, schema, verifier, generated read model, and Architecture Admission Record under `$COLLAB/harness-mc`.

This map records what was evaluated. It does not install skills and does not authorize external writes.

## Intake Sources

| Source | Role | Status |
| --- | --- | --- |
| `$COLLAB/.tmp/skills-main/docs/engineering/ask-matt.md` | Router over the external workflow set | accepted as routing pattern |
| `$COLLAB/.tmp/skills-main/docs/productivity/grill-me.md` | Stateless pre-build interview | accepted as pre-workflow stress test |
| `$COLLAB/.tmp/skills-main/docs/engineering/grill-with-docs.md` | Stateful workflow start with docs | accepted as formal start pattern |
| `$COLLAB/.tmp/skills-main/docs/engineering/domain-modeling.md` | Domain vocabulary and ADR discipline | accepted as governance support |
| `$COLLAB/.tmp/skills-main/docs/engineering/to-prd.md` | Settled context to PRD | accepted with MorroWise artifact boundary |
| `$COLLAB/.tmp/skills-main/docs/engineering/to-issues.md` | PRD to issue tracker tickets | adapter_only because GitHub Issues is not MorroWise canonical state |
| `$COLLAB/.tmp/skills-main/docs/engineering/implement.md` | Build from settled issue/spec | accepted as execution pattern |
| `$COLLAB/.tmp/skills-main/docs/engineering/tdd.md` | Test-first implementation loop | accepted as verifier-backed pattern |
| `$COLLAB/.tmp/skills-main/docs/engineering/code-review.md` | Review against standards and spec | accepted as closeout support |
| `$COLLAB/.tmp/skills-main/docs/engineering/diagnosing-bugs.md` | Repro-first bug diagnosis | accepted as incident workflow |
| `$COLLAB/.tmp/skills-main/docs/engineering/research.md` | Primary-source research artifact | accepted as research intake pattern |
| `$COLLAB/.tmp/skills-main/docs/engineering/prototype.md` | Throwaway prototype to answer a question | prototype status only |
| `$COLLAB/.tmp/skills-main/docs/engineering/improve-codebase-architecture.md` | Codebase health survey | accepted as periodic governance pattern |
| `$COLLAB/.tmp/skills-main/docs/engineering/triage.md` | External issue triage state machine | adapter_only because external tracker writes need approval |
| `$COLLAB/.tmp/skills-main/docs/engineering/resolving-merge-conflicts.md` | Intent-based conflict resolution | deferred until a merge workflow owner exists |
| `$COLLAB/notyet-harness/000_Agent/skills/worktree-commit/SKILL.md` | Internal commit and task-state closeout authority | accepted as closeout-commit-routing; implementation done must still pass verification, cc-log when needed, worktree-commit, and task completion evidence |

## Internal Closeout Source

`closeout-commit-routing` is not imported from `$COLLAB/.tmp/skills-main`. It is a MorroWise internal route that connects JV-32 to existing closeout skills:

- `$COLLAB/notyet-harness/000_Agent/skills/verification-before-completion/SKILL.md`
- `$COLLAB/notyet-harness/000_Agent/skills/cc-log/SKILL.md`
- `$COLLAB/notyet-harness/000_Agent/skills/worktree-commit/SKILL.md`

This keeps JV-32 as the workflow router while preserving `worktree-commit` as the commit authority.

## MorroWise Native Lifecycle Source

`task-lifecycle` 不是從 `$COLLAB/.tmp/skills-main` 匯入。它是 JV-32 的內建 canonical task mutation route，正本規格位於 `$COLLAB/harness-mc/system-workflow/docs/specs/morrowise-task-lifecycle.md`，並以 task lifecycle schema、task validator、task write command map 與 approval policy 共同驗證。它涵蓋 create、amend、suspend、resume、complete、cancel、archive；外部 tracker 仍只能是 adapter_only。若 mutation 是既有 promoted JV-32 的 version improvement，還必須更新既有 Architecture Admission Record 的 version review，並以受控 sync 檢查 ARCHITECTURE.md 薄索引。

## Exclusions

| Exclusion ID | Source | Reason |
| --- | --- | --- |
| `setup-matt-pocock-skills` | `$COLLAB/.tmp/skills-main/docs/engineering/setup-matt-pocock-skills.md` | setup/installer flow; excluded because JV-32 forbids installer execution, `link-skills.sh`, hook mutation, issue tracker configuration, secrets, and external writes. |
| `git-guardrails-claude-code` | `$COLLAB/.tmp/skills-main/skills/misc/git-guardrails-claude-code/scripts/block-dangerous-git.sh` | hook/security script; excluded from runtime because hooks_modify is out of scope and needs a separate approval policy. |
| `in-progress-skills` | `$COLLAB/.tmp/skills-main/skills/in-progress/*` | in-progress skills are not stable workflow inputs for MorroWise catalog v0. |
| `deprecated-skills` | `$COLLAB/.tmp/skills-main/skills/deprecated/*` | deprecated skills are not promoted into MorroWise workflow routing. |

## Safety Notes

- Do not run `$COLLAB/.tmp/skills-main/scripts/link-skills.sh`.
- Do not run installers, hook setup, or package-manager install commands from the intake repo.
- Do not read secrets, token stores, cookies, runtime auth files, `.env`, or issue tracker credentials.
- Do not write GitHub Issues, GitLab Issues, Notion, Heptabase, or any external tracker from this catalog.
- Any future external adapter must go through a separate approval policy and must keep MorroWise canonical state in `tasks.json`, registries, verifiers, and generated read models.

# MorroWise Dev Workflow Catalog

Status: governed catalog v0
Owner task: `$COLLAB/harness-mc/milestones/morrowise/tasks.json#morrowise-dev-workflow-catalog`
Registry: `$COLLAB/harness-mc/system-workflow/registries/morrowise-dev-workflow-catalog.json`

## Purpose

The catalog turns useful external software-development workflow patterns into MorroWise-governed routes. It is not a skill installer and not an issue tracker integration. The catalog answers: when a development situation appears, which workflow route should MorroWise recommend, what may it write, what evidence closes it, and which verifier proves the route is safe.

## Workflow Lifecycle

1. Intake evidence lives in `$COLLAB/.tmp/skills-main/docs` and `$COLLAB/.tmp/skills-main/skills`.
2. Durable workflow definitions live in the machine-readable registry.
3. The generator creates `$COLLAB/harness-mc/public/data/morrowise-dev-workflows.json`.
4. The router consumes the read model as a read-only surface.
5. A workflow can close only through its `close_rule`; chat-only completion is not enough.

## Router Rules

- `ask-matt` is a router pattern, not an executor.
- `grill-me` is a pre-workflow stress test because it is stateless.
- `grill-with-docs` is the formal workflow start because it leaves durable artifacts.
- `to-issues` and `triage` are `adapter_only` when they imply external issue tracker writes.
- `prototype` remains prototype status until its answer is captured into a durable MorroWise artifact.
- `resolving-merge-conflicts` is deferred until MorroWise has a merge-operation owner and verification boundary.

## Workflow Coverage

| Workflow | Catalog stance |
| --- | --- |
| `ask-matt` | Accepted as workflow router. |
| `grill-me` | Accepted as pre-workflow stress test. |
| `grill-with-docs` | Accepted as formal workflow start. |
| `domain-modeling` | Accepted for vocabulary and ADR discipline. |
| `to-prd` | Accepted for settled context to durable PRD/spec. |
| `to-issues` | `adapter_only`; external issue semantics cannot own MorroWise state. |
| `implement` | Accepted for build execution from settled task/spec. |
| `tdd` | Accepted for test-first implementation loop. |
| `code-review` | Accepted for review and closeout support. |
| `diagnosing-bugs` | Accepted for repro-first incident diagnosis. |
| `research` | Accepted for primary-source research artifact. |
| `prototype` | Prototype status only until captured into durable verdict. |
| `improve-codebase-architecture` | Accepted for governance and architecture health review. |
| `triage` | `adapter_only`; external tracker state must remain outside MorroWise truth. |
| `resolving-merge-conflicts` | Deferred until explicit merge owner and verifier boundary exist. |

## Adapter Only Boundary

`adapter_only` means the external concept may be useful, but MorroWise does not let it own state. GitHub Issues, GitLab Issues, external trackers, hooks, installers, and runtime credentials must not become source of truth. MorroWise source of truth remains `tasks.json`, registries, docs, verifier output, generated read models, and explicit Vincent decisions.

## Closeout Rules

Every workflow must name a `close_rule`. A close rule must point to durable evidence such as a PRD, issue brief, test run, generated read model, verifier output, review note, ADR, or task-state update. A workflow with no close rule is invalid.

## Architecture Boundary

`ARCHITECTURE.md` is an index, not the catalog. Architecture Admission Record lives in `$COLLAB/harness-mc/system-workflow/registries/morrowise-architecture-subsystems.json`. The generated architecture block may point to this detail doc and registry after promotion, but it must not copy the catalog details.

## Forbidden Actions

- Execute `$COLLAB/.tmp/skills-main/scripts/link-skills.sh`.
- Run installers or setup scripts from the intake repo.
- Modify hooks or git guardrails.
- Write `.env`, GitHub secrets, issue tracker config, or runtime auth.
- Read secrets, tokens, cookies, browser auth, or runtime credential stores.
- Write external issue trackers without a separate approval policy.

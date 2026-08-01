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
6. Completed work routes through `closeout-commit-routing` before task completion is claimed.

`source_doc` and `source_skill` are provenance metadata, not build dependencies. The verifier always requires safe `$COLLAB/...` syntax without path traversal; it requires a path to resolve only when the normalized reference is owned by `$COLLAB/harness-mc`. Cross-repo or local intake evidence may be unavailable in an isolated single-repo build, and its absence must not make CI claim that the catalog itself is invalid.

The Architecture Admission version review records `$COLLAB/harness-mc/package.json#jv32-prebuild-contract`, not the whole manifest. This fragment fingerprints only the required JV-32 prebuild commands—generate the workflow read model, verify the catalog, then generate the live dashboard—in their effective order. Unrelated scripts or package metadata must not make the catalog review stale; removing, renaming, or reordering a required command must still fail the verifier.

## Harness / Loop Control Boundary

The formal boundary lives in `$COLLAB/harness-mc/system-workflow/schemas/morrowise-dev-workflow.schema.json#/$defs/control_plane_contract` and is registered once in `control_plane_contract`. It is an extension of this catalog, not a second loop or task system.

- Harness is a mechanism provider. It may provide context management, tool execution, sandbox and permission enforcement, persistence, observability, error recovery, and a retry mechanism.
- Harness must not choose the trigger, objective, discovery order, priority, verification gate, retry decision, memory writeback, escalation, terminal state, or resource budget.
- Loop is the policy controller. Every governed Loop Spec must explicitly declare trigger, objective, input state, discovery and prioritization policies, execution roles, context policy, verification policy, retry policy, memory writeback, escalation conditions, terminal states, and time／Token／retry／risk budgets.
- Loop policy cannot bypass sandbox, permission, tool, or context boundaries supplied by the Harness.
- A Loop terminal state is not a canonical task status mutation. `DONE_VERIFIED` still requires fresh evidence, while task completion remains governed by JV-40 lifecycle and Vincent approval.

`morrowise-live-decision-loop-v1` is the first planned binding to `#/$defs/loop_policy_contract`. The binding does not claim its runtime, budget values, verifier evidence, or P3 E2E are complete.

## Router Rules

- `ask-matt` is a router pattern, not an executor.
- `grill-me` is a pre-workflow stress test because it is stateless.
- `grill-with-docs` is the formal workflow start because it leaves durable artifacts.
- `to-issues` and `triage` are `adapter_only` when they imply external issue tracker writes.
- `task-lifecycle` 是新增、語意修改、暫緩、恢復、完成、取消與封存 canonical task 的內建 route；它用 semantic intake 固定 `reuse|amend|replace|genuinely_new`，並機械限制單一 weekly core 與 review date，不建立第二套 task system。
- `prototype` remains prototype status until its answer is captured into a durable MorroWise artifact.
- `resolving-merge-conflicts` is deferred until MorroWise has a merge-operation owner and verification boundary.
- `closeout-commit-routing` is the closeout route: verified work goes through `verification-before-completion`, optional `cc-log`, then one full-delivery authorization carries C1, canonical closeout, MC dashboard refresh, C2, and the read-only Terminal Gate.

### Roadmap Placeholder Rules

Roadmap placeholder labels must not use bare future `JV-xx` numbers. Use anchor-relative labels such as `ANCHOR.R1`, `ANCHOR.R2`, and keep them inside the anchor task note/spec until they are split. When a slice becomes a real task, assign the next available `JV-xx` at that time and record `origin_anchor` plus `origin_slice` on the new task.

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
| `task-lifecycle` | Accepted canonical task mutation gate; task state stays in MC and every mutation needs append-only evidence. |
| `resolving-merge-conflicts` | Deferred until explicit merge owner and verifier boundary exist. |
| `closeout-commit-routing` | Accepted as the implementation-to-commit closeout route. |

## Adapter Only Boundary

`adapter_only` means the external concept may be useful, but MorroWise does not let it own state. GitHub Issues, GitLab Issues, external trackers, hooks, installers, and runtime credentials must not become source of truth. MorroWise source of truth remains `tasks.json`, registries, docs, verifier output, generated read models, and explicit Vincent decisions.

## Canonical Task Lifecycle

`task-lifecycle` 將 canonical task mutation 接入 JV-32。MorroWise 新建或語意變更 task 必須在最新 event 記錄四維 scope comparison、canonical task refs、固定 intake outcome 與 Vincent approval；`reuse` 不寫正本。每次最多一個 `weekly_core: true`，且必須有未到期 review date；到期只能由 Vincent 明確核准 reframe、suspend、cancel 或 complete。停用不得使用模糊 `disabled`，而是明確使用 `deferred`、`cancelled` 或 `archived`；完成仍必須走下方的 `closeout-commit-routing`。完整欄位、狀態語意與 cross-repo boundary 見 [MorroWise Canonical Task Lifecycle](morrowise-task-lifecycle.md)。

## Closeout Rules

Every workflow must name a `close_rule`. A close rule must point to durable evidence such as a PRD, issue brief, test run, generated read model, verifier output, review note, ADR, or task-state update. A workflow with no close rule is invalid.

### Closeout Commit Routing

When implementation, review, or documentation work is done, JV-32 routes the closeout phase through:

```text
implementation done
-> verification-before-completion
-> cc-log if the session creates durable judgment or handoff context
-> Vincent 確認完整交付
-> C1 commit -> normal product push -> remote delivery verification
-> task event -> authorized single-writer canonical apply -> closeout sync
-> necessary generators -> MC dashboard read model
-> C2 commit -> normal Harness push
-> read-only Terminal Gate -> residual_zero -> task_completed
```

`worktree-commit` remains the commit authority. 「確認完整交付」是一份具名、有限的 exact closeout plan 授權：它涵蓋 C1／C2 兩次正常 push，但不授權 force push、scope 擴張、吸收 baseline dirty、部署或新的人工產品決策。空管從首個未滿足 state 續跑，且只在 scope、base path overlap、non-fast-forward、verifier、ownership 與 human-decision 等授權不變量都未改變時排隊／重試；任一改變就升級給 Vincent，而不是沿用舊授權。

兩次 push 的物理順序不可省略：C1 必須先到產品 `origin/main` 才能成為真實 delivery evidence；task event／single-writer apply／sync／generator／MC 儀表板接著在 C2 前完成；C2 最後才正常 push 到 `harness-mc/origin/main`。最後驗證是只讀，雙端 `0/0` 與本次 residual zero 成立才是 `task_completed`。Air Traffic Controller 是既有 closeout route 的角色，不是第二套 task system，也不宣稱有獨立 daemon runtime。

## Architecture Boundary

`ARCHITECTURE.md` is an index, not the catalog. Architecture Admission Record lives in `$COLLAB/harness-mc/system-workflow/registries/morrowise-architecture-subsystems.json`. The generated architecture block may point to this detail doc and registry after promotion, but it must not copy the catalog details.

### Architecture Version Improvement Review

JV-32 is already a promoted subsystem. Any change to its governed contract (catalog, workflow schema, task-lifecycle schema/spec, task-write map, approval policy, or task validator) is therefore a **version improvement**, not a new subsystem by default. Before that change can be closed, the owner must review the existing Architecture Admission Record and record one of two outcomes:

1. `updated`: update the existing record's `version_review` with the current contract fingerprint, evidence, review date, and index decision; then run the architecture sync and its `--check`.
2. `no_index_change`: retain the thin index wording but still refresh the same `version_review` fingerprint and evidence; `ARCHITECTURE.md` must not be used to duplicate route-level details.

`node scripts/verify-morrowise-dev-workflow-catalog.mjs` recomputes the governed-contract fingerprint. A stale Admission Record therefore fails verification until the review is recorded. The generated index is still updated only through the controlled architecture sync, not by hand-editing `ARCHITECTURE.md`.

## Forbidden Actions

- Execute `$COLLAB/.tmp/skills-main/scripts/link-skills.sh`.
- Run installers or setup scripts from the intake repo.
- Modify hooks or git guardrails.
- Write `.env`, GitHub secrets, issue tracker config, or runtime auth.
- Read secrets, tokens, cookies, browser auth, or runtime credential stores.
- Write external issue trackers without a separate approval policy.

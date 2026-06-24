# MorroWise Live-System Admission Gate

> Source of truth: `$COLLAB/harness-mc/system-workflow/registries/morrowise-live-system-admission.json`
> Owner task: `morrowise/live-system-admission-gate`

## Purpose

MorroWise should not treat every new script, card, scheduler, adapter, or read model as live-system infrastructure by default.

Before a component enters MorroWise, it must answer one question:

```text
What part of the live loop does this component own?
```

The required loop contract is:

```text
trigger -> source -> process -> output -> surface -> next_action -> feedback_loop -> verifier
```

If a component cannot identify that loop, it may still exist as a prototype or static display, but it cannot be described as live.

## Admission States

| State | Meaning |
|---|---|
| `accepted` | The component can be referenced as MorroWise live-system capability. |
| `prototype` | The component may be explored, but must not be required workflow infrastructure. |
| `blocked` | The component is missing required evidence or safety boundary. |
| `static_display` | The component is display-only and cannot claim feedback-loop behavior. |

## Required Contract

Every component entry must include:

| Field | Meaning |
|---|---|
| `component_id` | Stable component identifier. |
| `type` | `read_model`, `scheduler_task`, `surface`, `runner`, `adapter`, `verifier`, or adjacent controlled type. |
| `owner_task` | MC task that owns the component. |
| `loop_role` | What part of the live loop this component owns. |
| `trigger` | What wakes or runs it. |
| `source_of_truth` | Canonical sources used as input. |
| `process` | Script, adapter, runner, or manual process. |
| `output` | Durable local output or event. |
| `surface` | Where a human or agent sees the result. |
| `next_action` | What the system should do with the output. |
| `feedback_loop` | How the output returns to task state, event state, generated data, or a later sweep. |
| `write_boundary` | What the component may and may not write or execute. |
| `degraded_states` | Known non-happy-path states. |
| `verifier` | Repeatable verification command or contract. |
| `admission_state` | `accepted`, `prototype`, `blocked`, or `static_display`. |

## Gate Rules

- Accepted components must define the complete loop contract.
- Components without a feedback loop cannot be accepted.
- Components without an explicit write boundary cannot be accepted.
- Components without a repeatable verifier cannot be accepted.
- Components that commit, push, send messages, sync external systems, mutate task state, or touch schedules must route through approval policy or worktree-commit gate.

## First Fixture

`commit-attention` is the first accepted fixture.

It is accepted because it:

- Reads git porcelain status and MC task metadata.
- Produces `$COLLAB/harness-mc/public/data/commit-attention.json`.
- Routes dirty work to commit cleanup planning, missing task anchors to task creation/selection, and branch divergence to reconcile first.
- Explicitly forbids staging, committing, pushing, closing tasks, reading secrets, or reading diff contents.
- Is verified by `npm run test:commit-attention` and `npm run test:live-system-admission`.

It is not allowed to perform the commit itself. Actual commit work still belongs to `worktree-commit`.

## Relationship To Live Loop Verification

Admission Gate is the entry rule. It decides whether a component may be considered part of MorroWise.

`v0-live-loop-verify` is the end-to-end check. It verifies that accepted components actually participate in the larger source -> output -> surface -> next_action -> feedback loop.

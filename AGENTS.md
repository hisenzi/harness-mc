# harness-mc Agent Entry

This repo is the MC control plane for `$COLLAB`.

Before changing project state, task state, generated data, MorroWise registries, or workflow specs, read:

1. `$COLLAB/AGENTS.md`
2. `$COLLAB/notyet-harness/000_Agent/CORE.md`

## MorroWise / harness-mc Task Ownership Routing

When adding or changing tasks, decide ownership before editing `tasks.json`.

| Work type | Task source | Rule |
|---|---|---|
| MorroWise system task | `$COLLAB/harness-mc/milestones/morrowise/tasks.json` | Use for system loops, source-of-truth contracts, generated read models, verifiers, policies, routing rules, schedulers, agent workflow boundaries, runtime/delivery adapters, and governance gates. |
| harness-mc surface task | `$COLLAB/harness-mc/milestones/harness-mc/tasks.json` | Use for dashboard pages, cards, routes, homepage sections, drilldown views, visual summaries, and user-facing MC operations that only display or operate on existing MorroWise state. |

Examples:

- `architecture-live-marker-sync`, `runtime-scheduler-v0`, `task-ownership-routing-rule`, `morrowise-system-json-generator`, and verifier/gate work belong to MorroWise.
- `/attention` UI, `/worktrees` UI, homepage MorroWise cards, route labels, and dashboard drilldowns belong to harness-mc.

If a change includes both layers, split the work: put the system/read-model/verifier task in MorroWise, then create a dependent harness-mc surface task for the display layer. Historical `harness-mc` MorroWise tasks remain implementation lineage and evidence; do not use them as the active owner for new system tasks.

## API / CLI / MCP Capability Registry

For any question or change involving API, CLI, MCP, local scripts, connectors, adapters, browser automation, or external tool access, check the MorroWise capability registry first:

`$COLLAB/harness-mc/system-workflow/registries/morrowise-api-cli-mcp-capability-registry.json`

The MC task anchor is:

`$COLLAB/harness-mc/milestones/morrowise/tasks.json#api-cli-mcp-capability-registry-v0`

Use it to answer:

- which API / CLI / MCP route is current, legacy, blocked, unknown, or prototype
- where the entrypoint lives
- what auth or secret boundary applies
- what the read/write boundary allows or forbids
- what changed recently and why, via `history`
- which task owns the next action

Do not treat chat history, Heptabase cards, Obsidian Canvas, local app state, or memory as the source of truth for capability status. They can be evidence, but the registry and MC task state are canonical.

When adding or changing a capability:

1. Update the registry with `history`.
2. Run `npm run test:capability-registry`.
3. Run `node scripts/generate-morrowise-capabilities.mjs` if a read model refresh is needed.
4. Do not read or store secrets, tokens, browser cookies, local auth files, or runtime credential content.

## MC Dashboard Surface Chain

API / CLI / MCP capabilities become visible in MC through this chain:

`registry -> generated read model -> MorroWise live dashboard surface -> homepage card -> verifier`

Concrete files:

- registry: `$COLLAB/harness-mc/system-workflow/registries/morrowise-api-cli-mcp-capability-registry.json`
- generated read model: `$COLLAB/harness-mc/public/data/morrowise-capabilities.json`
- generator: `$COLLAB/harness-mc/scripts/generate-morrowise-capabilities.mjs`
- live dashboard generator: `$COLLAB/harness-mc/scripts/generate-morrowise-live-dashboard.mjs`
- homepage surface: `$COLLAB/harness-mc/app/page.tsx#api-cli-mcp-capabilities`
- wiring gate: `$COLLAB/harness-mc/system-workflow/registries/morrowise-wiring-gate.json`
- verifier: `npm run test:capability-registry`, `npm run test:morrowise-live-dashboard`, and `npm run test:morrowise-wiring`

When adding a new API / CLI / MCP capability family, make sure the capability registry history, generated read model, live dashboard surface metrics, homepage card, and verifier expectations stay aligned. A capability that is only in a markdown note or chat thread is not considered connected to MC.

For any MorroWise component beyond API / CLI / MCP, use the same wiring gate. A component cannot be called ready unless the gate can trace source/registry, generated read model, dashboard surface, homepage or drilldown anchor, verifier, routing, and next action.

Generated read model:

`$COLLAB/harness-mc/public/data/morrowise-capabilities.json`

This file is generated and may be gitignored. Regenerate it from the registry instead of editing it by hand.

import assert from "node:assert/strict";
import { mergeTaskDefinitionsWithState, stateFromTask } from "./task-state.mjs";

const definitions = [
  {
    id: "task-1",
    title: "Definition stays here",
    status: "todo",
    track: "control-plane",
    done_condition: "Ship the thing.",
  },
  {
    id: "task-2",
    title: "Fallback task",
    status: "todo",
    track: "control-plane",
  },
];

const state = {
  tasks: {
    "task-1": {
      status: "completed",
      completed_at: "2026-06-15",
      commits: ["abc1234"],
      summary: "Completed via event reducer.",
      external_refs: {
        heptabase: { card_id: "card-1" },
      },
    },
    "unknown-task": {
      status: "completed",
    },
  },
};

const merged = mergeTaskDefinitionsWithState(definitions, state);

assert.equal(merged.length, 2);
assert.deepEqual(merged[0], {
  id: "task-1",
  title: "Definition stays here",
  status: "completed",
  track: "control-plane",
  done_condition: "Ship the thing.",
  completed_at: "2026-06-15",
  commits: ["abc1234"],
  summary: "Completed via event reducer.",
  external_refs: {
    heptabase: { card_id: "card-1" },
  },
});

assert.deepEqual(merged[1], {
  id: "task-2",
  title: "Fallback task",
  status: "todo",
  track: "control-plane",
});

assert.deepEqual(stateFromTask({
  id: "task-1",
  title: "Definition stays here",
  status: "completed",
  track: "control-plane",
  completed_at: "2026-06-15",
  commits: ["abc1234"],
  summary: "Completed via event reducer.",
  external_refs: { heptabase: { card_id: "card-1" } },
}), {
  status: "completed",
  completed_at: "2026-06-15",
  commits: ["abc1234"],
  summary: "Completed via event reducer.",
  external_refs: { heptabase: { card_id: "card-1" } },
});

console.log("task-state merge verification passed");

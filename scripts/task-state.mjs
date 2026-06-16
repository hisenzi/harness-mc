export const TASK_STATE_FIELDS = [
  "status",
  "completed_at",
  "commits",
  "summary",
  "external_refs",
];

export function mergeTaskDefinitionsWithState(definitions, state = {}) {
  const taskState = state?.tasks || {};
  return definitions.map((task) => {
    const stateForTask = taskState[task.id] || {};
    return { ...task, ...stateForTask };
  });
}

export function stateFromTask(task) {
  const state = {};
  for (const field of TASK_STATE_FIELDS) {
    if (task[field] !== undefined) state[field] = task[field];
  }
  return state;
}

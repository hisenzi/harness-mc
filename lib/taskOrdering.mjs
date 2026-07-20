const priorityRank = {
  P0: 0,
  high: 0,
  P1: 1,
  medium: 1,
  P2: 2,
  low: 2,
};

function compareReadyTasks(left, right) {
  const leftRank = priorityRank[left.priority] ?? 3;
  const rightRank = priorityRank[right.priority] ?? 3;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return String(left.id || "").localeCompare(String(right.id || ""), "en");
}

/**
 * Returns a deterministic plan order without mutating the canonical task array.
 * Dependencies that are not present in the current list are treated as external
 * evidence; cyclic tasks retain a stable priority/id fallback order.
 */
export function sortTasksByPlan(tasks = []) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const incoming = new Map();
  const dependents = new Map();

  for (const task of tasks) {
    const dependencies = (task.dependencies || task.depends_on || []).filter((id) => byId.has(id));
    incoming.set(task.id, dependencies.length);
    for (const dependencyId of dependencies) {
      const list = dependents.get(dependencyId) || [];
      list.push(task.id);
      dependents.set(dependencyId, list);
    }
  }

  const ready = tasks.filter((task) => incoming.get(task.id) === 0).sort(compareReadyTasks);
  const ordered = [];

  while (ready.length > 0) {
    const task = ready.shift();
    ordered.push(task);
    for (const dependentId of dependents.get(task.id) || []) {
      const remaining = (incoming.get(dependentId) || 0) - 1;
      incoming.set(dependentId, remaining);
      if (remaining === 0) {
        ready.push(byId.get(dependentId));
        ready.sort(compareReadyTasks);
      }
    }
  }

  if (ordered.length !== tasks.length) {
    const emitted = new Set(ordered.map((task) => task.id));
    ordered.push(...tasks.filter((task) => !emitted.has(task.id)).sort(compareReadyTasks));
  }

  return ordered;
}

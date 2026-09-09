import { isDeepStrictEqual } from 'node:util';

export const TASK_STATE_FIELDS = [
  'status', 'completed_at', 'commits', 'summary', 'external_refs', 'coordination',
];
const CANONICAL_PROJECTS = new Set(['morrowise', 'harness-mc']);
export const usesCanonicalTaskLifecycle = projectId => CANONICAL_PROJECTS.has(projectId);
const DEFINITION_FIELDS = new Set([
  'id', 'title', 'status', 'completed_at', 'note', 'summary', 'track', 'priority',
  'dependencies', 'depends_on', 'done_condition', 'acceptance', 'acceptance_matrix',
  'replaced_by', 'task_lifecycle', 'order', 'order_label', 'source_refs',
]);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function mergeReferences(canonical, projected, prefix='external_refs') {
  const merged = {...projected, ...canonical};
  for (const key of Object.keys(canonical)) {
    if (!Object.hasOwn(projected, key) || canonical[key] === null) continue;
    if (object(canonical[key]) && object(projected[key])) {
      merged[key] = mergeReferences(canonical[key], projected[key], `${prefix}.${key}`);
    } else if (!isDeepStrictEqual(canonical[key], projected[key]) && !['synced_at', 'sync_mode'].includes(key)) {
      throw Error(`task_reference_identity_conflict:${prefix}.${key}`);
    }
  }
  return structuredClone(merged);
}

// Only the named migration consumers select canonical authority. Legacy ACP
// projects keep their state-owned lifecycle until their own migration is reviewed.
export function mergeTaskDefinitionsWithState(definitions, state = {}, {projectId} = {}) {
  const taskState = state?.tasks || {};
  if (!usesCanonicalTaskLifecycle(projectId)) {
    return definitions.map(task => ({...task, ...(taskState[task.id] || {})}));
  }
  if (!Array.isArray(definitions) || !object(state) || (Object.hasOwn(state,'tasks') && !object(state.tasks))) throw Error('invalid_task_state_source');
  const defined = new Set(definitions.map(task=>task?.id));
  if (Object.keys(taskState).some(id=>!defined.has(id))) throw Error('state_without_task_definition');
  const ids = new Set();
  return definitions.map(task => {
    if (!object(task) || typeof task.id !== 'string' || !task.id || ids.has(task.id)) throw Error('invalid_or_duplicate_task_definition');
    ids.add(task.id);
    const overlay = Object.hasOwn(taskState, task.id) ? taskState[task.id] : {};
    if (!object(overlay)) throw Error(`invalid_task_state_record:${projectId}/${task.id}`);
    for (const key of Object.keys(overlay)) {
      if (!TASK_STATE_FIELDS.includes(key) && !DEFINITION_FIELDS.has(key)) {
        throw Error(`unknown_task_state_field:${projectId}/${task.id}:${key}`);
      }
    }
    const merged = structuredClone(task);
    // Lifecycle and requirements always come from definitions. The old shadow
    // remains in state.json for the separately reviewed reconciliation/backup.
    if (Object.hasOwn(overlay, 'coordination')) {
      if (!object(overlay.coordination)) throw Error(`invalid_task_coordination:${task.id}`);
      merged.coordination = structuredClone(overlay.coordination);
    }
    if (Object.hasOwn(overlay, 'commits')) {
      if (!Array.isArray(overlay.commits) || !overlay.commits.every(c => typeof c === 'string') || (task.commits !== undefined && !Array.isArray(task.commits))) throw Error(`invalid_task_commits:${task.id}`);
      merged.commits = [...new Set([...(task.commits || []), ...overlay.commits])];
    }
    if (Object.hasOwn(overlay, 'external_refs')) {
      if (!object(overlay.external_refs) || (task.external_refs !== undefined && !object(task.external_refs))) throw Error(`invalid_task_external_refs:${task.id}`);
      // Canonical reference leaves win; unrelated receipt leaves are preserved.
      merged.external_refs = mergeReferences(task.external_refs || {}, overlay.external_refs);
    }
    if (task.summary === undefined && overlay.summary !== undefined) merged.summary = structuredClone(overlay.summary);
    return merged;
  });
}

// A read-only diff for review; this never grants authority to overwrite sources.
export function taskStateAuthorityDifferences(definitions, state = {}, {projectId} = {}) {
  if (!usesCanonicalTaskLifecycle(projectId)) throw Error('canonical_project_required');
  mergeTaskDefinitionsWithState(definitions, state, {projectId});
  return definitions.flatMap(task => Object.entries(state?.tasks?.[task.id] || {})
    .filter(([field,value]) => DEFINITION_FIELDS.has(field) && !isDeepStrictEqual(task[field],value))
    .map(([field,value]) => ({task_id:task.id,field,owner:'tasks.json',canonical_present:Object.hasOwn(task,field),...(Object.hasOwn(task,field)?{canonical:structuredClone(task[field])}:{}),projection:structuredClone(value)})));
}

export function stateFromTask(task) {
  const state = {};
  for (const field of TASK_STATE_FIELDS) {
    if (task[field] !== undefined) state[field] = task[field];
  }
  return state;
}

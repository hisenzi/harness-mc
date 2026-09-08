import { loadWorkbook, evaluateWorkbookGate, workId } from './workbook-anchor.mjs';
import { inspectWorkbookClaims, inspectWorkbookRepo } from './workbook-coordination.mjs';

const observationSources = new WeakMap();
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;
const boundary = {
  allowed: ['read the named workbook', 'read local work claims', 'read local Git status', 'return a scoped plan'],
  forbidden: ['write central generated data', 'claim work', 'stage files', 'commit', 'push', 'close task', 'send external notification'],
  handoff_gate: '$COLLAB/notyet-harness/000_Agent/skills/worktree-commit/SKILL.md',
};
const intersects = (left, right) => left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
const samePaths = (left, right) => Array.isArray(left) && Array.isArray(right)
  && left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);

export function assertWorkbookReadOnly(options = {}) {
  if (options.write === true || options.notify) throw new Error('workbook_read_only: central writes and notifications are forbidden');
}

function observeClaim(claims, workbook, repo, now, staleAfterMs) {
  if (!Array.isArray(claims) || claims.some(claim => claim?.state === 'unknown')) return { state: 'unknown', claim: null };
  const matches = claims.filter(claim => claim?.work_id === workId(workbook.contract));
  if (matches.length !== 1) return { state: 'unknown', claim: null };
  const claim = matches[0];
  if (claim.version !== 1 || claim.home !== workbook.home || claim.contract_fingerprint !== workbook.contract_fingerprint
      || !claim.owner || !claim.session_id || !samePaths(claim.scope_paths, repo.write_paths)) return { state: 'unknown', claim: null };
  if (claim.state === 'pending_writeback') return { state: 'pending_writeback', claim };
  if (claim.state !== 'active') return { state: 'unknown', claim };
  const updatedAt = Date.parse(claim.updated_at);
  if (!Number.isFinite(updatedAt) || updatedAt > now) return { state: 'unknown', claim };
  return { state: now - updatedAt > staleAfterMs ? 'stale' : 'active', claim };
}

function canonicalObservation(contract, context, observedAt) {
  const baseline = contract.canonical_baseline;
  if (!baseline) {
    let observed;try {observed=context.canonicalResolver?.(workId(contract));}catch { /* Keep unknown. */ }
    return {status:observed?.exists===false&&observed.task_ref===workId(contract)?'not_registered':'unknown',source_ref:workId(contract),source_version:observed?.digest||null,observed_at:observedAt};
  }
  let current;
  try { current = context.canonicalResolver?.(baseline.task_ref); } catch { /* Unavailable remains unknown. */ }
  return {
    status: current?.status || 'unknown', source_ref: baseline.task_ref,
    source_version: current?.digest || null, expected_version: baseline.task_digest, observed_at: observedAt,
  };
}

export function generateWorkbookAttention(options = {}) {
  assertWorkbookReadOnly(options);
  if (typeof options.workbook !== 'string' || !options.workbook.trim()) throw new Error('workbook_path_required');
  const workbook = loadWorkbook(options.workbook);
  const context = options.workbookContext || {};
  const now = context.now === undefined ? Date.now() : new Date(context.now).getTime();
  const staleAfterMs = context.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  if (!Number.isFinite(now) || !Number.isFinite(staleAfterMs) || staleAfterMs < 0) throw new Error('observation_time_invalid');
  const observedAt = new Date(now).toISOString();
  const gate = evaluateWorkbookGate({ contract: workbook.contract, event: 'implement' }, context);
  const readClaims = context.inspectClaims || inspectWorkbookClaims;
  const readRepo = context.inspectRepo || inspectWorkbookRepo;
  const repositories = workbook.contract.repos.map(repo => {
    let claims = [], snapshot = {}, observationError = null;
    try { claims = readClaims({ repoPath: repo.checkout_root }); }
    catch (error) { observationError = error.message; }
    try { snapshot = readRepo({ workbook, repoId: repo.repo_id, sessionId: context.sessionId }); }
    catch (error) { observationError ||= error.message; }
    const observed = observeClaim(claims, workbook, repo, now, staleAfterMs);
    const state = observationError ? 'unknown' : observed.state;
    const dirty = Array.isArray(snapshot.dirty_paths) ? [...new Set(snapshot.dirty_paths)] : [];
    const candidates = dirty.filter(file => repo.write_paths.some(scope => intersects(scope, file)));
    const excluded = dirty.filter(file => !repo.write_paths.some(scope => intersects(scope, file)));
    const readiness = snapshot.decision === 'READY' && Array.isArray(snapshot.dirty_paths)
      && samePaths(snapshot.scope_paths, repo.write_paths)
      ? { decision: 'READY', reason: snapshot.reason }
      : { decision: 'BLOCKED', reason: snapshot.reason || 'repo_observation_unavailable' };
    let planningState = 'blocked', reason = readiness.reason;
    if (gate.decision === 'requires_human_approval') {
      planningState = 'requires_human_approval'; reason = gate.reason;
    } else if (gate.decision !== 'allow') reason = gate.reason;
    else if (state !== 'active') reason = `work_${state}`;
    else if (readiness.decision === 'READY') {
      planningState = candidates.length ? 'plan_allowed' : 'no_scoped_changes';
      reason = candidates.length ? 'named_work_scope_ready_for_diff_review' : 'no_uncommitted_files_in_selected_scope';
    }
    return {
      repo: repo.repo_id, path_label: repo.checkout_root, canonical_root: repo.canonical_root,
      head: snapshot.head || null, status: dirty.length ? 'uncommitted' : 'clean',
      files: dirty.map(file => ({ path: file })), dirty_paths: dirty,
      scope_paths: [...repo.write_paths], candidate_paths: candidates, excluded_paths: excluded,
      claims, execution_state: state, owner: observed.claim?.owner || null,
      session_id: observed.claim?.session_id || null, updated_at: observed.claim?.updated_at || null,
      next_action: observed.claim?.next_action || (state === 'pending_writeback' ? 'integrate_local_handoff' : 'inspect_workbook_and_owner'),
      observation_error: observationError, readiness,
      work_anchor: {
        source: 'workbook', project: workbook.contract.project_id, task_id: workbook.contract.task_id,
        task_title: workbook.contract.title, task_source: workbook.home,
        work_id: workId(workbook.contract), contract_fingerprint: workbook.contract_fingerprint,
      },
      commit_attention: { state: planningState, needs_commit_gate: candidates.length > 0, reason },
    };
  });
  const states = [...new Set(repositories.map(repo => repo.execution_state))];
  const data = {
    version: 1, generated_at: observedAt, read_only: true,
    source: { kind: 'workbook', ref: workbook.home, contract_version: workbook.contract.schema_version, contract_fingerprint: workbook.contract_fingerprint },
    write_boundary: boundary,
    work: {
      work_id: workId(workbook.contract), home: workbook.home, observed_at: observedAt,
      execution_state: states.length === 1 ? states[0] : 'unknown', gate,
      canonical: canonicalObservation(workbook.contract, context, observedAt),
    },
    summary: {
      repositories_need_attention: repositories.length,
      repositories_uncommitted: repositories.filter(repo => repo.dirty_paths.length).length,
      requires_human_approval: repositories.filter(repo => repo.commit_attention.state === 'requires_human_approval').length,
    },
    repositories,
  };
  // Only an in-process observation retains its source resolver. JSON is a read model,
  // never a transferable approval. Cleanup reloads and re-evaluates the real source.
  observationSources.set(data, { workbook: workbook.home, workbookContext: context });
  return data;
}

export function generateWorkbookCleanupPlan(attention, options = {}) {
  assertWorkbookReadOnly(options);
  const origin = observationSources.get(attention);
  if (!origin) return {
    version: 1, read_only: true, source: { kind: 'workbook' }, write_boundary: boundary,
    decision: 'requires_explicit_workbook', reason: 'Serialized attention cannot authorize planning; supply the named workbook.',
    summary: { total_repositories: 0, plan_allowed: 0, blocked: 0, requires_human_approval: 0 }, plans: [],
  };
  const fresh = generateWorkbookAttention({ ...origin, workbookContext: options.workbookContext || origin.workbookContext });
  const plans = fresh.repositories.map(repo => ({
    repo: repo.repo, repo_status: repo.status, path_label: repo.path_label,
    planning_state: repo.commit_attention.state, candidate_task_anchor: repo.work_anchor,
    preflight_result: { state: repo.commit_attention.state, reason: repo.commit_attention.reason },
    commit_groups: repo.commit_attention.state === 'plan_allowed' ? [{
      group_id: `${repo.repo}-pending-scope-review`, state: 'pending_scoped_diff_review',
      reason: 'Inspect only the named work scope with worktree-commit before choosing logical groups and messages.',
      candidate_files_sample: [...repo.candidate_paths],
    }] : [],
    excluded_files: [...repo.excluded_paths],
    verification_commands: [],
    verification_source: { workbook: fresh.source.ref, contract_fingerprint: fresh.source.contract_fingerprint },
    risks: [repo.commit_attention.reason, 'This read-only plan does not authorize commit or push.'],
    approval_required: true, handoff_gate: boundary.handoff_gate,
    next_action: repo.commit_attention.state === 'plan_allowed' ? 'Review the scoped diff and prepare a worktree-commit proposal.' : repo.next_action,
  }));
  return {
    version: 1, generated_at: fresh.generated_at, read_only: true,
    source: fresh.source, work: fresh.work, write_boundary: boundary,
    summary: {
      total_repositories: plans.length, plan_allowed: plans.filter(plan => plan.planning_state === 'plan_allowed').length,
      blocked: plans.filter(plan => plan.planning_state === 'blocked').length,
      requires_human_approval: plans.filter(plan => plan.planning_state === 'requires_human_approval').length,
      no_scoped_changes: plans.filter(plan => plan.planning_state === 'no_scoped_changes').length,
    },
    plans,
  };
}

export const isWorkbookCli = args => args.some(arg => arg === '--workbook' || arg.startsWith('--workbook='));

export function workbookCliOptions(args) {
  const options = { write: false, workbookContext: {} };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--workbook' || arg.startsWith('--workbook=')) {
      if (Object.hasOwn(options, 'workbook')) throw new Error('duplicate_workbook_argument');
      options.workbook = arg === '--workbook' ? args[++index] : arg.slice('--workbook='.length);
      if (!options.workbook || options.workbook.startsWith('--')) throw new Error('workbook_path_required');
    } else if (arg === '--session-id') {
      options.workbookContext.sessionId = args[++index];
      if (!options.workbookContext.sessionId || options.workbookContext.sessionId.startsWith('--')) throw new Error('session_id_required');
    } else if (arg !== '--json') throw new Error(`workbook_read_only: unsupported argument ${arg}`);
  }
  if (!options.workbook) throw new Error('workbook_path_required');
  return options;
}

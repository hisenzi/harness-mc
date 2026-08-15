import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSyncEvent } from "./sync-event-queue.mjs";
import { resolveMilestoneProject } from "./lib/milestone-projects.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, "..");

const LOW_RISK_ACTIONS = new Set([
  "produce_summary",
  "suggest_reorder",
  "queue_sync_requested",
  "draft_patch",
]);

const ACTION_CLASS_BY_ACTION = {
  produce_summary: "generate_local_read_model",
  suggest_reorder: "dry_run_or_preview",
  queue_sync_requested: "dry_run_or_preview",
  draft_patch: "draft_patch_inside_active_task",
  commit_now: "commit_push_deploy",
  split_commit: "commit_push_deploy",
  request_external_write_approval: "external_sync_or_write",
  refresh_visual_layer: "visual_layer_overwrite_or_reverse_sync",
  dry_run_external_sync: "dry_run_or_preview",
  create_task_event: "task_state_mutation",
  wait_for_approval: "task_state_mutation",
  propose_next_task: "task_state_mutation",
  propose_task_reorganization: "task_state_mutation",
  apply_memory_promotion: "memory_write_or_update",
};

export function runMorrowiseActionRunner(input = {}, options = {}) {
  const root = options.root || defaultRoot;
  const policy = input.policy || readJson(path.join(root, "system-workflow", "registries", "morrowise-approval-policy.json"));
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const writeSyncEvents = options.writeSyncEvents === true;
  const writeMemoryPromotions = options.writeMemoryPromotions === true;
  const collabRoot = options.collabRoot || path.resolve(root, "..");

  const results = candidates.map((candidate) => runCandidate(candidate, {
    policy,
    root,
    collabRoot,
    writeSyncEvents,
    writeMemoryPromotions,
  }));

  return {
    runner_id: "morrowise-action-runner.v0",
    mode: writeMemoryPromotions
      ? "approved_memory_write_enabled"
      : writeSyncEvents
        ? "low_risk_sync_queue_enabled"
        : "dry_run_plan_only",
    generated_at: options.generated_at || new Date().toISOString(),
    applied_actions: results.filter((result) => result.applied === true).length,
    approval_requests: results.filter((result) => result.output_type === "approval_request").length,
    outputs: results,
  };
}

function runCandidate(candidate, context) {
  assertCandidate(candidate, context.root);

  const actionClass = candidate.action_class || ACTION_CLASS_BY_ACTION[candidate.suggested_action] || "unknown";
  const policyDecision = classifyPolicy(actionClass, context.policy);
  const approvalSatisfied = memoryPromotionApprovalSatisfied(candidate, actionClass);
  const approvalNeeded = !approvalSatisfied
    && (candidate.requires_approval === true || candidate.risk_level !== "low" || policyDecision.policy !== "allowed");

  if (policyDecision.policy === "forbidden") {
    return approvalRequest(candidate, actionClass, policyDecision, "forbidden_action");
  }

  if (approvalNeeded) {
    return approvalRequest(candidate, actionClass, policyDecision, "approval_required");
  }

  if (candidate.suggested_action === "apply_memory_promotion") {
    return memoryPromotion(candidate, actionClass, policyDecision, context);
  }

  if (!LOW_RISK_ACTIONS.has(candidate.suggested_action)) {
    return approvalRequest(candidate, actionClass, policyDecision, "unsupported_low_risk_action");
  }

  if (candidate.suggested_action === "produce_summary") return summaryOutput(candidate, actionClass, policyDecision);
  if (candidate.suggested_action === "suggest_reorder") return reorderSuggestion(candidate, actionClass, policyDecision);
  if (candidate.suggested_action === "draft_patch") return draftPatch(candidate, actionClass, policyDecision);
  if (candidate.suggested_action === "queue_sync_requested") return queueSyncRequested(candidate, actionClass, policyDecision, context);

  return approvalRequest(candidate, actionClass, policyDecision, "unreachable_action");
}

function summaryOutput(candidate, actionClass, policyDecision) {
  return baseOutput(candidate, actionClass, policyDecision, {
    output_type: "summary",
    applied: false,
    summary: candidate.payload?.summary || candidate.reason,
  });
}

function reorderSuggestion(candidate, actionClass, policyDecision) {
  return baseOutput(candidate, actionClass, policyDecision, {
    output_type: "reorder_suggestion",
    applied: false,
    suggestion: {
      project: candidate.payload?.project || candidate.project || "",
      task_id: candidate.suggested_task_id,
      proposed_order_label: candidate.payload?.proposed_order_label || null,
      reason: candidate.reason,
    },
  });
}

function draftPatch(candidate, actionClass, policyDecision) {
  return baseOutput(candidate, actionClass, policyDecision, {
    output_type: "draft_patch",
    applied: false,
    patch: candidate.payload?.patch || "",
    note: "Draft patch only; runner does not apply files.",
  });
}

function queueSyncRequested(candidate, actionClass, policyDecision, context) {
  const eventInput = {
    root: context.root,
    type: "sync_requested",
    target: candidate.payload?.target || "obsidian_canvas",
    source_event_id: candidate.recommendation_id,
    project: candidate.payload?.project || candidate.project || "harness-mc",
    task_id: candidate.suggested_task_id,
    reason: candidate.reason,
    payload: candidate.payload?.sync_payload || {},
    actor: "morrowise-action-runner",
    session_id: candidate.payload?.session_id || "morrowise-runner-v0",
    created_at: candidate.payload?.created_at,
  };

  if (!context.writeSyncEvents) {
    return baseOutput(candidate, actionClass, policyDecision, {
      output_type: "sync_requested_event_plan",
      applied: false,
      sync_event: withoutRoot(eventInput),
    });
  }

  const syncEvent = writeSyncEvent(eventInput);
  return baseOutput(candidate, actionClass, policyDecision, {
    output_type: "sync_requested_event",
    applied: true,
    sync_event: syncEvent,
  });
}

function memoryPromotion(candidate, actionClass, policyDecision, context) {
  const { target, mutation, memory_candidate_id: candidateId } = candidate.payload;
  const plan = {
    candidate_id: candidateId,
    target_layer: target.layer,
    target_ref: target.ref,
    mutation_mode: mutation.mode,
    expected_preimage_sha256: mutation.expected_preimage_sha256,
    exact_text_sha256: sha256(mutation.exact_text),
    approval_id: candidate.approval_evidence.approval_id,
  };

  if (!context.writeMemoryPromotions) {
    return baseOutput(candidate, actionClass, policyDecision, {
      output_type: "memory_promotion_plan",
      applied: false,
      ...plan,
      note: "Approved plan only; set the explicit runner write boundary to apply the exact mutation.",
    });
  }

  const targetPath = resolveMemoryPromotionTarget(target, context.collabRoot);
  const stat = fs.lstatSync(targetPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("memory promotion target must be a regular non-symlink file");
  const lockPath = `${targetPath}.morrowise-memory.lock`;
  const tempPath = `${targetPath}.morrowise-${process.pid}-${Date.now()}.tmp`;
  let lockFd;
  let beforeSha256;
  let afterSha256;
  try {
    lockFd = fs.openSync(lockPath, "wx");
    const before = fs.readFileSync(targetPath, "utf8");
    beforeSha256 = sha256(before);
    if (beforeSha256 !== mutation.expected_preimage_sha256) {
      throw new Error("memory promotion preimage hash mismatch");
    }
    const exactText = mutation.exact_text;
    if (before.includes(exactText.trim())) throw new Error("memory promotion exact text is already present");
    const after = before + exactText;
    afterSha256 = sha256(after);
    fs.writeFileSync(tempPath, after, { flag: "wx", mode: stat.mode });
    fs.renameSync(tempPath, targetPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath);
    if (lockFd !== undefined) {
      fs.closeSync(lockFd);
      if (fs.existsSync(lockPath)) fs.rmSync(lockPath);
    }
  }

  return baseOutput(candidate, actionClass, policyDecision, {
    output_type: "memory_promotion_receipt",
    applied: true,
    ...plan,
    before_sha256: beforeSha256,
    after_sha256: afterSha256,
  });
}

function approvalRequest(candidate, actionClass, policyDecision, reason) {
  const taskGovernanceHandoff = actionClass === "task_state_mutation" && candidate.target_project
    ? {
        target_project: candidate.target_project,
        target_task_source: candidate.target_task_source,
        goal_ref: candidate.goal_ref,
        proposed_operation: candidate.proposed_operation,
        write_route: "JV-32/JV-40-after-Vincent-approval",
      }
    : null;
  return baseOutput(candidate, actionClass, policyDecision, {
    output_type: "approval_request",
    applied: false,
    approval_request: {
      reason,
      recommendation_id: candidate.recommendation_id,
      suggested_action: candidate.suggested_action,
      suggested_task_id: candidate.suggested_task_id,
      risk_level: candidate.risk_level,
      evidence_refs: candidate.evidence_refs,
      policy: policyDecision.policy,
      policy_reason: policyDecision.reason,
      ...(taskGovernanceHandoff ? { task_governance_handoff: taskGovernanceHandoff } : {}),
    },
  });
}

function baseOutput(candidate, actionClass, policyDecision, extra) {
  return {
    recommendation_id: candidate.recommendation_id,
    suggested_action: candidate.suggested_action,
    suggested_task_id: candidate.suggested_task_id,
    action_class: actionClass,
    risk_level: candidate.risk_level,
    policy: policyDecision.policy,
    ...extra,
  };
}

function classifyPolicy(actionClass, policy) {
  for (const tier of policy.policy_tiers || []) {
    const rule = (tier.rules || []).find((item) => item.action_class === actionClass);
    if (rule) {
      return {
        policy: tier.policy,
        reason: rule.reason,
        rule,
      };
    }
  }

  return {
    policy: policy.runner_gate?.default_policy || "approval_required",
    reason: "No matching policy rule; defaulting to approval_required.",
    rule: null,
  };
}

function assertCandidate(candidate, root) {
  const taskGovernance = candidate?.candidate_type === "propose_next_task"
    || candidate?.candidate_type === "propose_task_reorganization"
    || candidate?.suggested_action === "propose_next_task"
    || candidate?.suggested_action === "propose_task_reorganization";
  if (taskGovernance) {
    const sensitiveField = findForbiddenSensitiveField(candidate);
    if (sensitiveField) {
      throw new Error(`task governance candidate contains forbidden sensitive field: ${sensitiveField}`);
    }
    assertTaskGovernanceCandidate(candidate, root);
  }
  if (candidate?.suggested_action === "apply_memory_promotion") {
    assertMemoryPromotionCandidate(candidate);
  }
  for (const field of ["recommendation_id", "suggested_action", "suggested_task_id", "risk_level", "requires_approval", "evidence_refs"]) {
    if (candidate?.[field] === undefined || candidate?.[field] === null) throw new Error(`candidate.${field} is required`);
  }
  if (!["low", "medium", "high"].includes(candidate.risk_level)) throw new Error(`invalid risk_level: ${candidate.risk_level}`);
  if (typeof candidate.requires_approval !== "boolean") throw new Error("candidate.requires_approval must be boolean");
  if (!Array.isArray(candidate.evidence_refs) || candidate.evidence_refs.length === 0) throw new Error("candidate.evidence_refs must be non-empty");
}

function assertMemoryPromotionCandidate(candidate) {
  if (candidate.action_class !== "memory_write_or_update") {
    throw new Error("memory promotion candidate.action_class must be memory_write_or_update");
  }
  const { memory_candidate_id: candidateId, target, mutation } = candidate.payload || {};
  if (!candidateId) throw new Error("memory promotion candidate.payload.memory_candidate_id is required");
  if (target?.layer !== "l1_shared_active_memory") {
    throw new Error("memory promotion target.layer must be l1_shared_active_memory");
  }
  if (target?.ref !== "$COLLAB/notyet-harness/000_Agent/memory/MEMORY.md") {
    throw new Error("memory promotion target.ref is outside the governed L1 target");
  }
  if (mutation?.mode !== "append_exact_text") {
    throw new Error("memory promotion mutation.mode must be append_exact_text");
  }
  if (typeof mutation?.exact_text !== "string" || mutation.exact_text.length === 0) {
    throw new Error("memory promotion mutation.exact_text is required");
  }
  if (!/^[a-f0-9]{64}$/.test(mutation?.expected_preimage_sha256 || "")) {
    throw new Error("memory promotion mutation.expected_preimage_sha256 must be SHA-256");
  }
  const { source, dedupe, sensitivity, verification } = candidate.payload;
  if (!source?.ref || !/^[a-f0-9]{64}$/.test(source.fingerprint_sha256 || "")) {
    throw new Error("memory promotion source ref and fingerprint are required");
  }
  if (/^(\/Users\/|~\/|\$HOME\/|[A-Za-z]:\\)/.test(source.ref) || !/^(\$CODEX_HOME|\$COLLAB)\//.test(source.ref)) {
    throw new Error("memory promotion source ref must be portable");
  }
  if (/(^|\/)rollout_summaries\//.test(source.ref) || /(^|\/)rollouts?\//.test(source.ref)) {
    throw new Error("memory promotion raw rollout source is forbidden");
  }
  if (dedupe?.status !== "unique" || !dedupe.key || !Array.isArray(dedupe.compared_against) || dedupe.compared_against.length === 0) {
    throw new Error("memory promotion requires a unique dedupe decision");
  }
  if (sensitivity?.classification !== "non_sensitive") {
    throw new Error("memory promotion candidate must be non-sensitive");
  }
  if (verification?.status !== "verified" || !verification.evidence_ref) {
    throw new Error("memory promotion candidate must be verified");
  }
  const sensitiveField = findForbiddenSensitiveField(candidate);
  if (sensitiveField) throw new Error(`memory promotion candidate contains forbidden sensitive field: ${sensitiveField}`);
}

function memoryPromotionApprovalSatisfied(candidate, actionClass) {
  if (candidate?.suggested_action !== "apply_memory_promotion" || actionClass !== "memory_write_or_update") return false;
  const approval = candidate.approval_evidence;
  const payload = candidate.payload || {};
  return approval?.status === "approved"
    && approval.approved_by === "Vincent"
    && typeof approval.approval_id === "string"
    && approval.approval_id.length > 0
    && typeof approval.evidence_ref === "string"
    && approval.evidence_ref.length > 0
    && approval.approved_candidate_id === payload.memory_candidate_id
    && approval.approved_target_ref === payload.target?.ref
    && approval.approved_text_sha256 === sha256(payload.mutation?.exact_text || "");
}

function resolveMemoryPromotionTarget(target, collabRoot) {
  const expectedRef = "$COLLAB/notyet-harness/000_Agent/memory/MEMORY.md";
  if (target.ref !== expectedRef) throw new Error("memory promotion target ref is not allowed");
  const resolved = path.resolve(collabRoot, target.ref.slice("$COLLAB/".length));
  const expected = path.resolve(collabRoot, "notyet-harness", "000_Agent", "memory", "MEMORY.md");
  if (resolved !== expected) throw new Error("memory promotion target path escaped the governed L1 target");
  return resolved;
}

function assertTaskGovernanceCandidate(candidate, root) {
  const requiredFields = [
    "target_project",
    "target_task_source",
    "goal_ref",
    "source_task_refs",
    "evidence_refs",
    "observed_gap",
    "proposed_operation",
    "proposed_done_condition",
    "limitations",
    "requires_approval",
  ];
  for (const field of requiredFields) {
    const value = candidate?.[field];
    if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
      throw new Error(`task governance candidate.${field} is required`);
    }
  }

  const descriptor = resolveMilestoneProject({ repoRoot: root, projectId: candidate.target_project });
  if (!descriptor) throw new Error("task governance candidate.target_project must resolve to a canonical milestone");
  const expectedTaskSource = `$COLLAB/harness-mc/${descriptor.relativeDir}/tasks.json`;
  if (candidate.target_task_source !== expectedTaskSource) {
    throw new Error("task governance candidate.target_task_source must match target_project");
  }
  const expectedGoalRef = `$COLLAB/harness-mc/${descriptor.relativeDir}/project.json#/goals`;
  if (candidate.goal_ref !== expectedGoalRef) {
    throw new Error("task governance candidate.goal_ref must match target_project");
  }
  if (!Array.isArray(candidate.source_task_refs) || candidate.source_task_refs.length === 0) {
    throw new Error("task governance candidate.source_task_refs must be non-empty");
  }
  if (!Array.isArray(candidate.limitations) || candidate.limitations.length === 0) {
    throw new Error("task governance candidate.limitations must be non-empty");
  }
  if (!["create", "retain", "amend", "defer", "cancel", "replace", "blocked"].includes(candidate.proposed_operation)) {
    throw new Error(`task governance candidate.proposed_operation is invalid: ${candidate.proposed_operation}`);
  }
  if (candidate.requires_approval !== true) {
    throw new Error("task governance candidate.requires_approval must be true");
  }
}

function findForbiddenSensitiveField(value, currentPath = "candidate") {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const nested = findForbiddenSensitiveField(value[index], `${currentPath}[${index}]`);
      if (nested) return nested;
    }
    return null;
  }

  const forbiddenKey = /(token|cookie|secret|credential|password|private[_-]?key|runtime[_-]?auth|private[_-]?financial|account[_-]?number|bank[_-]?account|personal[_-]?life[_-]?detail)/i;
  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedPath = `${currentPath}.${key}`;
    if (forbiddenKey.test(key)) return nestedPath;
    const nested = findForbiddenSensitiveField(nestedValue, nestedPath);
    if (nested) return nested;
  }
  return null;
}

function withoutRoot(eventInput) {
  const { root, ...event } = eventInput;
  return event;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("Usage: node scripts/morrowise-action-runner.mjs <input.json>");
  const input = readJson(path.resolve(inputPath));
  const output = runMorrowiseActionRunner(input, {
    writeSyncEvents: input.writeSyncEvents === true,
    writeMemoryPromotions: input.writeMemoryPromotions === true,
  });
  console.log(JSON.stringify(output, null, 2));
}

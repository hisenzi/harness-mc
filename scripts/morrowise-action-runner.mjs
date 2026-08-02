import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeSyncEvent } from "./sync-event-queue.mjs";

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
};

export function runMorrowiseActionRunner(input = {}, options = {}) {
  const root = options.root || defaultRoot;
  const policy = input.policy || readJson(path.join(root, "system-workflow", "registries", "morrowise-approval-policy.json"));
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];
  const writeSyncEvents = options.writeSyncEvents === true;

  const results = candidates.map((candidate) => runCandidate(candidate, { policy, root, writeSyncEvents }));

  return {
    runner_id: "morrowise-action-runner.v0",
    mode: writeSyncEvents ? "low_risk_sync_queue_enabled" : "dry_run_plan_only",
    generated_at: options.generated_at || new Date().toISOString(),
    applied_actions: results.filter((result) => result.applied === true).length,
    approval_requests: results.filter((result) => result.output_type === "approval_request").length,
    outputs: results,
  };
}

function runCandidate(candidate, context) {
  assertCandidate(candidate);

  const actionClass = candidate.action_class || ACTION_CLASS_BY_ACTION[candidate.suggested_action] || "unknown";
  const policyDecision = classifyPolicy(actionClass, context.policy);
  const approvalNeeded = candidate.requires_approval === true || candidate.risk_level !== "low" || policyDecision.policy !== "allowed";

  if (policyDecision.policy === "forbidden") {
    return approvalRequest(candidate, actionClass, policyDecision, "forbidden_action");
  }

  if (approvalNeeded) {
    return approvalRequest(candidate, actionClass, policyDecision, "approval_required");
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

function assertCandidate(candidate) {
  const taskGovernance = candidate?.candidate_type === "propose_next_task"
    || candidate?.candidate_type === "propose_task_reorganization"
    || candidate?.suggested_action === "propose_next_task"
    || candidate?.suggested_action === "propose_task_reorganization";
  if (taskGovernance) {
    const sensitiveField = findForbiddenSensitiveField(candidate);
    if (sensitiveField) {
      throw new Error(`task governance candidate contains forbidden sensitive field: ${sensitiveField}`);
    }
    assertTaskGovernanceCandidate(candidate);
  }
  for (const field of ["recommendation_id", "suggested_action", "suggested_task_id", "risk_level", "requires_approval", "evidence_refs"]) {
    if (candidate?.[field] === undefined || candidate?.[field] === null) throw new Error(`candidate.${field} is required`);
  }
  if (!["low", "medium", "high"].includes(candidate.risk_level)) throw new Error(`invalid risk_level: ${candidate.risk_level}`);
  if (typeof candidate.requires_approval !== "boolean") throw new Error("candidate.requires_approval must be boolean");
  if (!Array.isArray(candidate.evidence_refs) || candidate.evidence_refs.length === 0) throw new Error("candidate.evidence_refs must be non-empty");
}

function assertTaskGovernanceCandidate(candidate) {
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

  const expectedTaskSource = `$COLLAB/harness-mc/milestones/${candidate.target_project}/tasks.json`;
  if (candidate.target_task_source !== expectedTaskSource) {
    throw new Error("task governance candidate.target_task_source must match target_project");
  }
  const expectedGoalRef = `$COLLAB/harness-mc/milestones/${candidate.target_project}/project.json#/goals`;
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

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  const inputPath = process.argv[2];
  if (!inputPath) throw new Error("Usage: node scripts/morrowise-action-runner.mjs <input.json>");
  const input = readJson(path.resolve(inputPath));
  const output = runMorrowiseActionRunner(input, { writeSyncEvents: input.writeSyncEvents === true });
  console.log(JSON.stringify(output, null, 2));
}

import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMorrowiseActionRunner } from "./morrowise-action-runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRoot = path.resolve(__dirname, "..");
const GOVERNED_TARGET = {
  layer: "l1_shared_active_memory",
  ref: "$COLLAB/notyet-harness/000_Agent/memory/MEMORY.md",
};

export function evaluateMemoryPromotionCandidate(candidate = {}) {
  const requiredError = validateRequiredFields(candidate);
  if (requiredError) return blocked("invalid_candidate", requiredError);

  if (isMachineLocalRef(candidate.source.ref)) {
    return blocked("machine_local_source", "Use a portable $CODEX_HOME or $COLLAB source ref, never a machine-specific path.");
  }
  if (isRawRolloutRef(candidate.source.ref)) {
    return blocked("raw_rollout_source", "Raw rollout/session records are evidence sources, not promotion candidates.");
  }
  if (candidate.sensitivity.classification !== "non_sensitive" || findSensitiveField(candidate)) {
    return blocked("sensitive_candidate", "Sensitive or secret-bearing candidates cannot enter shared L1.");
  }
  if (candidate.dedupe.status === "duplicate") {
    return blocked("duplicate_candidate", "A matching durable route already exists; keep the existing canonical entry.");
  }
  if (candidate.verification.status !== "verified") {
    return blocked("unverified_source", "Candidate source and exact text must be verified before approval.");
  }
  if (candidate.approval.status === "rejected") {
    return blocked("rejected_candidate", "Vincent rejected this candidate; no runner handoff is allowed.");
  }

  const runnerCandidate = toRunnerCandidate(candidate);
  if (candidate.approval.status !== "approved") {
    return {
      decision: "ready_for_approval",
      reason_code: "vincent_approval_required",
      writes_performed: 0,
      runner_candidate: runnerCandidate,
    };
  }

  const approvalError = validateApprovalScope(candidate);
  if (approvalError) return blocked("approval_scope_mismatch", approvalError);
  return {
    decision: "approved_for_runner",
    reason_code: "approved_exact_scope",
    writes_performed: 0,
    runner_candidate: runnerCandidate,
  };
}

export function processMemoryPromotionCandidate(candidate = {}, options = {}) {
  const evaluation = evaluateMemoryPromotionCandidate(candidate);
  if (evaluation.decision === "blocked") return evaluation;

  const root = options.root || defaultRoot;
  const runner = runMorrowiseActionRunner(
    { candidates: [evaluation.runner_candidate], ...(options.policy ? { policy: options.policy } : {}) },
    {
      root,
      collabRoot: options.collabRoot || path.resolve(root, ".."),
      writeMemoryPromotions: options.writeMemoryPromotions === true,
      generated_at: options.generated_at,
    },
  );
  const runnerOutput = runner.outputs[0];
  const decision = runnerOutput.output_type === "approval_request"
    ? "approval_required"
    : runnerOutput.output_type === "memory_promotion_receipt"
      ? "applied"
      : "approved_plan";
  return {
    decision,
    reason_code: evaluation.reason_code,
    writes_performed: runner.applied_actions,
    runner_output: runnerOutput,
  };
}

function validateRequiredFields(candidate) {
  for (const field of ["candidate_id", "source", "reason", "dedupe", "target", "sensitivity", "verification", "mutation", "approval", "evidence_refs"]) {
    if (candidate[field] === undefined || candidate[field] === null) return `candidate.${field} is required`;
  }
  if (!candidate.candidate_id || !candidate.reason) return "candidate_id and reason must be non-empty";
  if (!candidate.source.ref || !/^[a-f0-9]{64}$/.test(candidate.source.fingerprint_sha256 || "")) {
    return "source ref and fingerprint_sha256 are required";
  }
  if (!candidate.dedupe.key || !Array.isArray(candidate.dedupe.compared_against) || candidate.dedupe.compared_against.length === 0) {
    return "dedupe key and compared_against are required";
  }
  if (!["unique", "duplicate"].includes(candidate.dedupe.status)) return "dedupe.status must be unique or duplicate";
  if (candidate.target.layer !== GOVERNED_TARGET.layer || candidate.target.ref !== GOVERNED_TARGET.ref) {
    return "target must be the governed shared L1 path";
  }
  if (candidate.mutation.mode !== "append_exact_text" || typeof candidate.mutation.exact_text !== "string" || candidate.mutation.exact_text.length === 0) {
    return "mutation must provide non-empty append_exact_text content";
  }
  if (!/^[a-f0-9]{64}$/.test(candidate.mutation.expected_preimage_sha256 || "")) {
    return "mutation.expected_preimage_sha256 must be SHA-256";
  }
  if (!["pending", "approved", "rejected"].includes(candidate.approval.status)) {
    return "approval.status must be pending, approved, or rejected";
  }
  if (!Array.isArray(candidate.evidence_refs) || candidate.evidence_refs.length === 0) {
    return "evidence_refs must be non-empty";
  }
  return null;
}

function validateApprovalScope(candidate) {
  const approval = candidate.approval;
  if (approval.approved_by !== "Vincent") return "approved_by must be Vincent";
  if (!approval.approval_id || !approval.evidence_ref) return "approval_id and evidence_ref are required";
  if (approval.approved_candidate_id !== candidate.candidate_id) return "approval candidate id does not match";
  if (approval.approved_target_ref !== candidate.target.ref) return "approval target does not match";
  if (approval.approved_text_sha256 !== sha256(candidate.mutation.exact_text)) return "approval text hash does not match";
  return null;
}

function toRunnerCandidate(candidate) {
  const approved = candidate.approval.status === "approved";
  return {
    recommendation_id: `memory-promotion.${candidate.candidate_id}`,
    trigger_id: "morrowise.memory_promotion_candidate",
    reason: candidate.reason,
    suggested_action: "apply_memory_promotion",
    suggested_task_id: "shared-memory-governance-v2",
    action_class: "memory_write_or_update",
    evidence_refs: candidate.evidence_refs,
    risk_level: "high",
    requires_approval: !approved,
    hc_refs: ["#risk", "#confirmationBias", "#systemDynamics"],
    hc_reasoning: "Promote only a verified, unique, non-sensitive durable route with exact-scope Vincent approval.",
    hc_confidence: 0.9,
    ...(approved ? { approval_evidence: candidate.approval } : {}),
    payload: {
      memory_candidate_id: candidate.candidate_id,
      source: candidate.source,
      dedupe: candidate.dedupe,
      target: candidate.target,
      sensitivity: candidate.sensitivity,
      verification: candidate.verification,
      mutation: candidate.mutation,
    },
  };
}

function blocked(reasonCode, message) {
  return {
    decision: "blocked",
    reason_code: reasonCode,
    message,
    writes_performed: 0,
  };
}

function isMachineLocalRef(ref) {
  return /^(\/Users\/|~\/|\$HOME\/|[A-Za-z]:\\)/.test(ref)
    || !/^(\$CODEX_HOME|\$COLLAB)\//.test(ref);
}

function isRawRolloutRef(ref) {
  return /(^|\/)rollout_summaries\//.test(ref) || /(^|\/)rollouts?\//.test(ref);
}

function findSensitiveField(value, currentPath = "candidate") {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findSensitiveField(value[index], `${currentPath}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  const forbiddenKey = /^(token|cookie|secret|credential|password|private[_-]?key|runtime[_-]?auth|private[_-]?financial|account[_-]?number|bank[_-]?account|personal[_-]?life[_-]?detail)$/i;
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${currentPath}.${key}`;
    if (forbiddenKey.test(key)) return nestedPath;
    const found = findSensitiveField(nested, nestedPath);
    if (found) return found;
  }
  return null;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

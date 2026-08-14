export function evaluateJv37Admission({ jv37Task, receipt, currentFingerprint, pilotVerification }) {
  if (!receipt) return blocked("receipt_missing");
  if (receipt.matrix_fingerprint !== currentFingerprint) return blocked("matrix_fingerprint_mismatch");

  const requiredIds = (jv37Task?.acceptance_matrix || []).map((row) => row.id);
  const receiptIds = Array.isArray(receipt.required_ids) ? receipt.required_ids : [];
  const results = new Map((receipt.results || []).map((item) => [item?.id, item?.status]));
  const exactCoverage = receiptIds.length === requiredIds.length
    && new Set(receiptIds).size === receiptIds.length
    && requiredIds.every((id) => receiptIds.includes(id) && results.get(id) === "pass")
    && results.size === requiredIds.length;
  if (!exactCoverage) return blocked("matrix_results_incomplete");
  if (pilotVerification?.decision !== "READY" || pilotVerification.reason !== "real_pilot_receipt_source_verified") {
    return blocked(pilotVerification?.reason || "source_verification_required", pilotVerification?.details);
  }
  if (jv37Task?.status !== "completed") return blocked("task_not_completed");
  return {
    decision: "accepted",
    reason: "current_jv37_runtime_receipt_accepted",
    matrix_fingerprint: currentFingerprint,
    claim_sha: pilotVerification.claim?.sha,
    terminal: pilotVerification.terminal?.state,
  };
}

function blocked(reason, details = "") {
  return { decision: "blocked", reason, ...(details ? { details } : {}) };
}

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REQUIRED_CLAIM_FIELDS = [
  "claim_id",
  "task_id",
  "project_id",
  "repo_class",
  "branch",
  "base_sha",
  "claimed_at",
  "owner_role",
  "actor",
  "session_id",
];

const CLAIM_IDENTITY_FIELDS = [
  "claim_id",
  "task_id",
  "project_id",
  "repo_class",
  "branch",
  "base_sha",
  "owner_role",
  "actor",
];

const AUTHORIZATION_FIELDS = [
  ["scope_fingerprint", "scope_changed"],
  ["diff_fingerprint", "diff_changed"],
  ["grouping_fingerprint", "grouping_changed"],
  ["message_fingerprint", "message_changed"],
  ["verifier_fingerprint", "verifier_changed"],
  ["owner", "ownership_conflict"],
  ["human_decision", "human_decision_changed"],
];

const REMOTE_STATE_ORDER = [
  "claimed",
  "c1_remote_synced",
  "canonical_applied",
  "closeout_synced",
  "residual_zero",
  "released",
];

const RUNTIME_SOURCE_FILES = [
  "scripts/lib/repo-coordination-runtime.mjs",
  "scripts/lib/jv37-admission.mjs",
  "scripts/repo-coordination-runtime.mjs",
  "scripts/morrowise-phase3-jv37-admission.mjs",
  "scripts/verify-multi-machine-repo-coordination-gate.mjs",
  "scripts/task-event-outbox.mjs",
  "scripts/apply-task-events.mjs",
];

export function acquireClaim(activeClaim, proposedClaim) {
  const missing = REQUIRED_CLAIM_FIELDS.filter((field) => !proposedClaim?.[field]);
  if (missing.length > 0) return blocked("claim_invalid", `missing=${missing.join(",")}`);
  if (!activeClaim || activeClaim.state === "released") {
    return {
      decision: "READY",
      reason: "claim_acquired",
      claim: { ...proposedClaim, state: "claimed" },
    };
  }
  if (sameClaimOwner(activeClaim, proposedClaim)) {
    return { decision: "READY", reason: "claim_already_owned", claim: activeClaim };
  }
  return blocked("claim_conflict", `owner=${activeClaim.actor}/${activeClaim.owner_role}`);
}

export function authorizeCanonicalApply(claim) {
  if (!claim || claim.owner_role !== "integrator") return blocked("wrong_integrator");
  if (claim.state !== "c1_remote_synced" && claim.state !== "remote_synced") {
    return blocked("claim_not_ready_for_canonical_apply", `state=${claim.state || "missing"}`);
  }
  return { decision: "READY", reason: "single_integrator_authorized" };
}

export function coordinationRef(projectId, taskId) {
  if (!projectId || !taskId) throw new Error("projectId and taskId are required");
  return `refs/jv37/claims/${refSlug(projectId)}/${refSlug(taskId)}`;
}

export function deliveryRef(projectId, taskId, sessionId) {
  if (!projectId || !taskId || !sessionId) throw new Error("projectId, taskId and sessionId are required");
  return `refs/jv37/deliveries/${refSlug(projectId)}/${refSlug(taskId)}/${refSlug(sessionId)}`;
}

export function authorizationApprovalRef(projectId, taskId, approvalId) {
  if (!projectId || !taskId || !approvalId) throw new Error("projectId, taskId and approvalId are required");
  return `refs/jv37/approvals/${refSlug(projectId)}/${refSlug(taskId)}/${refSlug(approvalId)}`;
}

export function inspectAuthorizationApproval(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const remote = options.remote || "origin";
  const ref = options.ref;
  if (!ref || !options.sha) return blocked("authorization_approval_ref_missing");
  const remoteApproval = lsRemote(repoPath, remote, ref);
  if (remoteApproval.decision === "BLOCKED" || remoteApproval.sha !== options.sha) {
    return blocked("authorization_approval_not_remote_bound");
  }
  const fetch = git(repoPath, ["fetch", "--no-tags", remote, ref]);
  if (fetch.status !== 0) return blocked("authorization_approval_not_remote_bound");
  const record = readJsonCommit(repoPath, options.sha, "approval.json");
  if (!record
    || record.producer !== "jv37-trusted-authorization-signer"
    || record.evidence_kind !== "signed_human_authorization"
    || ref !== authorizationApprovalRef(record.project_id, record.task_id, record.approval_id)
    || record.remote_url_hash !== remoteIdentityHash(repoPath, remote)
    || record.snapshot?.authorization_schema !== "jv37-git-derived-v1") {
    return blocked("authorization_approval_invalid");
  }
  const trust = readTrustRegistry(repoPath, remote);
  if (trust.decision !== "READY") return trust;
  const approver = (trust.registry.authorization_approvers || []).find((entry) => entry.approver_id === record.approver_id);
  if (!approver || approver.status !== "active" || !approver.public_key_pem || approver.key_id !== record.key_id) {
    return blocked("authorization_approver_not_enrolled");
  }
  if (!verifyRecordSignature(record, approver.public_key_pem)) return blocked("authorization_signature_invalid");
  if (!Array.isArray(record.verifier_results)
    || record.verifier_results.length === 0
    || record.verifier_results.some((result) => result.status !== "pass" || result.runtime_source_digest !== runtimeSourceDigest())) {
    return blocked("authorization_verifier_evidence_invalid");
  }
  const expectedVerifierIds = (record.snapshot.verifiers || []).map((entry) => entry?.id).filter(Boolean).sort();
  const actualVerifierIds = record.verifier_results.map((entry) => entry?.id).filter(Boolean).sort();
  const supportedVerifierIds = ["jv37-authorization-invariants"];
  if (JSON.stringify(expectedVerifierIds) !== JSON.stringify(supportedVerifierIds)
    || JSON.stringify(actualVerifierIds) !== JSON.stringify(supportedVerifierIds)) {
    return blocked("authorization_verifier_evidence_invalid");
  }
  return { decision: "READY", reason: "signed_authorization_approval_verified", ref, sha: options.sha, record };
}

export function recordC1Delivery(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const remote = options.remote || "origin";
  const scopePaths = [...new Set((options.scopePaths || []).filter(Boolean))].sort();
  if (!options.projectId || !options.taskId || !options.sessionId || !options.actor) {
    return blocked("delivery_identity_missing");
  }
  if (scopePaths.length === 0) return blocked("delivery_scope_missing");
  if (!/^[0-9a-f]{40,64}$/i.test(String(options.commitSha || ""))
    || git(repoPath, ["cat-file", "-e", `${options.commitSha}^{commit}`]).status !== 0) {
    return blocked("delivery_commit_missing");
  }
  const parent = git(repoPath, ["rev-parse", `${options.commitSha}^`]);
  if (parent.status !== 0 || parent.stdout.trim() !== options.baseSha) return blocked("delivery_base_mismatch");
  const changed = git(repoPath, ["diff-tree", "--no-commit-id", "--name-only", "-r", options.commitSha]);
  if (changed.status !== 0) return blocked("delivery_diff_unreadable");
  const changedPaths = [...new Set(changed.stdout.split(/\r?\n/).filter(Boolean))].sort();
  if (JSON.stringify(changedPaths) !== JSON.stringify(scopePaths)) return blocked("delivery_scope_mismatch");
  const ref = options.ref || deliveryRef(options.projectId, options.taskId, options.sessionId);
  const existing = lsRemote(repoPath, remote, ref);
  if (existing.decision === "BLOCKED") return existing;
  if (existing.sha) return blocked("delivery_already_exists", ref);
  const record = {
    version: 1,
    producer: "jv37-runtime",
    evidence_kind: "c1_delivery_receipt",
    project_id: options.projectId,
    task_id: options.taskId,
    ...(options.environmentId ? { environment_id: options.environmentId } : {}),
    session_id: options.sessionId,
    actor: options.actor,
    base_sha: options.baseSha,
    commit_sha: options.commitSha,
    scope_paths: scopePaths,
    scope_fingerprint: `sha256:${sha256(JSON.stringify(scopePaths))}`,
    remote_url_hash: remoteIdentityHash(repoPath, remote),
    delivered_at: options.deliveredAt || new Date().toISOString(),
  };
  const receiptSha = createJsonCommit(repoPath, "delivery.json", record, options.commitSha);
  const push = git(repoPath, ["push", "--porcelain", remote, `${receiptSha}:${ref}`]);
  if (push.status !== 0) return blocked("delivery_race", trimEvidence(push.stderr || push.stdout));
  const readback = inspectC1Delivery({ repoPath, remote, ref });
  if (readback.decision !== "READY" || readback.sha !== receiptSha) return blocked("delivery_readback_failed");
  return { decision: "READY", reason: "c1_delivery_remote_bound", ref, sha: receiptSha, record };
}

export function inspectC1Delivery(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const remote = options.remote || "origin";
  if (!options.ref) return blocked("delivery_ref_missing");
  const observed = lsRemote(repoPath, remote, options.ref);
  if (observed.decision === "BLOCKED") return observed;
  if (!observed.sha) return blocked("delivery_missing");
  const fetch = git(repoPath, ["fetch", "--no-tags", remote, options.ref]);
  if (fetch.status !== 0) return blocked("delivery_fetch_failed", trimEvidence(fetch.stderr || fetch.stdout));
  const record = readJsonCommit(repoPath, observed.sha, "delivery.json");
  const receiptParent = git(repoPath, ["rev-parse", `${observed.sha}^`]);
  const c1Parent = record?.commit_sha ? git(repoPath, ["rev-parse", `${record.commit_sha}^`]) : { status: 1, stdout: "" };
  const changed = record?.commit_sha
    ? git(repoPath, ["diff-tree", "--no-commit-id", "--name-only", "-r", record.commit_sha])
    : { status: 1, stdout: "" };
  const changedPaths = changed.stdout.split(/\r?\n/).filter(Boolean).sort();
  if (!record
    || record.producer !== "jv37-runtime"
    || record.evidence_kind !== "c1_delivery_receipt"
    || record.remote_url_hash !== remoteIdentityHash(repoPath, remote)
    || !Array.isArray(record.scope_paths)
    || record.scope_paths.length === 0
    || record.scope_fingerprint !== `sha256:${sha256(JSON.stringify([...record.scope_paths].sort()))}`
    || options.ref !== deliveryRef(record.project_id, record.task_id, record.session_id)
    || receiptParent.status !== 0
    || receiptParent.stdout.trim() !== record.commit_sha
    || c1Parent.status !== 0
    || c1Parent.stdout.trim() !== record.base_sha
    || changed.status !== 0
    || JSON.stringify(changedPaths) !== JSON.stringify([...record.scope_paths].sort())) {
    return blocked("delivery_invalid");
  }
  return { decision: "READY", reason: "c1_delivery_observed", ref: options.ref, sha: observed.sha, record };
}

export function integrateC1Deliveries(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const claim = options.claim || {};
  if (claim.owner_role !== "integrator" || claim.branch !== "main") return blocked("wrong_integrator");
  const active = inspectRemoteCoordination({
    repoPath,
    remote: options.remote || "origin",
    ref: coordinationRef(claim.project_id, claim.task_id),
  });
  if (active.decision !== "READY" || active.record.state !== "claimed" || !sameClaimOwner(active.record, claim)) {
    return blocked("claim_owner_mismatch");
  }
  const branch = git(repoPath, ["branch", "--show-current"]);
  if (branch.status !== 0 || branch.stdout.trim() !== "main") return blocked("non_main_branch");
  if (readDirtyPaths(repoPath).length > 0) return blocked("dirty_blocked");
  if (git(repoPath, ["merge-base", "--is-ancestor", claim.base_sha, "HEAD"]).status !== 0) return blocked("base_not_safe");
  const receipts = [];
  const scopeOwners = new Map();
  for (const delivery of options.deliveries || []) {
    const observed = inspectC1Delivery({ repoPath, remote: options.remote || "origin", ref: delivery.ref });
    if (observed.decision !== "READY") return observed;
    if (observed.record.project_id !== claim.project_id
      || observed.record.task_id !== claim.task_id
      || observed.record.base_sha !== claim.base_sha) return blocked("delivery_claim_mismatch");
    for (const filePath of observed.record.scope_paths) {
      if (scopeOwners.has(filePath)) return blocked("delivery_scope_overlap", filePath);
      scopeOwners.set(filePath, observed.record.session_id);
    }
    receipts.push(observed);
  }
  if (receipts.length < 2) return blocked("delivery_set_incomplete");
  const applied = [];
  for (const receipt of receipts) {
    const commitSha = receipt.record.commit_sha;
    if (git(repoPath, ["merge-base", "--is-ancestor", commitSha, "HEAD"]).status !== 0) {
      const merge = git(repoPath, ["merge", "--no-ff", "--no-edit", commitSha]);
      if (merge.status !== 0) return blocked("delivery_integration_conflict", trimEvidence(merge.stderr || merge.stdout));
    }
    applied.push(commitSha);
  }
  return { decision: "READY", reason: "c1_deliveries_integrated_by_claim_owner", applied_commits: applied, delivery_refs: receipts.map((item) => item.ref) };
}

export function remoteIdentityHash(repoPath, remote = "origin") {
  return sha256(normalizedRemoteUrl(path.resolve(repoPath), remote));
}

export function refreshCanonicalMain(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const remote = options.remote || "origin";
  if (!options.expectedRemoteUrlHash || remoteIdentityHash(repoPath, remote) !== options.expectedRemoteUrlHash) {
    return blocked("wrong_canonical_remote");
  }
  const fetch = git(repoPath, ["fetch", "--prune", remote, "+refs/heads/main:refs/remotes/origin/main"]);
  if (fetch.status !== 0) return blocked("auth_blocked", trimEvidence(fetch.stderr || fetch.stdout));
  const live = lsRemote(repoPath, remote, "refs/heads/main");
  if (live.decision === "BLOCKED" || !live.sha) return blocked(live.reason || "remote_main_missing", live.details);
  const tracking = git(repoPath, ["rev-parse", "refs/remotes/origin/main"]);
  if (tracking.status !== 0 || tracking.stdout.trim() !== live.sha) return blocked("canonical_remote_tracking_stale");
  return { decision: "READY", reason: "canonical_origin_refreshed", sha: live.sha };
}

export function acquireRemoteClaim(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const remote = options.remote || "origin";
  const proposed = { ...options.claim, state: "claimed" };
  const localValidation = acquireClaim(null, proposed);
  if (localValidation.decision !== "READY") return localValidation;
  if (proposed.branch !== "main") return blocked("non_main_branch", proposed.branch);

  const ref = options.ref || coordinationRef(proposed.project_id, proposed.task_id);
  const observed = inspectRemoteCoordination({ repoPath, remote, ref });
  if (observed.decision === "BLOCKED" && observed.reason !== "remote_claim_missing") return observed;
  if (observed.record && observed.record.state !== "released") {
    return sameClaimOwner(observed.record, proposed)
      ? { decision: "READY", reason: "claim_already_owned", ref, sha: observed.sha, record: observed.record }
      : blocked("claim_conflict", `owner=${observed.record.actor}/${observed.record.owner_role}`);
  }

  const record = {
    version: 1,
    ...proposed,
    state: "claimed",
    previous_coordination_sha: observed.sha || null,
    updated_at: options.updatedAt || proposed.claimed_at,
    evidence: options.evidence || {},
    transition_history: [{
      from: null,
      to: "claimed",
      performed_by_session_id: proposed.session_id,
      at: options.updatedAt || proposed.claimed_at,
    }],
  };
  const commitSha = createCoordinationCommit(repoPath, record, observed.sha);
  const push = git(repoPath, ["push", "--porcelain", remote, `${commitSha}:${ref}`]);
  if (push.status !== 0) {
    const winner = inspectRemoteCoordination({ repoPath, remote, ref });
    return blocked(
      "claim_conflict",
      winner.record ? `owner=${winner.record.actor}/${winner.record.owner_role}` : trimEvidence(push.stderr || push.stdout),
    );
  }
  return { decision: "READY", reason: "remote_claim_acquired", ref, sha: commitSha, record };
}

export function transitionRemoteClaim(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const remote = options.remote || "origin";
  const ref = options.ref || coordinationRef(options.projectId, options.taskId);
  const observed = inspectRemoteCoordination({ repoPath, remote, ref });
  if (observed.decision !== "READY") return observed;
  if (!sameClaimOwner(observed.record, options.claim || {})) return blocked("claim_owner_mismatch");

  const currentIndex = REMOTE_STATE_ORDER.indexOf(observed.record.state);
  const nextIndex = REMOTE_STATE_ORDER.indexOf(options.nextState);
  if (options.nextState === "released") return blocked("atomic_closeout_required");
  if (currentIndex < 0 || nextIndex !== currentIndex + 1) {
    return blocked("invalid_state_transition", `${observed.record.state}->${options.nextState}`);
  }
  const transitionEvidence = validateTransitionEvidence({
    ...options,
    repoPath,
    remote,
    observed,
  });
  if (transitionEvidence.decision !== "READY") return transitionEvidence;

  const record = {
    ...observed.record,
    state: options.nextState,
    previous_coordination_sha: observed.sha,
    updated_at: options.updatedAt || new Date().toISOString(),
    evidence: {
      ...(observed.record.evidence || {}),
      ...(options.evidence || {}),
      ...(transitionEvidence.evidence || {}),
    },
    transition_history: [
      ...(observed.record.transition_history || []),
      {
        from: observed.record.state,
        to: options.nextState,
        performed_by_session_id: options.performedBySessionId || options.claim?.session_id,
        at: options.updatedAt || new Date().toISOString(),
      },
    ],
  };
  const commitSha = createCoordinationCommit(repoPath, record, observed.sha);
  const push = git(repoPath, ["push", "--porcelain", remote, `${commitSha}:${ref}`]);
  if (push.status !== 0) return blocked("coordination_transition_conflict", trimEvidence(push.stderr || push.stdout));
  return { decision: "READY", reason: `remote_state_${options.nextState}`, ref, sha: commitSha, record };
}

export function prepareRemoteRelease(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const remote = options.remote || "origin";
  const ref = options.ref || coordinationRef(options.projectId, options.taskId);
  const observed = inspectRemoteCoordination({ repoPath, remote, ref });
  if (observed.decision !== "READY") return observed;
  if (!sameClaimOwner(observed.record, options.claim || {})) return blocked("claim_owner_mismatch");
  if (observed.record.state !== "residual_zero") return blocked("invalid_state_transition", `${observed.record.state}->released`);
  const evidence = observed.record.evidence || {};
  if (!evidence.c1_sha || !Array.isArray(evidence.delivery_refs) || evidence.delivery_refs.length === 0) {
    return blocked("c1_delivery_proof_missing");
  }
  if (!evidence.authorization_proof) return blocked("authorization_proof_missing");
  if (!evidence.closeout_sync_proof) return blocked("closeout_sync_proof_missing");
  if (evidence.residual_proof?.residual_count !== 0 || !evidence.residual_proof?.scope_paths?.length) {
    return blocked("residual_proof_missing");
  }
  const record = {
    ...observed.record,
    state: "released",
    previous_coordination_sha: observed.sha,
    updated_at: options.updatedAt || new Date().toISOString(),
    evidence: { ...(observed.record.evidence || {}) },
    transition_history: [
      ...(observed.record.transition_history || []),
      {
        from: "residual_zero",
        to: "released",
        performed_by_session_id: options.performedBySessionId || options.claim?.session_id,
        at: options.updatedAt || new Date().toISOString(),
      },
    ],
  };
  const sha = createCoordinationCommit(repoPath, record, observed.sha);
  return { decision: "READY", reason: "remote_release_prepared", ref, sha, parent_sha: observed.sha, record };
}

export function finalizeRemoteCloseout(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const remote = options.remote || "origin";
  const prepared = options.prepared;
  if (!prepared || prepared.decision !== "READY" || prepared.reason !== "remote_release_prepared") {
    return blocked("release_proof_missing");
  }
  const observed = inspectRemoteCoordination({ repoPath, remote, ref: prepared.ref });
  if (observed.decision !== "READY" || observed.sha !== prepared.parent_sha || observed.record.state !== "residual_zero") {
    return blocked("coordination_transition_conflict");
  }
  const releaseRecord = readCoordinationCommit(repoPath, prepared.sha);
  if (!releaseRecord
    || releaseRecord.state !== "released"
    || releaseRecord.previous_coordination_sha !== prepared.parent_sha
    || prepared.ref !== coordinationRef(releaseRecord.project_id, releaseRecord.task_id)
    || !sameClaimOwner(observed.record, releaseRecord)
    || JSON.stringify(releaseRecord) !== JSON.stringify(prepared.record)) {
    return blocked("release_proof_invalid");
  }
  const mainRef = options.mainRef || "refs/heads/main";
  const oldMain = lsRemote(repoPath, remote, mainRef);
  if (oldMain.decision === "BLOCKED" || !oldMain.sha) return blocked("remote_main_missing");
  if (git(repoPath, ["merge-base", "--is-ancestor", oldMain.sha, options.c2Sha]).status !== 0) {
    return blocked("c2_not_fast_forward");
  }
  const c2Proof = inspectC2CloseoutTree({
    repoPath,
    prepared,
    c1Sha: options.c1Sha,
    c2Sha: options.c2Sha,
  });
  if (c2Proof.decision !== "READY") return c2Proof;
  const push = git(repoPath, [
    "push",
    "--atomic",
    "--porcelain",
    remote,
    `${options.c2Sha}:${mainRef}`,
    `${prepared.sha}:${prepared.ref}`,
  ]);
  if (push.status !== 0) return blocked("atomic_closeout_failed", trimEvidence(push.stderr || push.stdout));
  const finalMain = lsRemote(repoPath, remote, mainRef);
  const finalClaim = inspectRemoteCoordination({ repoPath, remote, ref: prepared.ref });
  if (finalMain.sha !== options.c2Sha || finalClaim.sha !== prepared.sha || finalClaim.record?.state !== "released") {
    return blocked("atomic_closeout_readback_failed");
  }
  return { decision: "READY", reason: "c2_and_release_remote_atomic", c2_sha: options.c2Sha, claim_sha: prepared.sha, ref: prepared.ref };
}

export function inspectC2CloseoutTree(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const prepared = options.prepared;
  const c2Sha = options.c2Sha;
  if (!prepared || prepared.decision !== "READY" || prepared.reason !== "remote_release_prepared") {
    return blocked("release_proof_missing");
  }
  if (!/^[0-9a-f]{40,64}$/i.test(String(c2Sha || ""))
    || git(repoPath, ["cat-file", "-e", `${c2Sha}^{commit}`]).status !== 0) {
    return blocked("c2_commit_missing");
  }
  if (!options.c1Sha) return blocked("c1_proof_missing");
  if (git(repoPath, ["merge-base", "--is-ancestor", options.c1Sha, c2Sha]).status !== 0) {
    return blocked("c2_missing_c1");
  }

  const record = prepared.record || {};
  const projectId = record.project_id;
  const taskId = record.task_id;
  const applied = readEventsAtCommit(repoPath, c2Sha, "task-events/applied", projectId, taskId);
  const releaseEvent = applied.find((event) => event.type === "task.released"
    && event.coordination?.remote_claim_ref === prepared.ref
    && event.coordination?.remote_claim_sha === prepared.sha
    && event.coordination?.remote_state === "released"
    && event.coordination?.remote_release_prepared === true
    && sameClaimOwner(record, claimFromEvent(event)));
  if (!releaseEvent) return blocked("c2_release_event_missing");
  const completedEvent = applied.find((event) => event.type === "task.completed"
    && sameClaimOwner(record, claimFromEvent(event)));
  if (!completedEvent) return blocked("c2_task_completed_event_missing");

  const state = readJsonAtCommit(repoPath, c2Sha, `milestones/${projectId}/state.json`);
  const task = state?.tasks?.[taskId];
  if (task?.status !== "completed"
    || task.coordination?.active_claim !== null
    || task.coordination?.last_release?.state !== "released"
    || !sameClaimOwner(record, task.coordination?.last_release || {})) {
    return blocked("c2_canonical_state_missing");
  }
  if (readEventsAtCommit(repoPath, c2Sha, "task-events/pending", projectId, taskId).length > 0) {
    return blocked("task_event_pending");
  }
  if (readEventsAtCommit(repoPath, c2Sha, "sync-events/pending", projectId, taskId).length > 0) {
    return blocked("sync_event_pending");
  }
  return {
    decision: "READY",
    reason: "c2_closeout_tree_bound",
    release_event_id: releaseEvent.event_id,
    completed_event_id: completedEvent.event_id,
  };
}

export function inspectRemoteCoordination(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const remote = options.remote || "origin";
  const ref = options.ref;
  if (!ref) return blocked("remote_claim_ref_missing");
  const remoteSha = lsRemote(repoPath, remote, ref);
  if (remoteSha.decision === "BLOCKED") return remoteSha;
  if (!remoteSha.sha) return blocked("remote_claim_missing");
  const fetch = git(repoPath, ["fetch", "--no-tags", remote, ref]);
  if (fetch.status !== 0) return blocked("auth_blocked", trimEvidence(fetch.stderr || fetch.stdout));
  const record = readCoordinationCommit(repoPath, remoteSha.sha);
  if (!record) return blocked("remote_claim_invalid");
  return { decision: "READY", reason: "remote_claim_observed", ref, sha: remoteSha.sha, record };
}

export function verifyRemoteCoordinationProof(options = {}) {
  const event = options.event || {};
  const proof = event.coordination || {};
  const expectedState = options.expectedState;
  if (!proof.remote_claim_ref || !proof.remote_claim_sha || proof.remote_state !== expectedState) {
    return blocked("remote_claim_proof_missing");
  }
  const repoPath = path.resolve(options.repoPath || ".");
  const observed = inspectRemoteCoordination({
    repoPath,
    remote: options.remote || "origin",
    ref: proof.remote_claim_ref,
  });
  if (observed.decision !== "READY") return observed;
  if (expectedState === "released" && proof.remote_release_prepared === true) {
    const record = readCoordinationCommit(repoPath, proof.remote_claim_sha);
    if (!record || record.state !== "released" || record.previous_coordination_sha !== observed.sha
      || !sameClaimOwner(record, claimFromEvent(event))) return blocked("remote_claim_proof_mismatch");
    return { decision: "READY", reason: "remote_release_prepared_verified", record, current: observed };
  }
  const ancestry = git(path.resolve(options.repoPath || "."), [
    "merge-base",
    "--is-ancestor",
    proof.remote_claim_sha,
    observed.sha,
  ]);
  if (ancestry.status !== 0) return blocked("remote_claim_proof_not_in_ancestry");
  const record = readCoordinationCommit(path.resolve(options.repoPath || "."), proof.remote_claim_sha);
  if (!record || record.state !== expectedState || !sameClaimOwner(record, claimFromEvent(event))) {
    return blocked("remote_claim_proof_mismatch");
  }
  return { decision: "READY", reason: "remote_claim_proof_verified", record, current: observed };
}

export function nextCloseoutAction(observation = {}) {
  const remoteState = observation.remote_claim?.state || null;
  const overlayState = observation.task_state?.coordination?.active_claim?.state || null;
  const taskStatus = observation.task_state?.status || observation.task_status || null;
  if (!remoteState) return readyAction("claim_task", "remote_claim_missing");
  if (remoteState === "claimed" && overlayState !== "claimed") return readyAction("apply_claim_event", "claim_not_in_overlay");
  if (remoteState === "claimed" && observation.git?.behind > 0) return blocked("needs_reconcile");
  if (remoteState === "claimed" && observation.git?.ahead > 0) return readyAction("push_c1", "c1_committed_not_remote");
  if (remoteState === "claimed" && observation.git?.head_sha
    && observation.git.head_sha !== observation.remote_claim?.base_sha) {
    return readyAction("record_c1_remote_synced", "c1_remote_without_coordination_transition");
  }
  if (remoteState === "claimed") return readyAction("create_and_deliver_c1", "c1_not_remote");
  if (remoteState === "c1_remote_synced" && overlayState !== "remote_synced") {
    return readyAction("apply_remote_synced_event", "remote_sync_not_in_overlay");
  }
  if (remoteState === "c1_remote_synced") return readyAction("authorize_canonical_apply", "canonical_not_applied");
  if (remoteState === "canonical_applied" && taskStatus !== "completed") {
    return readyAction("apply_task_completed_event", "canonical_state_not_applied");
  }
  if (remoteState === "canonical_applied") return readyAction("closeout_sync", "closeout_not_synced");
  if (remoteState === "closeout_synced") return readyAction("verify_residual_zero", "residual_not_verified");
  if (remoteState === "residual_zero" && observation.c2_local_ready) {
    return readyAction("atomic_deliver_c2_and_release", "c2_and_release_not_remote");
  }
  if (remoteState === "residual_zero") return readyAction("create_c2_with_release_event", "c2_not_committed");
  if (remoteState === "released" && overlayState) return blocked("release_event_missing_from_c2");
  if (remoteState === "released") return readyAction("terminal_verify", "all_mutating_states_satisfied");
  return blocked("unknown_coordination_state", remoteState);
}

export function inspectCloseoutState(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const root = path.resolve(options.root || repoPath);
  const ref = options.ref || coordinationRef(options.projectId, options.taskId);
  const remote = inspectRemoteCoordination({ repoPath, remote: options.remote || "origin", ref });
  if (remote.decision === "BLOCKED" && remote.reason !== "remote_claim_missing") return remote;
  const definition = readTaskDefinition(root, options.projectId, options.taskId);
  const overlay = readTaskOverlay(root, options.projectId, options.taskId);
  const taskState = { ...(definition || {}), ...(overlay || {}) };
  const remoteClaim = remote.decision === "READY" ? remote.record : null;
  const counts = git(repoPath, ["rev-list", "--left-right", "--count", `HEAD...${options.remote || "origin"}/main`]);
  const [ahead, behind] = counts.status === 0 ? counts.stdout.trim().split(/\s+/).map(Number) : [0, 0];
  return {
    ...nextCloseoutAction({
      remote_claim: remoteClaim,
      task_state: taskState,
      c2_local_ready: ahead > 0 && behind === 0,
      git: {
        ahead,
        behind,
        head_sha: git(repoPath, ["rev-parse", "HEAD"]).stdout.trim(),
      },
    }),
    observation: {
      remote_claim_ref: ref,
      remote_claim_sha: remote.sha || null,
      remote_claim: remoteClaim,
      task_state: taskState,
    },
  };
}

export function evaluateAuthorizationContinuation(approved = {}, current = {}) {
  for (const [field, reason] of AUTHORIZATION_FIELDS) {
    if (approved[field] !== current[field]) return blocked(reason);
  }
  if (approved.base_sha === current.base_sha) {
    return { decision: "READY", reason: "authorization_invariants_unchanged" };
  }
  if (current.base_relation !== "safe_non_overlapping_fast_forward") return blocked("base_not_safe");
  const changedPaths = new Set(current.changed_paths || []);
  const overlap = (current.commit_scope || []).find((filePath) => changedPaths.has(filePath));
  if (overlap) return blocked("base_path_overlap", overlap);
  return { decision: "READY", reason: "safe_non_overlapping_fast_forward" };
}

export function deriveAuthorizationSnapshot(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const input = options.input || {};
  const head = git(repoPath, ["rev-parse", "HEAD"]);
  if (head.status !== 0) throw new Error(`cannot derive authorization base: ${trimEvidence(head.stderr || head.stdout)}`);
  const commitScope = [...new Set((input.commit_scope || []).filter(Boolean))].sort();
  const grouping = input.grouping || [];
  const message = input.message || "";
  const verifiers = input.verifiers || [];
  return {
    authorization_schema: "jv37-git-derived-v1",
    scope_fingerprint: `sha256:${sha256(JSON.stringify(commitScope))}`,
    diff_fingerprint: `sha256:${scopeWorktreeFingerprint(repoPath, commitScope)}`,
    grouping_fingerprint: `sha256:${sha256(JSON.stringify(grouping))}`,
    message_fingerprint: `sha256:${sha256(message)}`,
    verifier_fingerprint: `sha256:${sha256(JSON.stringify(verifiers))}`,
    owner: input.owner || null,
    human_decision: input.human_decision || null,
    base_sha: head.stdout.trim(),
    commit_scope: commitScope,
    grouping,
    message,
    verifiers,
  };
}

export function inspectAuthorizationContinuation(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const approved = options.approved || {};
  const current = options.current || {};
  if (approved.authorization_schema !== "jv37-git-derived-v1") {
    return blocked("authorization_receipt_unbound");
  }
  const fetch = git(repoPath, ["fetch", "--prune", options.remote || "origin"]);
  if (fetch.status !== 0) return blocked("auth_blocked", trimEvidence(fetch.stderr || fetch.stdout));
  const head = git(repoPath, ["rev-parse", "HEAD"]);
  if (head.status !== 0) return blocked("base_not_safe");
  const currentBase = head.stdout.trim();
  const derived = deriveAuthorizationSnapshot({
    repoPath,
    input: {
      ...current,
      commit_scope: current.commit_scope || approved.commit_scope || [],
      grouping: current.grouping || approved.grouping || [],
      message: current.message ?? approved.message ?? "",
      verifiers: current.verifiers || approved.verifiers || [],
    },
  });
  if (approved.base_sha !== currentBase) {
    const ancestor = git(repoPath, ["merge-base", "--is-ancestor", approved.base_sha, currentBase]);
    if (ancestor.status !== 0) derived.base_relation = "non_fast_forward";
    else {
      derived.base_relation = "safe_non_overlapping_fast_forward";
      const changed = git(repoPath, ["diff", "--name-only", `${approved.base_sha}..${currentBase}`]);
      if (changed.status !== 0) return blocked("base_not_safe");
      derived.changed_paths = changed.stdout.split(/\r?\n/).filter(Boolean);
    }
  }
  return evaluateAuthorizationContinuation(approved, derived);
}

export function evaluateTerminalCloseout(state = {}) {
  if (!state.origin_contains_c1) return blocked("remote_missing_c1");
  if (!state.origin_contains_c2) return blocked("remote_missing_c2");
  if (state.ahead !== 0 || state.behind !== 0) return blocked("remote_not_synchronized");
  if (state.pending_task_events !== 0) return blocked("task_event_pending");
  if (state.pending_sync_events !== 0) return blocked("sync_event_pending");
  if (state.scope_residuals !== 0) return blocked("scope_residual_nonzero");
  if (state.canonical_state !== "task_completed") return blocked("task_not_completed");
  if (state.claim_state !== "released") return blocked("claim_not_released");
  return { decision: "READY", reason: "terminal_gate_passed" };
}

export function inspectTerminalCloseout(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const root = path.resolve(options.root || repoPath);
  const remote = options.remote || "origin";
  const targetRef = options.targetRef || "refs/heads/main";
  const fetch = git(repoPath, ["fetch", "--prune", remote]);
  if (fetch.status !== 0) return blocked("auth_blocked", trimEvidence(fetch.stderr || fetch.stdout));
  const upstream = `${remote}/${targetRef.replace(/^refs\/heads\//, "")}`;
  const counts = git(repoPath, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`]);
  if (counts.status !== 0) return blocked("remote_not_synchronized");
  const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
  if (!Array.isArray(options.scopePaths) || options.scopePaths.length === 0) {
    return blocked("scope_proof_missing");
  }
  const originContains = (sha) => Boolean(sha) && git(repoPath, ["merge-base", "--is-ancestor", sha, upstream]).status === 0;
  const taskDefinition = readJsonAtCommit(repoPath, options.c2Sha, `milestones/${options.projectId}/tasks.json`)
    ?.tasks?.find((task) => task.id === options.taskId) || {};
  const taskOverlay = readJsonAtCommit(repoPath, options.c2Sha, `milestones/${options.projectId}/state.json`)
    ?.tasks?.[options.taskId] || {};
  const taskState = { ...taskDefinition, ...taskOverlay };
  const claim = inspectRemoteCoordination({
    repoPath,
    remote,
    ref: options.claimRef || coordinationRef(options.projectId, options.taskId),
  });
  const receiptScope = [...new Set(options.scopePaths)].sort();
  const claimedScope = [...new Set(claim.record?.evidence?.residual_proof?.scope_paths || [])].sort();
  if (JSON.stringify(receiptScope) !== JSON.stringify(claimedScope)) {
    return blocked("scope_proof_mismatch");
  }
  const dirtyPaths = readDirtyPaths(repoPath);
  const scope = new Set(options.scopePaths || []);
  const state = {
    origin_contains_c1: originContains(options.c1Sha),
    origin_contains_c2: originContains(options.c2Sha),
    ahead,
    behind,
    pending_task_events: readEventsAtCommit(repoPath, options.c2Sha, "task-events/pending", options.projectId, options.taskId).length,
    pending_sync_events: readEventsAtCommit(repoPath, options.c2Sha, "sync-events/pending", options.projectId, options.taskId).length,
    scope_residuals: dirtyPaths.filter((filePath) => scope.has(filePath)).length,
    canonical_state: taskState.status === "completed" ? "task_completed" : taskState.status || "unknown",
    claim_state: claim.record?.state || "missing",
  };
  const terminal = evaluateTerminalCloseout(state);
  if (terminal.decision !== "READY") return { ...terminal, state, claim_sha: claim.sha || null };
  const c2Proof = inspectC2CloseoutTree({
    repoPath,
    c1Sha: options.c1Sha,
    c2Sha: options.c2Sha,
    prepared: {
      decision: "READY",
      reason: "remote_release_prepared",
      ref: options.claimRef || coordinationRef(options.projectId, options.taskId),
      sha: claim.sha,
      record: claim.record,
    },
  });
  if (c2Proof.decision !== "READY") return { ...c2Proof, state, claim_sha: claim.sha || null };
  return { ...terminal, state, claim_sha: claim.sha || null, c2_proof: c2Proof };
}

export function classifyRepoSnapshot(snapshot = {}) {
  if (!snapshot.fetch_ok) return blocked("auth_blocked");
  if (snapshot.branch_head === "(detached)" || snapshot.branch_head === "HEAD") return blocked("detached_blocked");
  if (!snapshot.upstream) return blocked("no_upstream");
  if (snapshot.branch_head !== "main") return blocked("non_main_branch", snapshot.branch_head);
  if (snapshot.conflicting_worktree) return blocked("worktree_conflict");
  if (snapshot.ahead > 0 && snapshot.behind > 0) return blocked("needs_reconcile");
  if (snapshot.ahead > 0) return blocked("needs_push");
  if (snapshot.behind > 0) {
    return snapshot.dirty_kind === "clean"
      ? { decision: "READY", reason: "ff_only_required", action: "git_merge_ff_only" }
      : blocked("dirty_blocked", snapshot.dirty_kind);
  }
  if (snapshot.dirty_kind !== "clean" && hasExactUnrelatedExclusions(snapshot)) {
    return { decision: "READY", reason: "unrelated_dirty_excluded", warning: true };
  }
  if (["manual", "mixed", "unknown"].includes(snapshot.dirty_kind)) return blocked("dirty_blocked", snapshot.dirty_kind);
  if (snapshot.dirty_kind === "generated_only") {
    return snapshot.generated_proof_valid
      ? { decision: "READY", reason: "generated_dirty_warning", warning: true }
      : blocked("dirty_blocked", "generated_not_verified");
  }
  return { decision: "READY", reason: "READY" };
}

export function inspectRepo(repoPath, options = {}) {
  const cwd = path.resolve(repoPath);
  const fetchResult = options.fetch === false ? { status: 0, stdout: "", stderr: "" } : git(cwd, ["fetch", "--prune"]);
  if (fetchResult.status !== 0) {
    const snapshot = { fetch_ok: false, branch_head: "unknown", upstream: null, ahead: 0, behind: 0, dirty_kind: "unknown" };
    return { ...classifyRepoSnapshot(snapshot), snapshot, evidence: trimEvidence(fetchResult.stderr) };
  }

  const statusResult = git(cwd, ["status", "--porcelain=v2", "--branch"]);
  if (statusResult.status !== 0) {
    const snapshot = { fetch_ok: false, branch_head: "unknown", upstream: null, ahead: 0, behind: 0, dirty_kind: "unknown" };
    return { ...classifyRepoSnapshot(snapshot), snapshot, evidence: trimEvidence(statusResult.stderr) };
  }

  const parsed = parsePorcelainV2(statusResult.stdout);
  const dirtyClassification = classifyDirtyPaths(cwd, parsed.dirty_paths, options);
  const hasOnlyExactExclusions = hasExactUnrelatedExclusions({
    dirty_paths: parsed.dirty_paths,
    approved_exclusions: options.exclusions || [],
    commit_scope: options.commitScope || [],
  });
  const snapshot = {
    fetch_ok: true,
    branch_head: parsed.branch_head,
    upstream: parsed.upstream,
    ahead: parsed.ahead,
    behind: parsed.behind,
    dirty_kind: parsed.dirty_count === 0 ? "clean" : hasOnlyExactExclusions ? "manual" : dirtyClassification.kind,
    generated_proof_valid: dirtyClassification.generatedProofValid,
    conflicting_worktree: hasConflictingWorktree(cwd, parsed.branch_head),
    staged_count: parsed.staged_count,
    unstaged_count: parsed.unstaged_count,
    untracked_count: parsed.untracked_count,
    dirty_paths: parsed.dirty_paths,
    approved_exclusions: options.exclusions || [],
    commit_scope: options.commitScope || [],
  };
  return { ...classifyRepoSnapshot(snapshot), snapshot };
}

function classifyDirtyPaths(repoPath, dirtyPaths, options) {
  if (dirtyPaths.length === 0) return { kind: "clean", generatedProofValid: false };
  const exclusions = new Set(options.exclusions || []);
  const scope = new Set(options.commitScope || []);
  if (scope.size > 0 && dirtyPaths.every((item) => exclusions.has(item) && !scope.has(item))) {
    return { kind: "manual", generatedProofValid: false };
  }

  const registryPath = path.resolve(repoPath, options.generatedRegistryPath || ".morrowise/repo-coordination-generated.json");
  if (!fs.existsSync(registryPath)) return { kind: "unknown", generatedProofValid: false };
  const relativeRegistry = path.relative(repoPath, registryPath);
  if (relativeRegistry.startsWith("..") || git(repoPath, ["ls-files", "--error-unmatch", "--", relativeRegistry]).status !== 0) {
    return { kind: "unknown", generatedProofValid: false };
  }
  let registry;
  try { registry = JSON.parse(fs.readFileSync(registryPath, "utf8")); } catch { return { kind: "unknown", generatedProofValid: false }; }
  const entries = new Map((registry.generated_paths || []).map((entry) => [entry.path, entry]));
  if (!dirtyPaths.every((item) => entries.has(item))) return { kind: "mixed", generatedProofValid: false };
  for (const dirtyPath of dirtyPaths) {
    const entry = entries.get(dirtyPath);
    const outputPath = path.resolve(repoPath, dirtyPath);
    if (!isInside(repoPath, outputPath) || !fs.existsSync(outputPath)) return { kind: "generated_only", generatedProofValid: false };
    if (!Array.isArray(entry.sources) || entry.sources.length === 0) return { kind: "generated_only", generatedProofValid: false };
    for (const source of entry.sources) {
      const sourcePath = path.resolve(repoPath, source.path || "");
      if (!isInside(repoPath, sourcePath) || !fs.existsSync(sourcePath) || sha256File(sourcePath) !== source.sha256) {
        return { kind: "generated_only", generatedProofValid: false };
      }
    }
    if (entry.mode === "managed_block") {
      const managed = verifyManagedBlock(outputPath, entry);
      if (managed.outsideChanged) return { kind: "mixed", generatedProofValid: false };
      if (!managed.valid) return { kind: "generated_only", generatedProofValid: false };
    } else if (entry.mode !== "generated_only" || sha256File(outputPath) !== entry.output_sha256) {
      return { kind: "generated_only", generatedProofValid: false };
    }
  }
  return { kind: "generated_only", generatedProofValid: true };
}

function verifyManagedBlock(filePath, entry) {
  const text = fs.readFileSync(filePath, "utf8");
  const start = String(entry.start_marker || "");
  const end = String(entry.end_marker || "");
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  if (!start || !end || startIndex < 0 || endIndex < 0
    || text.indexOf(start, startIndex + start.length) >= 0
    || text.indexOf(end, endIndex + end.length) >= 0) {
    return { valid: false, outsideChanged: true };
  }
  const generated = text.slice(startIndex + start.length, endIndex);
  const outside = `${text.slice(0, startIndex + start.length)}<JV37_MANAGED_BLOCK>${text.slice(endIndex)}`;
  const outsideChanged = sha256(outside) !== entry.outside_sha256;
  return {
    valid: !outsideChanged && sha256(generated) === entry.generated_sha256,
    outsideChanged,
  };
}

export function repoReady(repoPath, options = {}) {
  const initial = inspectRepo(repoPath, options);
  if (initial.reason !== "ff_only_required" || options.autoFf !== true) return initial;
  const ff = git(path.resolve(repoPath), ["merge", "--ff-only", initial.snapshot.upstream]);
  if (ff.status !== 0) return blocked("ff_only_failed", trimEvidence(ff.stderr || ff.stdout));
  const final = inspectRepo(repoPath, { ...options, fetch: false });
  return final.decision === "READY" ? { ...final, recovered_from: "ff_only_required" } : final;
}

export function recordPilotObservation(options = {}) {
  const prepared = preparePilotObservation(options);
  if (prepared.decision !== "READY") return prepared;
  const repoPath = path.resolve(options.repoPath || ".");
  const remote = options.remote || "origin";
  const record = prepared.record;
  const ref = `refs/jv37/pilots/${refSlug(record.pilot_id)}/sessions/${refSlug(record.session_id)}`;
  const existing = lsRemote(repoPath, remote, ref);
  if (existing.decision === "BLOCKED") return existing;
  if (existing.sha) return blocked("session_observation_already_exists", ref);
  const commitSha = createJsonCommit(repoPath, "observation.json", record, null);
  const push = git(repoPath, ["push", "--porcelain", remote, `${commitSha}:${ref}`]);
  if (push.status !== 0) return blocked("session_observation_race", trimEvidence(push.stderr || push.stdout));
  return { decision: "READY", reason: "session_observation_recorded", ref, sha: commitSha, record };
}

export function preparePilotObservation(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const remote = options.remote || "origin";
  const environmentId = options.environmentId || null;
  const pilotId = options.pilotId;
  const sessionId = options.sessionId;
  if (!pilotId || !sessionId) return blocked("pilot_identity_missing");
  const ready = inspectRepo(repoPath, {
    exclusions: options.exclusions || [],
    commitScope: options.commitScope || ["pilot-observation-receipt.json"],
  });
  const acceptable = ready.decision === "READY" && ["READY", "unrelated_dirty_excluded"].includes(ready.reason);
  if (!acceptable) return blocked("session_not_synchronized", ready.reason);
  const originSha = git(repoPath, ["rev-parse", ready.snapshot.upstream]).stdout.trim();
  const remoteUrl = normalizedRemoteUrl(repoPath, remote);
  const fixtureObservation = Boolean(options.fixtureEnvironmentId);
  const record = {
    version: 1,
    producer: "jv37-runtime",
    evidence_kind: fixtureObservation ? "simulated_session_observation" : "real_session_observation",
    pilot_id: pilotId,
    session_id: sessionId,
    ...(environmentId ? { environment_id: environmentId } : {}),
    branch: ready.snapshot.branch_head,
    remote_url_hash: sha256(remoteUrl),
    attestation_kind: fixtureObservation ? "fixture_injected" : "github_remote_actor",
    origin_sha: originSha,
    ahead: ready.snapshot.ahead,
    behind: ready.snapshot.behind,
    observed_at: options.observedAt || new Date().toISOString(),
  };
  return { decision: "READY", reason: "session_observation_prepared", record };
}

export function recordVerifierEvidence(options = {}) {
  const repoPath = path.resolve(options.repoPath || ".");
  const tasksPath = path.resolve(options.tasksPath || "milestones/morrowise/tasks.json");
  const tasks = JSON.parse(fs.readFileSync(tasksPath, "utf8"));
  const task = tasks.tasks?.find((item) => item.id === (options.taskId || "multi-machine-repo-coordination-gate"));
  if (!task) return blocked("task_missing");
  const fingerprint = `sha256:${sha256(JSON.stringify(task.acceptance_matrix || []))}`;
  const verifierPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "verify-multi-machine-repo-coordination-gate.mjs");
  const result = spawnSync(process.execPath, [verifierPath, "--case", "all-local"], { encoding: "utf8" });
  if (result.status !== 0) return blocked("runtime_verifier_failed", trimEvidence(result.stderr || result.stdout));
  const requiredIds = (task.acceptance_matrix || []).map((row) => row.id).filter((id) => id !== "JV37-E2E-06");
  const record = {
    version: 1,
    producer: "jv37-runtime",
    evidence_kind: "runtime_verifier_report",
    pilot_id: options.pilotId,
    task_id: task.id,
    matrix_fingerprint: fingerprint,
    required_ids: requiredIds,
    results: requiredIds.map((id) => ({ id, status: "pass" })),
    source_digest: runtimeSourceDigest(),
    output_sha256: sha256(result.stdout),
    verified_at: options.verifiedAt || new Date().toISOString(),
  };
  const ref = `refs/jv37/pilots/${refSlug(options.pilotId)}/verifier`;
  const existing = lsRemote(repoPath, options.remote || "origin", ref);
  if (existing.decision === "BLOCKED") return existing;
  if (existing.sha) return blocked("verifier_evidence_already_exists", ref);
  const commitSha = createJsonCommit(repoPath, "verifier-report.json", record, null);
  const push = git(repoPath, ["push", "--porcelain", options.remote || "origin", `${commitSha}:${ref}`]);
  if (push.status !== 0) return blocked("verifier_evidence_race", trimEvidence(push.stderr || push.stdout));
  return { decision: "READY", reason: "verifier_evidence_recorded", ref, sha: commitSha, record };
}

export function validatePilotReceipt(receipt, context = {}) {
  if (!receipt || typeof receipt !== "object") return blocked("real_pilot_receipt_missing");
  const fixtureReceipt = receipt.evidence_kind === "simulated_multi_clone_pilot";
  const allowedKind = receipt.evidence_kind === "real_multi_session_pilot"
    || (fixtureReceipt && context.allowFixtureAttestations === true);
  if (!allowedKind || receipt.producer !== "jv37-runtime") {
    return blocked("fixture_only");
  }
  if (!context.repoPath || !context.tasksPath) return blocked("source_verification_required");
  if (!Array.isArray(receipt.required_ids) || !Array.isArray(receipt.results)) return blocked("matrix_results_incomplete");
  const results = new Map(receipt.results.map((item) => [item?.id, item?.status]));
  if (results.size !== receipt.required_ids.length || receipt.required_ids.some((id) => results.get(id) !== "pass")) {
    return blocked("matrix_results_incomplete");
  }
  const tasksPath = path.resolve(context.tasksPath);
  const tasks = context.canonicalTasks || JSON.parse(fs.readFileSync(tasksPath, "utf8"));
  const definition = tasks.tasks?.find((item) => item.id === receipt.task_id);
  if (!definition) return blocked("task_not_completed");
  const fingerprint = `sha256:${sha256(JSON.stringify(definition.acceptance_matrix || []))}`;
  if (receipt.matrix_fingerprint !== fingerprint) return blocked("matrix_fingerprint_mismatch");
  const verifierRemote = lsRemote(path.resolve(context.repoPath), context.remote || "origin", receipt.verifier_ref);
  if (verifierRemote.decision === "BLOCKED" || !verifierRemote.sha || verifierRemote.sha !== receipt.verifier_sha) {
    return blocked("verifier_evidence_not_remote_bound");
  }
  const verifierFetch = git(path.resolve(context.repoPath), ["fetch", "--no-tags", context.remote || "origin", receipt.verifier_ref]);
  if (verifierFetch.status !== 0) return blocked("verifier_evidence_not_remote_bound");
  const verifier = readJsonCommit(path.resolve(context.repoPath), receipt.verifier_sha, "verifier-report.json");
  const localIds = receipt.required_ids.filter((id) => id !== "JV37-E2E-06");
  const verifierResults = new Map((verifier?.results || []).map((item) => [item.id, item.status]));
  if (!verifier
    || verifier.producer !== "jv37-runtime"
    || verifier.evidence_kind !== "runtime_verifier_report"
    || verifier.pilot_id !== receipt.pilot_id
    || verifier.task_id !== receipt.task_id
    || verifier.matrix_fingerprint !== fingerprint
    || verifier.source_digest !== runtimeSourceDigest()
    || verifier.required_ids.length !== localIds.length
    || localIds.some((id) => verifierResults.get(id) !== "pass")) {
    return blocked("verifier_evidence_invalid");
  }
  if (!Array.isArray(receipt.session_observations) || receipt.session_observations.length < 2) return blocked("real_pilot_missing");
  const repoPath = path.resolve(context.repoPath);
  const remote = context.remote || "origin";
  const remoteUrlHash = sha256(normalizedRemoteUrl(repoPath, remote));
  if (context.expectedRemoteUrlHash && context.expectedRemoteUrlHash !== remoteUrlHash) {
    return blocked("wrong_canonical_remote");
  }
  const seenSessions = new Set();
  let commonOrigin = null;
  for (const proof of receipt.session_observations) {
    const remoteSha = lsRemote(repoPath, remote, proof.ref);
    if (remoteSha.decision === "BLOCKED" || !remoteSha.sha || remoteSha.sha !== proof.sha) return blocked("session_evidence_not_remote_bound");
    const fetch = git(repoPath, ["fetch", "--no-tags", remote, proof.ref]);
    if (fetch.status !== 0) return blocked("session_evidence_not_remote_bound");
    const observed = readJsonCommit(repoPath, proof.sha, "observation.json");
    const expectedObservationKind = fixtureReceipt ? "simulated_session_observation" : "real_session_observation";
    const expectedAttestationKind = fixtureReceipt ? "fixture_injected" : "github_remote_actor";
    if (!observed
      || observed.producer !== "jv37-runtime"
      || observed.pilot_id !== receipt.pilot_id
      || observed.evidence_kind !== expectedObservationKind
      || observed.attestation_kind !== expectedAttestationKind) {
      return blocked("session_evidence_invalid");
    }
    if (observed.session_id !== proof.session_id
      || proof.ref !== `refs/jv37/pilots/${refSlug(receipt.pilot_id)}/sessions/${refSlug(observed.session_id)}`) return blocked("session_evidence_invalid");
    if (observed.remote_url_hash !== remoteUrlHash || observed.branch !== "main" || observed.ahead !== 0 || observed.behind !== 0) {
      return blocked("session_not_synchronized");
    }
    if (commonOrigin && commonOrigin !== observed.origin_sha) return blocked("session_head_mismatch");
    commonOrigin ||= observed.origin_sha;
    seenSessions.add(observed.session_id);
  }
  if (seenSessions.size < 2) return blocked("real_pilot_missing");

  const claim = inspectRemoteCoordination({ repoPath, remote, ref: receipt.claim_ref });
  if (claim.decision !== "READY" || claim.sha !== receipt.claim_sha || claim.record.state !== "released") {
    return blocked("claim_not_released");
  }
  const transitionSessions = new Set((claim.record.transition_history || []).map((entry) => entry.performed_by_session_id).filter(Boolean));
  if (transitionSessions.size < 2 || ![...transitionSessions].some((sessionId) => sessionId !== claim.record.session_id)) {
    return blocked("fresh_session_recovery_missing");
  }
  const authorization = claim.record.evidence?.authorization_proof;
  if (!authorization
    || !["authorization_invariants_unchanged", "safe_non_overlapping_fast_forward"].includes(authorization.reason)
    || authorization.approved_fingerprint !== authorization.current_fingerprint) {
    return blocked("authorization_invariants_failed");
  }
  const approval = inspectAuthorizationApproval({
    repoPath,
    remote,
    ref: authorization.approval_ref,
    sha: authorization.approval_sha,
  });
  if (approval.decision !== "READY"
    || approval.record.approver_id !== authorization.approver_id
    || approval.record.claim_id !== claim.record.claim_id
    || approval.record.project_id !== claim.record.project_id
    || approval.record.task_id !== claim.record.task_id) {
    return blocked(approval.decision === "BLOCKED" ? approval.reason : "authorization_approval_claim_mismatch");
  }
  if (claim.record.task_id !== definition.id) return blocked("task_not_completed");
  const terminal = inspectTerminalCloseout({
    repoPath,
    root: context.root || path.dirname(path.dirname(path.dirname(tasksPath))),
    remote,
    projectId: claim.record.project_id,
    taskId: claim.record.task_id,
    claimRef: receipt.claim_ref,
    c1Sha: receipt.c1_sha,
    c2Sha: receipt.c2_sha,
    scopePaths: receipt.scope_paths || [],
  });
  if (terminal.decision !== "READY") return blocked(terminal.reason, terminal.details);
  if (commonOrigin !== receipt.origin_sha) return blocked("session_head_mismatch");
  return { decision: "READY", reason: "real_pilot_receipt_source_verified", claim, terminal };
}

export function runtimeSourceDigest() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const hash = crypto.createHash("sha256");
  for (const relativePath of RUNTIME_SOURCE_FILES) {
    hash.update(relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(path.join(root, relativePath)));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function sameClaimOwner(active, proposed) {
  return CLAIM_IDENTITY_FIELDS.every((field) => active?.[field] === proposed?.[field]);
}

function claimFromEvent(event) {
  return { task_id: event.task_id, project_id: event.project, ...(event.coordination || {}) };
}

function parsePorcelainV2(output) {
  const lines = String(output || "").split("\n").filter(Boolean);
  const header = new Map();
  for (const line of lines.filter((item) => item.startsWith("# "))) {
    const separator = line.indexOf(" ", 2);
    if (separator > 0) header.set(line.slice(2, separator), line.slice(separator + 1));
  }
  const ab = /^\+(\d+)\s+-(\d+)$/.exec(header.get("branch.ab") || "") || [];
  const changes = lines.filter((item) => !item.startsWith("# "));
  return {
    branch_head: header.get("branch.head") || "unknown",
    upstream: header.get("branch.upstream") || null,
    ahead: Number(ab[1] || 0),
    behind: Number(ab[2] || 0),
    staged_count: changes.filter((line) => /^[12] [^.]/.test(line)).length,
    unstaged_count: changes.filter((line) => /^[12] ..[^.]/.test(line)).length,
    untracked_count: changes.filter((line) => line.startsWith("? ")).length,
    dirty_count: changes.length,
    dirty_paths: [...new Set(changes.flatMap(parsePorcelainPaths).filter(Boolean))],
  };
}

function parsePorcelainPaths(line) {
  if (line.startsWith("? ") || line.startsWith("! ")) return [unquotePath(line.slice(2))];
  if (line.startsWith("2 ")) {
    const [currentRecord, originalPath] = line.split("\t");
    return [unquotePath(currentRecord.split(" ").at(-1) || ""), unquotePath(originalPath || "")];
  }
  const tabIndex = line.lastIndexOf("\t");
  if (tabIndex >= 0) return [unquotePath(line.slice(tabIndex + 1))];
  return [unquotePath(line.split(" ").at(-1) || "")];
}

function unquotePath(value) {
  const text = String(value || "");
  if (!text.startsWith('"')) return text;
  try { return JSON.parse(text); } catch { return text; }
}

function hasExactUnrelatedExclusions(snapshot) {
  const dirtyPaths = snapshot.dirty_paths || [];
  const exclusions = new Set(snapshot.approved_exclusions || []);
  const commitScope = new Set(snapshot.commit_scope || []);
  return dirtyPaths.length > 0
    && commitScope.size > 0
    && dirtyPaths.every((filePath) => exclusions.has(filePath) && !commitScope.has(filePath));
}

function hasConflictingWorktree(cwd, branchHead) {
  if (!branchHead || branchHead === "(detached)" || branchHead === "unknown") return false;
  const result = git(cwd, ["worktree", "list", "--porcelain"]);
  if (result.status !== 0) return true;
  const target = `branch refs/heads/${branchHead}`;
  return result.stdout.split("\n").filter((line) => line === target).length > 1;
}

function createCoordinationCommit(repoPath, record, parentSha) {
  return createJsonCommit(repoPath, "coordination.json", record, parentSha);
}

function createJsonCommit(repoPath, fileName, record, parentSha) {
  const json = `${JSON.stringify(record, null, 2)}\n`;
  const blob = git(repoPath, ["hash-object", "-w", "--stdin"], { input: json });
  if (blob.status !== 0) throw new Error(`git hash-object failed: ${blob.stderr}`);
  const tree = git(repoPath, ["mktree"], { input: `100644 blob ${blob.stdout.trim()}\t${fileName}\n` });
  if (tree.status !== 0) throw new Error(`git mktree failed: ${tree.stderr}`);
  const args = ["commit-tree", tree.stdout.trim(), "-m", `jv37: ${record.state || record.evidence_kind}`];
  if (parentSha) args.push("-p", parentSha);
  const commit = git(repoPath, args, {
    env: {
      GIT_AUTHOR_NAME: "MorroWise JV-37 Runtime",
      GIT_AUTHOR_EMAIL: "jv37@local.invalid",
      GIT_COMMITTER_NAME: "MorroWise JV-37 Runtime",
      GIT_COMMITTER_EMAIL: "jv37@local.invalid",
    },
  });
  if (commit.status !== 0) throw new Error(`git commit-tree failed: ${commit.stderr}`);
  return commit.stdout.trim();
}

function readCoordinationCommit(repoPath, sha) {
  return readJsonCommit(repoPath, sha, "coordination.json");
}

function readJsonCommit(repoPath, sha, fileName) {
  if (!/^[0-9a-f]{40,64}$/i.test(String(sha || ""))) return null;
  const result = git(repoPath, ["show", `${sha}:${fileName}`]);
  if (result.status !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { return null; }
}

function readJsonAtCommit(repoPath, sha, relativePath) {
  return readJsonCommit(repoPath, sha, relativePath);
}

function readEventsAtCommit(repoPath, sha, relativeDir, projectId, taskId) {
  if (!/^[0-9a-f]{40,64}$/i.test(String(sha || ""))) return [];
  const listed = git(repoPath, ["ls-tree", "-r", "--name-only", sha, "--", relativeDir]);
  if (listed.status !== 0) return [];
  return listed.stdout.split(/\r?\n/).filter((fileName) => fileName.endsWith(".json")).flatMap((fileName) => {
    const event = readJsonAtCommit(repoPath, sha, fileName);
    return event?.project === projectId && event?.task_id === taskId ? [event] : [];
  });
}

function lsRemote(repoPath, remote, ref) {
  const result = git(repoPath, ["ls-remote", "--refs", remote, ref]);
  if (result.status !== 0) return blocked("auth_blocked", trimEvidence(result.stderr || result.stdout));
  const line = result.stdout.trim();
  if (!line) return { decision: "READY", sha: null };
  const [sha, returnedRef] = line.split(/\s+/);
  if (returnedRef !== ref) return blocked("remote_claim_ref_mismatch");
  return { decision: "READY", sha };
}

function normalizedRemoteUrl(repoPath, remote) {
  const result = git(repoPath, ["remote", "get-url", remote]);
  if (result.status !== 0) throw new Error(`remote ${remote} is unavailable`);
  const value = result.stdout.trim().replace(/\/$/, "");
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/^[^@/]+@([^:]+):/, "$1:");
  }
}

function readTrustRegistry(repoPath, remote) {
  const fetch = git(repoPath, ["fetch", "--prune", remote, "+refs/heads/main:refs/remotes/origin/main"]);
  if (fetch.status !== 0) return blocked("auth_blocked", trimEvidence(fetch.stderr || fetch.stdout));
  const mainSha = git(repoPath, ["rev-parse", "refs/remotes/origin/main"]);
  if (mainSha.status !== 0) return blocked("remote_main_missing");
  const registry = readJsonAtCommit(
    repoPath,
    mainSha.stdout.trim(),
    "system-workflow/registries/jv37-authorization-approvers.json",
  );
  if (!registry || registry.version !== 1 || !Array.isArray(registry.authorization_approvers)) {
    return blocked("jv37_authorization_registry_missing");
  }
  return { decision: "READY", reason: "jv37_authorization_registry_loaded", registry };
}

function verifyRecordSignature(record, publicKeyPem) {
  try {
    const { signature, ...unsigned } = record;
    if (!/^base64:[A-Za-z0-9+/=]+$/.test(signature || "")) return false;
    return crypto.verify(
      null,
      Buffer.from(canonicalJson(unsigned)),
      publicKeyPem,
      Buffer.from(signature.slice("base64:".length), "base64"),
    );
  } catch {
    return false;
  }
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateTransitionEvidence(options) {
  const repoPath = options.repoPath;
  const remote = options.remote;
  const nextState = options.nextState;
  const evidence = options.evidence || {};
  const root = path.resolve(options.root || repoPath);
  if (nextState === "c1_remote_synced") {
    if (!Array.isArray(evidence.delivery_refs) || evidence.delivery_refs.length === 0) {
      return blocked("c1_delivery_proof_missing");
    }
    const fetch = git(repoPath, ["fetch", "--prune", remote]);
    if (fetch.status !== 0) return blocked("auth_blocked", trimEvidence(fetch.stderr || fetch.stdout));
    const upstream = `${remote}/main`;
    const counts = git(repoPath, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`]);
    if (counts.status !== 0 || counts.stdout.trim() !== "0\t0") return blocked("c1_remote_not_synchronized");
    const originSha = git(repoPath, ["rev-parse", upstream]);
    if (originSha.status !== 0 || originSha.stdout.trim() === options.observed.record.base_sha) return blocked("c1_remote_missing");
    for (const ref of evidence.delivery_refs) {
      const delivery = inspectC1Delivery({ repoPath, remote, ref });
      if (delivery.decision !== "READY") return delivery;
      if (delivery.record.project_id !== options.observed.record.project_id
        || delivery.record.task_id !== options.observed.record.task_id
        || delivery.record.base_sha !== options.observed.record.base_sha
        || git(repoPath, ["merge-base", "--is-ancestor", delivery.record.commit_sha, originSha.stdout.trim()]).status !== 0) {
        return blocked("c1_delivery_not_integrated");
      }
    }
    if (evidence.c1_sha && evidence.c1_sha !== originSha.stdout.trim()) return blocked("c1_sha_mismatch");
    return {
      decision: "READY",
      reason: "c1_remote_evidence_verified",
      evidence: { c1_sha: originSha.stdout.trim(), delivery_refs: [...evidence.delivery_refs] },
    };
  }
  if (nextState === "canonical_applied") {
    const approval = inspectAuthorizationApproval({
      repoPath,
      remote,
      ref: evidence.authorization_approval_ref,
      sha: evidence.authorization_approval_sha,
    });
    if (approval.decision !== "READY") return approval;
    if (approval.record.project_id !== options.observed.record.project_id
      || approval.record.task_id !== options.observed.record.task_id
      || approval.record.claim_id !== options.observed.record.claim_id) {
      return blocked("authorization_approval_claim_mismatch");
    }
    const approved = approval.record.snapshot;
    const currentInput = evidence.authorization_current || approved;
    const continuation = inspectAuthorizationContinuation({
      repoPath,
      remote,
      approved,
      current: currentInput,
    });
    if (continuation.decision !== "READY") return continuation;
    const current = deriveAuthorizationSnapshot({
      repoPath,
      input: {
        ...currentInput,
        commit_scope: currentInput.commit_scope || approved.commit_scope || [],
        grouping: currentInput.grouping || approved.grouping || [],
        message: currentInput.message ?? approved.message ?? "",
        verifiers: currentInput.verifiers || approved.verifiers || [],
      },
    });
    const approvedFingerprint = authorizationInvariantFingerprint(approved);
    const currentFingerprint = authorizationInvariantFingerprint(current);
    if (approvedFingerprint !== currentFingerprint) return blocked("authorization_invariants_failed");
    return {
      decision: "READY",
      reason: "authorization_evidence_verified",
      evidence: {
        authorization_proof: {
          reason: continuation.reason,
          approved_fingerprint: approvedFingerprint,
          current_fingerprint: currentFingerprint,
          approved_base_sha: approved.base_sha,
          current_base_sha: current.base_sha,
          schema: approved.authorization_schema,
          approval_ref: approval.ref,
          approval_sha: approval.sha,
          approver_id: approval.record.approver_id,
          verifier_results: approval.record.verifier_results,
        },
      },
    };
  }
  if (nextState === "closeout_synced") {
    const task = {
      ...(readTaskDefinition(root, options.observed.record.project_id, options.observed.record.task_id) || {}),
      ...(readTaskOverlay(root, options.observed.record.project_id, options.observed.record.task_id) || {}),
    };
    if (task.status !== "completed") return blocked("task_not_completed");
    if (countMatchingEvents(root, "task-events/pending", options.observed.record.project_id, options.observed.record.task_id) > 0) {
      return blocked("task_event_pending");
    }
    if (countMatchingEvents(root, "sync-events/pending", options.observed.record.project_id, options.observed.record.task_id) > 0) {
      return blocked("sync_event_pending");
    }
    const syncedCount = countMatchingEvents(root, "sync-events/synced", options.observed.record.project_id, options.observed.record.task_id);
    if (syncedCount === 0) return blocked("closeout_sync_proof_missing");
    return {
      decision: "READY",
      reason: "closeout_sync_evidence_verified",
      evidence: { closeout_sync_proof: { synced_event_count: syncedCount } },
    };
  }
  if (nextState === "residual_zero") {
    const scopePaths = [...new Set((evidence.scope_paths || []).filter(Boolean))].sort();
    if (scopePaths.length === 0) return blocked("residual_scope_missing");
    const residuals = readDirtyPaths(repoPath).filter((filePath) => scopePaths.includes(filePath));
    if (residuals.length > 0) return blocked("scope_residual_nonzero", residuals.join(","));
    if (countMatchingEvents(root, "task-events/pending", options.observed.record.project_id, options.observed.record.task_id) > 0) {
      return blocked("task_event_pending");
    }
    if (countMatchingEvents(root, "sync-events/pending", options.observed.record.project_id, options.observed.record.task_id) > 0) {
      return blocked("sync_event_pending");
    }
    return {
      decision: "READY",
      reason: "residual_evidence_verified",
      evidence: { residual_proof: { scope_paths: scopePaths, residual_count: 0 } },
    };
  }
  return { decision: "READY", reason: "transition_has_no_extra_evidence", evidence: {} };
}

function readTaskDefinition(root, projectId, taskId) {
  const taskPath = path.join(root, "milestones", projectId || "", "tasks.json");
  if (!fs.existsSync(taskPath)) return null;
  return JSON.parse(fs.readFileSync(taskPath, "utf8")).tasks?.find((task) => task.id === taskId) || null;
}

function readTaskOverlay(root, projectId, taskId) {
  const statePath = path.join(root, "milestones", projectId || "", "state.json");
  if (!fs.existsSync(statePath)) return null;
  return JSON.parse(fs.readFileSync(statePath, "utf8")).tasks?.[taskId] || null;
}

function countMatchingEvents(root, relativeDir, projectId, taskId) {
  const dir = path.join(root, relativeDir);
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((fileName) => {
    if (!fileName.endsWith(".json")) return false;
    try {
      const event = JSON.parse(fs.readFileSync(path.join(dir, fileName), "utf8"));
      return event.project === projectId && event.task_id === taskId;
    } catch {
      return true;
    }
  }).length;
}

function readDirtyPaths(repoPath) {
  const status = git(repoPath, ["status", "--porcelain=v2", "--branch"]);
  return status.status === 0 ? parsePorcelainV2(status.stdout).dirty_paths : [];
}

function git(cwd, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    input: options.input,
    env: { ...process.env, ...(options.env || {}) },
  });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "" };
}

function readyAction(action, reason) {
  return { decision: "READY", action, reason };
}

function refSlug(value) {
  const slug = String(value || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!slug) throw new Error("ref component cannot be empty");
  return slug;
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function scopeWorktreeFingerprint(repoPath, commitScope) {
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify(commitScope));
  if (commitScope.length === 0) return hash.digest("hex");
  const status = git(repoPath, ["status", "--porcelain=v2", "--untracked-files=all", "--", ...commitScope]);
  const diff = git(repoPath, ["diff", "--binary", "HEAD", "--", ...commitScope]);
  if (status.status !== 0 || diff.status !== 0) throw new Error("cannot derive authorization diff");
  hash.update("\0status\0");
  hash.update(status.stdout);
  hash.update("\0diff\0");
  hash.update(diff.stdout);
  const untracked = parsePorcelainV2(status.stdout).dirty_paths.filter((filePath) => {
    const tracked = git(repoPath, ["ls-files", "--error-unmatch", "--", filePath]);
    return tracked.status !== 0;
  });
  for (const filePath of untracked.sort()) {
    const absolute = path.join(repoPath, filePath);
    hash.update(`\0untracked\0${filePath}\0`);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) hash.update(fs.readFileSync(absolute));
  }
  return hash.digest("hex");
}

function authorizationInvariantFingerprint(snapshot) {
  const invariant = Object.fromEntries(AUTHORIZATION_FIELDS.map(([field]) => [field, snapshot?.[field] ?? null]));
  return `sha256:${sha256(JSON.stringify(invariant))}`;
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function trimEvidence(value) {
  return String(value || "").trim().slice(0, 500);
}

function blocked(reason, details = "") {
  return { decision: "BLOCKED", reason, ...(details ? { details } : {}) };
}

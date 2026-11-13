// Only meaningful health changes may reach the existing notification adapter.
// Transport is mandatory injection: importing/testing this module cannot send.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SCHEMA = "system-pulse-notification.v1";
const GATE = "task-events:pending-gate";

export function snapshotPulseReport(report) {
  if (report?.schema_version !== "system-pulse.v0" ||
      !Number.isFinite(Date.parse(report.finished_at)) ||
      !["healthy", "degraded"].includes(report.status) ||
      !Array.isArray(report.steps) || report.steps.length === 0) return null;
  if (report.steps.some((step) => !step || typeof step !== "object")) return null;
  const ids = report.steps.map((step) => step.id);
  if (ids.some((id) => typeof id !== "string" || !id) || new Set(ids).size !== ids.length ||
      report.steps.some((step) => !["pass", "fail"].includes(step.status))) return null;
  const failures = report.steps.filter((step) => step.status === "fail").map((step) => step.id).sort();
  if ((failures.length === 0) !== (report.status === "healthy") ||
      report.summary?.failed !== failures.length || report.summary?.total !== ids.length ||
      report.summary?.passed !== ids.length - failures.length) return null;
  const pending = report.task_event_state?.task_events?.pending;
  return {
    status: report.status,
    failures,
    pending_task_events: failures.includes(GATE) && Number.isInteger(pending) && pending >= 0 ? pending : null,
  };
}

function validState(state) {
  const snapshot = state?.snapshot;
  return state?.schema_version === SCHEMA && Number.isFinite(Date.parse(state.observed_at)) &&
    ["healthy", "degraded"].includes(snapshot?.status) && Array.isArray(snapshot.failures) &&
    snapshot.failures.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(snapshot.failures).size === snapshot.failures.length &&
    (snapshot.failures.length === 0) === (snapshot.status === "healthy") &&
    (snapshot.pending_task_events === null ||
      (Number.isInteger(snapshot.pending_task_events) && snapshot.pending_task_events >= 0));
}

export function evaluatePulseTransition(previous, current) {
  const newFailures = current.failures.filter((id) => !previous.failures.includes(id));
  const worsened = [];
  if (previous.status === "healthy" && current.status === "degraded") worsened.push("healthy_to_degraded");
  if (previous.failures.includes(GATE) && current.failures.includes(GATE) &&
      previous.pending_task_events !== null && current.pending_task_events !== null &&
      current.pending_task_events > previous.pending_task_events) worsened.push("pending_task_events_increased");
  return {
    reason: newFailures.length ? "new_failures" : worsened.length ? "state_worsened" :
      current.status === "healthy" ? "healthy" : "unchanged_or_improved",
    new_failures: newFailures,
    worsened,
  };
}

export function readPulseReport(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

function atomicWrite(filePath, value) {
  const tmp = `${filePath}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    fs.renameSync(tmp, filePath);
  } finally {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
  }
}

export function finalizePulseNotification({ report, previousReport, statePath, reportPath, send }) {
  const current = snapshotPulseReport(report);
  const empty = { new_failures: [], worsened: [] };
  if (!current) return { status: "blocked", reason: "invalid_report", ...empty };
  if (typeof send !== "function") throw new TypeError("send callback is required");
  // Keep publication inside the same lock as comparison so an older run cannot
  // overwrite a newer public report after releasing its decision lock.
  const publish = (notification) => {
    if (!reportPath) return true; // Offline decision tests need no public artifact.
    try {
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      atomicWrite(reportPath, { ...report, notification });
      return true;
    } catch { return false; }
  };
  let lock;
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    lock = fs.openSync(`${statePath}.lock`, "wx", 0o600);
  } catch {
    return { status: "blocked", reason: "lock_unavailable", ...empty };
  }
  try {
    try {
      fs.writeFileSync(lock, `${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`);
    } catch { return { status: "blocked", reason: "lock_write_failed", ...empty }; }
    let previous = null;
    let baselineReason = "baseline_initialized";
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (validState(state)) previous = state;
      else baselineReason = "baseline_invalid";
    } catch (error) {
      if (error.code === "ENOENT") {
        const seed = snapshotPulseReport(previousReport);
        if (seed && Date.parse(previousReport.finished_at) < Date.parse(report.finished_at)) {
          previous = { schema_version: SCHEMA, observed_at: previousReport.finished_at, snapshot: seed, last_attempt: null };
        }
      } else if (error instanceof SyntaxError) {
        baselineReason = "baseline_invalid";
      } else {
        return { status: "blocked", reason: "baseline_unreadable", ...empty };
      }
    }
    if (previous && Date.parse(report.finished_at) <= Date.parse(previous.observed_at)) {
      return { status: "silent", reason: "stale_observation", ...empty };
    }
    const decision = previous ? evaluatePulseTransition(previous.snapshot, current) :
      { reason: baselineReason, ...empty };
    decision.previous_observed_at = previous?.observed_at || null;
    const shouldSend = decision.new_failures.length > 0 || decision.worsened.length > 0;
    const attempt = shouldSend ? {
      attempt_id: randomUUID(), observed_at: report.finished_at, status: "pending", ...decision,
    } : previous?.last_attempt || null;
    const state = {
      schema_version: SCHEMA, observed_at: report.finished_at, snapshot: current,
      decision, last_attempt: attempt,
    };
    // Reserve the transition BEFORE transport. Unknown delivery never causes an automatic retry.
    try { atomicWrite(statePath, state); } catch {
      return { status: "blocked", reason: "state_write_failed", ...empty };
    }
    if (!shouldSend) {
      const notification = { status: "silent", ...decision };
      return publish(notification) ? notification : { status: "blocked", reason: "report_write_failed", ...empty };
    }
    // Publish evidence before transport; a broken report path must not send.
    if (!publish({ status: "pending", ...decision, attempt_id: attempt.attempt_id })) {
      return { status: "blocked", reason: "report_write_failed", ...empty };
    }
    let outcome;
    try {
      const response = send(decision);
      // Do not persist raw transport output or arbitrary exception text.
      outcome = response && ["sent", "failed", "skipped", "skipped_missing_env", "unknown"].includes(response.status)
        ? { status: response.status, ...(Number.isInteger(response.exit_code) ? { exit_code: response.exit_code } : {}) }
        : { status: "unknown", transport_reason: "invalid_transport_result" };
    } catch {
      outcome = { status: "unknown", transport_reason: "transport_exception" };
    }
    Object.assign(attempt, outcome);
    try { atomicWrite(statePath, state); } catch {
      return { status: "unknown", reason: "receipt_write_failed", attempt_id: attempt.attempt_id, ...empty };
    }
    const notification = { ...decision, ...outcome, attempt_id: attempt.attempt_id };
    return publish(notification) ? notification : {
      status: "unknown", reason: "report_receipt_write_failed", attempt_id: attempt.attempt_id, ...empty,
    };
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(`${statePath}.lock`);
  }
}

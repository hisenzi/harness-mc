import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

const LOCAL_STATES = new Set(["clean", "dirty", "unknown"]);
const UPSTREAM_STATES = new Set(["in_sync", "ahead", "behind", "diverged", "remote_different", "unknown", "missing"]);
const FORBIDDEN_METADATA_FIELDS = new Set([
  "token",
  "secret",
  "password",
  "cookie",
  "credential",
  "runtime_auth",
  "access_token",
  "refresh_token",
]);
const DEFAULT_MAX_AGE_SECONDS = 15 * 60;
const SAFE_PROBE_EVIDENCE = Symbol("account-login-sync-start.safe-probe-evidence");

const WRITE_BOUNDARY = Object.freeze({
  read_only: true,
  forbidden: [
    "git fetch",
    "git pull",
    "git reset",
    "git checkout",
    "git commit",
    "git push",
    "account login",
    "read secret values",
  ],
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertNoForbiddenInputFields(value) {
  if (Array.isArray(value)) {
    for (const entry of value) assertNoForbiddenInputFields(entry);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLowerCase().replaceAll("-", "_");
    if (FORBIDDEN_METADATA_FIELDS.has(normalized)) {
      throw new Error(`forbidden input field: ${key}`);
    }
    assertNoForbiddenInputFields(entry);
  }
}

function validateRepositories(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("repositories must be a non-empty array");
  }
  const seen = new Set();
  return value.map((repository) => {
    if (!isPlainObject(repository)) throw new Error("repository must be an object");
    const {
      id,
      origin_configured: originConfigured,
      local_state: localState,
      upstream_state: upstreamState,
      branch = null,
      local_head: localHead = null,
      remote_head: remoteHead = null,
      remote_checked: remoteChecked = false,
    } = repository;
    if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new Error("repository id must be a lower-case stable identifier");
    }
    if (seen.has(id)) throw new Error(`duplicate repository: ${id}`);
    seen.add(id);
    if (typeof originConfigured !== "boolean") throw new Error("repository origin_configured must be boolean");
    if (!LOCAL_STATES.has(localState)) throw new Error(`unsupported repository local_state: ${localState}`);
    if (!UPSTREAM_STATES.has(upstreamState)) throw new Error(`unsupported repository upstream_state: ${upstreamState}`);
    if (branch !== null && typeof branch !== "string") throw new Error("repository branch must be string or null");
    if (localHead !== null && !/^[a-f0-9]{40}$/.test(localHead)) throw new Error("repository local_head must be a Git SHA or null");
    if (remoteHead !== null && !/^[a-f0-9]{40}$/.test(remoteHead)) throw new Error("repository remote_head must be a Git SHA or null");
    if (typeof remoteChecked !== "boolean") throw new Error("repository remote_checked must be boolean");
    return {
      id,
      origin_configured: originConfigured,
      local_state: localState,
      upstream_state: upstreamState,
      branch,
      local_head: localHead,
      remote_head: remoteHead,
      remote_checked: remoteChecked,
    };
  });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function evidenceDigest(repositories, observedAt) {
  const payload = JSON.stringify(stableValue({ observed_at: observedAt, repositories }));
  return `sha256:${crypto.createHash("sha256").update(payload).digest("hex")}`;
}

function buildRuntimeEvidence(repositories, observedAt) {
  const digest = evidenceDigest(repositories, observedAt);
  const evidence = {
    kind: "safe_probe",
    observed_at: observedAt,
    evidence_ref: `safe-probe:${digest}`,
    evidence_digest: digest,
    verifier: "probeAccountLoginSyncStart",
  };
  Object.defineProperty(evidence, SAFE_PROBE_EVIDENCE, { value: true });
  return evidence;
}

function buildFreshness(state, observedAt, evaluatedAt, maxAgeSeconds, ageSeconds = null) {
  return {
    state,
    observed_at: observedAt ?? null,
    evaluated_at: evaluatedAt,
    age_seconds: ageSeconds,
    max_age_seconds: maxAgeSeconds,
  };
}

function evidenceOutput(runtimeEvidence, repositories) {
  if (!isPlainObject(runtimeEvidence)) return null;
  return {
    reference: runtimeEvidence.evidence_ref || null,
    digest: runtimeEvidence.evidence_digest || null,
    verifier: runtimeEvidence.verifier || null,
    verifier_result: "safe_probe_verified",
    repositories: repositories.map(({ id, branch, local_head: localHead, remote_head: remoteHead, upstream_state: upstreamState }) => ({
      id,
      branch,
      local_head: localHead,
      remote_head: remoteHead,
      upstream_state: upstreamState,
    })),
  };
}

function decisionResult(decision, reason, kind, { freshness = null, evidence = null } = {}) {
  return {
    decision,
    blocked_reasons: reason ? [reason] : [],
    next_action: { kind },
    ...(freshness ? { freshness } : {}),
    ...(evidence ? { evidence } : {}),
    write_boundary: WRITE_BOUNDARY,
  };
}

function blockedResult(reason, kind, context) {
  return decisionResult("blocked", reason, kind, context);
}

function degradedResult(reason, kind, context) {
  return decisionResult("degraded", reason, kind, context);
}

function parseIsoTimestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(String(value || ""))) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) return null;
  return parsed;
}

function validateRuntimeEvidence(runtimeEvidence, repositories, { evaluatedAt, maxAgeSeconds }) {
  if (!isPlainObject(runtimeEvidence)) {
    return { result: degradedResult("fixture_only_runtime_evidence", "run_safe_probe") };
  }
  if (runtimeEvidence.kind === "fixture") {
    return { result: degradedResult("fixture_only_runtime_evidence", "run_safe_probe") };
  }
  if (runtimeEvidence.kind !== "safe_probe") {
    return { result: degradedResult("untrusted_runtime_evidence", "run_safe_probe") };
  }
  if (runtimeEvidence[SAFE_PROBE_EVIDENCE] !== true) {
    return { result: degradedResult("untrusted_runtime_evidence", "run_safe_probe") };
  }
  if (runtimeEvidence.verifier !== "probeAccountLoginSyncStart") {
    return { result: degradedResult("untrusted_runtime_evidence", "run_safe_probe") };
  }

  const evaluatedTime = parseIsoTimestamp(evaluatedAt);
  if (evaluatedTime === null) throw new Error("evaluatedAt must be a valid ISO timestamp");
  const observedTime = parseIsoTimestamp(runtimeEvidence.observed_at);
  if (observedTime === null) {
    const freshness = buildFreshness("invalid", runtimeEvidence.observed_at, evaluatedAt, maxAgeSeconds);
    return { result: degradedResult("runtime_evidence_timestamp_invalid", "run_safe_probe", { freshness }) };
  }

  const ageSeconds = (evaluatedTime - observedTime) / 1000;
  if (ageSeconds < 0) {
    const freshness = buildFreshness("future", runtimeEvidence.observed_at, evaluatedAt, maxAgeSeconds, ageSeconds);
    return { result: degradedResult("runtime_evidence_from_future", "check_system_clock", { freshness }) };
  }
  if (ageSeconds > maxAgeSeconds) {
    const freshness = buildFreshness("stale", runtimeEvidence.observed_at, evaluatedAt, maxAgeSeconds, ageSeconds);
    return { result: degradedResult("runtime_evidence_stale", "run_safe_probe", { freshness }) };
  }

  const freshness = buildFreshness("fresh", runtimeEvidence.observed_at, evaluatedAt, maxAgeSeconds, ageSeconds);
  const expectedDigest = evidenceDigest(repositories, runtimeEvidence.observed_at);
  if (runtimeEvidence.evidence_digest !== expectedDigest || runtimeEvidence.evidence_ref !== `safe-probe:${expectedDigest}`) {
    return { result: degradedResult("runtime_evidence_digest_mismatch", "run_safe_probe", { freshness }) };
  }
  const evidence = evidenceOutput(runtimeEvidence, repositories);
  return { freshness, evidence };
}

export function evaluateAccountLoginSyncStart(input, {
  evaluatedAt = new Date().toISOString(),
  maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS,
} = {}) {
  if (!isPlainObject(input)) throw new Error("bootstrap input must be an object");
  if (Object.hasOwn(input, "account_metadata")) {
    throw new Error("account metadata is out of scope; Vincent manages login");
  }
  assertNoForbiddenInputFields(input);
  const repositories = validateRepositories(input.repositories);
  const evidenceValidation = validateRuntimeEvidence(input.runtime_evidence, repositories, { evaluatedAt, maxAgeSeconds });
  if (evidenceValidation.result) return evidenceValidation.result;
  const context = { freshness: evidenceValidation.freshness, evidence: evidenceValidation.evidence };

  for (const repository of repositories) {
    if (!repository.origin_configured) return blockedResult(`origin_missing:${repository.id}`, "configure_remote_without_writing", context);
    if (repository.local_state === "dirty") return blockedResult(`local_changes_present:${repository.id}`, "classify_local_changes", context);
    if (repository.local_state === "unknown") return degradedResult(`local_state_unknown:${repository.id}`, "run_safe_probe", context);
    if (!repository.remote_checked) return degradedResult(`remote_truth_not_probed:${repository.id}`, "run_read_only_remote_probe", context);
    if (!repository.local_head || !repository.remote_head) return degradedResult(`git_sha_evidence_missing:${repository.id}`, "run_read_only_remote_probe", context);
    if (["ahead", "behind", "diverged", "remote_different"].includes(repository.upstream_state)) {
      return blockedResult(`upstream_not_in_sync:${repository.id}:${repository.upstream_state}`, "classify_remote_difference", context);
    }
    if (repository.upstream_state === "missing") return blockedResult(`upstream_missing:${repository.id}`, "configure_upstream_without_writing", context);
    if (repository.upstream_state === "unknown") return degradedResult(`upstream_state_unknown:${repository.id}`, "run_read_only_remote_probe", context);
    if (repository.local_head !== repository.remote_head) {
      return blockedResult(`upstream_not_in_sync:${repository.id}:remote_different`, "classify_remote_difference", context);
    }
  }

  return decisionResult("ready", null, "begin_work_from_canonical_sources", context);
}

function git(root, args) {
  try {
    return {
      ok: true,
      stdout: execFileSync("git", args, {
        cwd: root,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim(),
    };
  } catch {
    return { ok: false, stdout: "" };
  }
}

function stableRepositoryId(root, originUrl = "") {
  const originMatch = /([^/:]+?)(?:\.git)?$/.exec(originUrl);
  const candidate = originMatch?.[1] || path.basename(root);
  return candidate.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
}

function repositoryProbe({ id, originConfigured, localState, upstreamState, branch, localHead, remoteHead, remoteChecked }) {
  return {
    id,
    origin_configured: originConfigured,
    local_state: localState,
    upstream_state: upstreamState,
    branch: branch || null,
    local_head: localHead || null,
    remote_head: remoteHead || null,
    remote_checked: remoteChecked,
  };
}

export function probeAccountLoginSyncStart({ root = process.cwd(), observedAt = new Date().toISOString(), probeRemote = false } = {}) {
  const resolvedRoot = path.resolve(root);
  const gitRoot = git(resolvedRoot, ["rev-parse", "--show-toplevel"]);
  if (!gitRoot.ok) {
    const repositories = [repositoryProbe({
      id: stableRepositoryId(resolvedRoot),
      originConfigured: false,
      localState: "unknown",
      upstreamState: "missing",
      branch: null,
      localHead: null,
      remoteHead: null,
      remoteChecked: false,
    })];
    return { repositories, runtime_evidence: buildRuntimeEvidence(repositories, observedAt) };
  }

  const dirty = git(resolvedRoot, ["status", "--porcelain=v1"]);
  const origin = git(resolvedRoot, ["config", "--get", "remote.origin.url"]);
  const upstream = git(resolvedRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  const localHead = git(resolvedRoot, ["rev-parse", "HEAD"]);
  const currentBranch = git(resolvedRoot, ["branch", "--show-current"]);
  const aheadBehind = upstream.ok
    ? git(resolvedRoot, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
    : { ok: false, stdout: "" };

  let upstreamState = "unknown";
  if (upstream.ok && aheadBehind.ok) {
    const [ahead, behind] = aheadBehind.stdout.split(/\s+/).map(Number);
    if (ahead === 0 && behind === 0) upstreamState = "in_sync";
    else if (ahead > 0 && behind > 0) upstreamState = "diverged";
    else if (ahead > 0) upstreamState = "ahead";
    else if (behind > 0) upstreamState = "behind";
  } else if (!origin.ok) {
    upstreamState = "missing";
  }

  let remoteHead = null;
  let remoteChecked = false;
  if (probeRemote && origin.ok) {
    const branch = upstream.ok ? upstream.stdout.replace(/^origin\//, "") : currentBranch.stdout;
    const remote = branch ? git(resolvedRoot, ["ls-remote", "--heads", "origin", branch]) : { ok: false, stdout: "" };
    if (remote.ok && remote.stdout) {
      remoteHead = remote.stdout.split(/\s+/)[0];
      remoteChecked = true;
      if (localHead.ok && remoteHead === localHead.stdout) upstreamState = "in_sync";
      else if (!["ahead", "behind", "diverged"].includes(upstreamState)) upstreamState = "remote_different";
    } else {
      upstreamState = "unknown";
    }
  }

  const repositories = [repositoryProbe({
    id: stableRepositoryId(resolvedRoot, origin.stdout),
    originConfigured: origin.ok,
    localState: dirty.ok ? (dirty.stdout ? "dirty" : "clean") : "unknown",
    upstreamState,
    branch: currentBranch.ok ? currentBranch.stdout : null,
    localHead: localHead.ok ? localHead.stdout : null,
    remoteHead,
    remoteChecked,
  })];
  return { repositories, runtime_evidence: buildRuntimeEvidence(repositories, observedAt) };
}

function parseArgs(args) {
  const options = { probe: false, remote: false, root: process.cwd() };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--probe") options.probe = true;
    else if (arg === "--remote") options.remote = true;
    else if (arg === "--root") options.root = args[++index];
    else throw new Error(`unsupported argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.probe) throw new Error("usage: node scripts/account-login-sync-start.mjs --probe [--remote] [--root <path>]");
    const result = evaluateAccountLoginSyncStart(probeAccountLoginSyncStart({
      root: options.root,
      probeRemote: options.remote,
    }));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.decision === "ready" ? 0 : 2;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

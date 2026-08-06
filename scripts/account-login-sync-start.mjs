import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const CAPABILITY_STATUSES = new Set(["available", "missing", "unknown"]);
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

function assertOnlyFields(value, allowed) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      if (FORBIDDEN_METADATA_FIELDS.has(key)) {
        throw new Error(`unsupported or secret-bearing account metadata field: ${key}`);
      }
      throw new Error(`unsupported account metadata field: ${key}`);
    }
  }
}

function validateAccountMetadata(value) {
  if (!isPlainObject(value)) return null;
  assertOnlyFields(value, new Set(["schema_version", "approval", "required_capabilities"]));
  if (value.schema_version !== "account-login-sync-start.v1") {
    throw new Error("account metadata schema_version must equal account-login-sync-start.v1");
  }
  if (!isPlainObject(value.approval) || value.approval.approved_by !== "Vincent" || !/^\d{4}-\d{2}-\d{2}$/.test(value.approval.approved_at || "")) {
    throw new Error("account metadata requires Vincent approval metadata");
  }
  if (!Array.isArray(value.required_capabilities) || value.required_capabilities.length === 0) {
    throw new Error("account metadata requires at least one required capability");
  }

  const seen = new Set();
  const capabilities = value.required_capabilities.map((capability) => {
    if (!isPlainObject(capability)) throw new Error("required capability must be an object");
    assertOnlyFields(capability, new Set(["id", "status"]));
    if (typeof capability.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(capability.id)) {
      throw new Error("required capability id must be a lower-case stable identifier");
    }
    if (seen.has(capability.id)) throw new Error(`duplicate required capability: ${capability.id}`);
    seen.add(capability.id);
    if (!CAPABILITY_STATUSES.has(capability.status)) {
      throw new Error(`unsupported required capability status: ${capability.status}`);
    }
    return { id: capability.id, status: capability.status };
  });

  return {
    schema_version: value.schema_version,
    approval: {
      approved_by: value.approval.approved_by,
      approved_at: value.approval.approved_at,
    },
    required_capabilities: capabilities,
  };
}

function validateRepositories(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("repositories must be a non-empty array");
  }
  const seen = new Set();
  return value.map((repository) => {
    if (!isPlainObject(repository)) throw new Error("repository must be an object");
    const { id, origin_configured: originConfigured, local_state: localState, upstream_state: upstreamState } = repository;
    if (typeof id !== "string" || !/^[a-z][a-z0-9-]*$/.test(id)) {
      throw new Error("repository id must be a lower-case stable identifier");
    }
    if (seen.has(id)) throw new Error(`duplicate repository: ${id}`);
    seen.add(id);
    if (typeof originConfigured !== "boolean") throw new Error("repository origin_configured must be boolean");
    if (!LOCAL_STATES.has(localState)) throw new Error(`unsupported repository local_state: ${localState}`);
    if (!UPSTREAM_STATES.has(upstreamState)) throw new Error(`unsupported repository upstream_state: ${upstreamState}`);
    return { id, origin_configured: originConfigured, local_state: localState, upstream_state: upstreamState };
  });
}

function blockedResult(reason, kind) {
  return {
    decision: "blocked",
    blocked_reasons: [reason],
    next_action: { kind },
    write_boundary: WRITE_BOUNDARY,
  };
}

function degradedResult(reason, kind) {
  return {
    decision: "degraded",
    blocked_reasons: [reason],
    next_action: { kind },
    write_boundary: WRITE_BOUNDARY,
  };
}

export function evaluateAccountLoginSyncStart(input) {
  if (!isPlainObject(input)) throw new Error("bootstrap input must be an object");
  const accountMetadata = validateAccountMetadata(input.account_metadata);
  if (!accountMetadata) return blockedResult("account_metadata_missing", "account_login_or_capability_check");

  const missingCapability = accountMetadata.required_capabilities.find(({ status }) => status !== "available");
  if (missingCapability) {
    return blockedResult(`required_capability_missing:${missingCapability.id}`, "account_login_or_capability_check");
  }

  const repositories = validateRepositories(input.repositories);
  for (const repository of repositories) {
    if (!repository.origin_configured) return blockedResult(`origin_missing:${repository.id}`, "configure_remote_without_writing");
    if (repository.local_state === "dirty") return blockedResult(`local_changes_present:${repository.id}`, "classify_local_changes");
    if (repository.local_state === "unknown") return degradedResult(`local_state_unknown:${repository.id}`, "run_safe_probe");
    if (["ahead", "behind", "diverged", "remote_different"].includes(repository.upstream_state)) {
      return blockedResult(`upstream_not_in_sync:${repository.id}:${repository.upstream_state}`, "classify_remote_difference");
    }
    if (repository.upstream_state === "missing") return blockedResult(`upstream_missing:${repository.id}`, "configure_upstream_without_writing");
    if (repository.upstream_state === "unknown") return degradedResult(`upstream_state_unknown:${repository.id}`, "run_read_only_remote_probe");
  }

  const runtimeEvidence = input.runtime_evidence;
  if (!isPlainObject(runtimeEvidence) || runtimeEvidence.kind !== "safe_probe" || typeof runtimeEvidence.observed_at !== "string") {
    return degradedResult("fixture_only_runtime_evidence", "run_safe_probe");
  }

  return {
    decision: "ready",
    blocked_reasons: [],
    next_action: { kind: "begin_work_from_canonical_sources" },
    write_boundary: WRITE_BOUNDARY,
  };
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

export function probeAccountLoginSyncStart({ root = process.cwd(), accountMetadata = null, observedAt = new Date().toISOString(), probeRemote = false } = {}) {
  const resolvedRoot = path.resolve(root);
  const gitRoot = git(resolvedRoot, ["rev-parse", "--show-toplevel"]);
  if (!gitRoot.ok) {
    return {
      account_metadata: accountMetadata,
      repositories: [{ id: stableRepositoryId(resolvedRoot), origin_configured: false, local_state: "unknown", upstream_state: "missing" }],
      runtime_evidence: { kind: "safe_probe", observed_at: observedAt },
    };
  }

  const dirty = git(resolvedRoot, ["status", "--porcelain=v1"]);
  const origin = git(resolvedRoot, ["config", "--get", "remote.origin.url"]);
  const upstream = git(resolvedRoot, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
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
  } else if (!upstream.ok) {
    upstreamState = origin.ok ? "unknown" : "missing";
  }

  if (probeRemote && origin.ok) {
    const currentBranch = git(resolvedRoot, ["branch", "--show-current"]);
    const branch = upstream.ok ? upstream.stdout.replace(/^origin\//, "") : currentBranch.stdout;
    const remoteHead = branch ? git(resolvedRoot, ["ls-remote", "--heads", "origin", branch]) : { ok: false, stdout: "" };
    const localHead = git(resolvedRoot, ["rev-parse", "HEAD"]);
    if (remoteHead.ok && localHead.ok && remoteHead.stdout) {
      const remoteHash = remoteHead.stdout.split(/\s+/)[0];
      upstreamState = remoteHash === localHead.stdout ? "in_sync" : "remote_different";
    } else {
      upstreamState = "unknown";
    }
  }

  return {
    account_metadata: accountMetadata,
    repositories: [{
      id: stableRepositoryId(resolvedRoot, origin.stdout),
      origin_configured: origin.ok,
      local_state: dirty.ok ? (dirty.stdout ? "dirty" : "clean") : "unknown",
      upstream_state: upstreamState,
    }],
    runtime_evidence: { kind: "safe_probe", observed_at: observedAt },
  };
}

function parseArgs(args) {
  const options = { probe: false, remote: false, root: process.cwd(), accountMetadataPath: null };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--probe") options.probe = true;
    else if (arg === "--remote") options.remote = true;
    else if (arg === "--root") options.root = args[++index];
    else if (arg === "--account-metadata") options.accountMetadataPath = args[++index];
    else throw new Error(`unsupported argument: ${arg}`);
  }
  return options;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.probe) throw new Error("usage: node scripts/account-login-sync-start.mjs --probe [--remote] [--root <path>] [--account-metadata <safe-json-path>]");
    const accountMetadata = options.accountMetadataPath
      ? JSON.parse(fs.readFileSync(path.resolve(options.accountMetadataPath), "utf-8"))
      : null;
    const result = evaluateAccountLoginSyncStart(probeAccountLoginSyncStart({
      root: options.root,
      accountMetadata,
      probeRemote: options.remote,
    }));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.decision === "ready" ? 0 : 2;
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  }
}

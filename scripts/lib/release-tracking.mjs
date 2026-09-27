import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

export const TAG_REGEX = /^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/;

export function computeSha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export function computeEventKey(repo, tag, commitSha) {
  return crypto.createHash("sha256").update(`${repo}\n${tag}\n${commitSha}`).digest("hex");
}

export function formatMarker(eventKey, repo, tag, commitSha) {
  return `<!-- morrowise-release-tracking-marker: ${JSON.stringify({
    event_key: eventKey,
    repo,
    tag,
    commit_sha: commitSha,
  })} -->`;
}

export function parseMarker(text) {
  if (typeof text !== "string") return null;
  const match = text.match(/<!-- morrowise-release-tracking-marker: (\{.*?\}) -->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function resolveGitTagCommit(repoPath, tag) {
  try {
    const stdout = execFileSync("git", ["-C", repoPath, "rev-parse", `refs/tags/${tag}^{commit}`], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const sha = stdout.trim();
    if (/^[0-9a-f]{40}$/i.test(sha)) {
      return sha;
    }
    return null;
  } catch {
    return null;
  }
}

export function validateEvent(event) {
  if (!event || typeof event !== "object") {
    throw new Error("Invalid event: must be an object");
  }

  // Check if ignored event type
  if (event.event_type !== "tag_push") {
    return { ignored: true, reason: `event_type '${event.event_type}' not supported in v1` };
  }

  if (event.deleted === true) {
    return { ignored: true, deleted: true, reason: "tag deletion event" };
  }

  if (!event.tag || typeof event.tag !== "string" || !TAG_REGEX.test(event.tag)) {
    return { ignored: true, reason: `tag '${event.tag}' does not match release tag pattern` };
  }

  if (event.ref !== `refs/tags/${event.tag}`) {
    throw new Error(`ref '${event.ref}' does not match expected 'refs/tags/${event.tag}'`);
  }

  if (!event.repo || typeof event.repo !== "string" || !event.repo.includes("/")) {
    throw new Error(`repo '${event.repo}' is invalid; must be 'owner/name'`);
  }

  if (!event.commit_sha || typeof event.commit_sha !== "string" || !/^[0-9a-f]{40}$/i.test(event.commit_sha)) {
    throw new Error(`commit_sha '${event.commit_sha}' must be a 40-character hexadecimal string`);
  }

  if (event.git_repo_path && fs.existsSync(event.git_repo_path)) {
    try {
      const type = execFileSync("git", ["-C", event.git_repo_path, "cat-file", "-t", event.commit_sha], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (type !== "commit") {
        throw new Error(`commit_sha '${event.commit_sha}' is a ${type} object SHA, not a commit SHA`);
      }
    } catch (e) {
      if (e.message.includes("is a") && e.message.includes("object SHA")) {
        throw e;
      }
    }
  }

  return { ignored: false };
}

export function validateRouting(routing, eventRepo) {
  if (!routing || typeof routing !== "object") {
    throw new Error("routing must be an object");
  }

  const { mode } = routing;
  if (!["existing", "followup", "release"].includes(mode)) {
    throw new Error(`Invalid routing mode '${mode}'. Must be existing, followup, or release`);
  }

  if (mode === "existing") {
    const target = routing.target;
    if (!target || typeof target !== "object") {
      const err = new Error("routing.target is required for existing mode: BLOCKED");
      err.exitCode = 3;
      err.status = "BLOCKED";
      throw err;
    }
    if (!["issue", "pr"].includes(target.kind)) {
      throw new Error(`routing.target.kind must be 'issue' or 'pr', got '${target.kind}'`);
    }
    if (target.repo !== eventRepo) {
      throw new Error(`Cross-repo targeting rejected in v1: target.repo '${target.repo}' !== event.repo '${eventRepo}'`);
    }
    if (!Number.isInteger(target.number) || target.number <= 0) {
      throw new Error(`routing.target.number must be a positive integer, got ${target.number}`);
    }
  } else if (mode === "followup") {
    if (routing.target) {
      throw new Error("routing.target must not be provided in followup mode (dual target conflict)");
    }
    const { work_key, title, reason, acceptance } = routing;
    if (!work_key || typeof work_key !== "string" || !work_key.trim()) {
      throw new Error("followup mode requires non-empty work_key");
    }
    if (!title || typeof title !== "string" || !title.trim()) {
      throw new Error("followup mode requires non-empty title");
    }
    if (!reason || typeof reason !== "string" || !reason.trim()) {
      throw new Error("followup mode requires non-empty reason");
    }
    if (!acceptance || typeof acceptance !== "string" || !acceptance.trim()) {
      throw new Error("followup mode requires non-empty acceptance");
    }
  } else if (mode === "release") {
    if (!routing.changelog || typeof routing.changelog !== "string" || !routing.changelog.trim()) {
      throw new Error("release mode requires non-empty changelog");
    }
  }

  return true;
}

export function validateProjectContractAndResult(contractObj, resultObj, evidenceRoot, eventCommitSha) {
  if (!contractObj || typeof contractObj !== "object") {
    throw new Error("Project contract must be an object");
  }
  if (!resultObj || typeof resultObj !== "object") {
    throw new Error("Result must be an object");
  }

  const rawContractStr = typeof contractObj._raw === "string" ? contractObj._raw : JSON.stringify(contractObj);
  const expectedContractSha = computeSha256(rawContractStr);

  if (resultObj.contract_sha256 && resultObj.contract_sha256 !== expectedContractSha) {
    throw new Error(`result.contract_sha256 (${resultObj.contract_sha256}) does not match contract SHA (${expectedContractSha})`);
  }

  if (resultObj.source_commit !== eventCommitSha) {
    throw new Error(`result.source_commit (${resultObj.source_commit}) does not match event commit_sha (${eventCommitSha})`);
  }

  const requiredCaseIds = new Set(contractObj.required_cases || []);
  const allowedCaseIds = new Set((contractObj.cases || []).map((c) => c.id));
  for (const id of requiredCaseIds) allowedCaseIds.add(id);

  const seenCaseIds = new Set();
  const allowedStatuses = new Set(["PASS", "FAIL", "NOT_RUN", "BLOCKED"]);

  if (!Array.isArray(resultObj.cases)) {
    throw new Error("result.cases must be an array");
  }

  for (const c of resultObj.cases) {
    if (!c || typeof c !== "object" || !c.id) {
      throw new Error("Each case in result must have a valid string id");
    }
    if (!allowedCaseIds.has(c.id)) {
      throw new Error(`Unknown case ID in result: ${c.id}`);
    }
    if (seenCaseIds.has(c.id)) {
      throw new Error(`Duplicate case ID in result: ${c.id}`);
    }
    seenCaseIds.add(c.id);

    if (!allowedStatuses.has(c.status)) {
      throw new Error(`Invalid status '${c.status}' for case ${c.id}`);
    }

    if (c.status === "PASS") {
      if (c.exit_code !== 0) {
        throw new Error(`Case ${c.id} has status PASS but non-zero exit_code: ${c.exit_code}`);
      }
    }

    if (c.started_at != null || c.exit_code != null) {
      // executed
      if (!Array.isArray(c.evidence) || c.evidence.length === 0) {
        throw new Error(`Case ${c.id} was executed but evidence array is empty`);
      }
      for (const ev of c.evidence) {
        if (!ev.path || !ev.sha256) {
          throw new Error(`Case ${c.id} evidence entry missing path or sha256`);
        }
        // Verify evidence path safety
        const resolvedPath = path.resolve(evidenceRoot, ev.path);
        const resolvedRoot = path.resolve(evidenceRoot);
        if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
          throw new Error(`Case ${c.id} evidence path escapes root: ${ev.path}`);
        }
        if (!fs.existsSync(resolvedPath)) {
          throw new Error(`Case ${c.id} evidence file does not exist: ${ev.path}`);
        }
        // Check symlink
        const lstat = fs.lstatSync(resolvedPath);
        if (lstat.isSymbolicLink()) {
          const realTarget = fs.realpathSync(resolvedPath);
          if (!realTarget.startsWith(resolvedRoot + path.sep)) {
            throw new Error(`Case ${c.id} evidence symlink points outside root: ${ev.path}`);
          }
        }
        // Check sha256
        const fileBytes = fs.readFileSync(resolvedPath);
        const actualHash = computeSha256(fileBytes);
        if (actualHash !== ev.sha256) {
          throw new Error(`Case ${c.id} evidence sha256 mismatch for ${ev.path}. Expected ${ev.sha256}, got ${actualHash}`);
        }
      }
    } else {
      // Not executed
      if (c.exit_code === 0) {
        throw new Error(`Case ${c.id} status is ${c.status} (not executed) but exit_code is 0 (contradiction)`);
      }
      if (!c.reason || typeof c.reason !== "string" || !c.reason.trim()) {
        throw new Error(`Case ${c.id} was not executed but missing explicit reason`);
      }
    }
  }

  for (const reqId of requiredCaseIds) {
    if (!seenCaseIds.has(reqId)) {
      throw new Error(`Missing required case: ${reqId}`);
    }
  }

  return true;
}

export function renderMessage({ event, result, projectContract, eventKey }) {
  const isFixture = event.repo.includes("fixture");
  const marker = formatMarker(eventKey, event.repo, event.tag, event.commit_sha);

  let statusSummary = "通過 (PASS)";
  let allPass = true;
  for (const c of result.cases || []) {
    if (c.status !== "PASS") {
      allPass = false;
      statusSummary = c.status === "FAIL" ? "未通過 (FAIL)" : c.status === "NOT_RUN" ? "未完成 (NOT_RUN)" : "已阻塞 (BLOCKED)";
      break;
    }
  }

  const ciKind = result.ci?.kind || "local";
  const ciLabel = ciKind === "local" ? "本機驗證證據（無 CI，路徑僅該主機可讀）" : `CI 驗證 (${result.ci?.url || "無 URL"})`;

  const lines = [
    marker,
    `## 發布追蹤紀錄：${event.tag}`,
    "",
    `- **專案／Repo**：\`${event.repo}\``,
    `- **版本標籤 (Tag)**：\`${event.tag}\``,
    `- **完整 Commit SHA**：\`${event.commit_sha}\``,
    `- **契約 Hash**：\`${result.contract_sha256 || "N/A"}\``,
    `- **驗收狀態**：**${statusSummary}**`,
    `- **驗證環境**：${ciLabel}`,
    `- **觀測時間**：\`${event.observed_at || new Date().toISOString()}\``,
  ];

  if (isFixture) {
    lines.push(`- **測試標記**：\`fixture\`（合成測試資料，不代表正式產品驗收）`);
  }

  lines.push("", "### 案例驗證細節", "");
  lines.push("| 案例 ID | 狀態 | 命令 | Exit | 耗時 | 證據檔案 | 備註 |");
  lines.push("|---|---|---|---|---|---|---|");

  for (const c of result.cases || []) {
    const cmdStr = c.command ? `\`${c.command}\`` : "-(未執行)";
    const exitStr = c.exit_code != null ? c.exit_code : "null";
    const durStr = c.duration_ms != null ? `${c.duration_ms}ms` : "-";
    const evStr = (c.evidence || []).map(e => `\`${e.path}\``).join(", ") || "-";
    const noteStr = c.reason || (c.status === "PASS" ? "通過" : "異常");
    lines.push(`| ${c.id} | ${c.status} | ${cmdStr} | ${exitStr} | ${durStr} | ${evStr} | ${noteStr} |`);
  }

  lines.push("");
  return lines.join("\n");
}

export function executePlan({ eventPath, contractPath, resultPath, evidenceRoot, outDir }) {
  if (fs.existsSync(outDir)) {
    const err = new Error(`Output directory '${outDir}' already exists. Rejection to prevent overwrite.`);
    err.code = "ERR_OUT_EXISTS";
    err.exitCode = 2;
    throw err;
  }

  const rawEvent = fs.readFileSync(eventPath, "utf8");
  const event = JSON.parse(rawEvent);

  const eventValidation = validateEvent(event);
  if (eventValidation.ignored) {
    fs.mkdirSync(outDir, { recursive: true });
    const plan = {
      schema_version: 1,
      action: "ignore",
      reason: eventValidation.reason,
      deleted: Boolean(eventValidation.deleted),
      event,
    };
    fs.writeFileSync(path.join(outDir, "plan.json"), JSON.stringify(plan, null, 2), "utf8");
    fs.writeFileSync(path.join(outDir, "message.md"), `# Ignored Event: ${eventValidation.reason}\n`, "utf8");
    return { exitCode: 0, status: "IGNORED", plan };
  }

  // Validate routing
  validateRouting(event.routing, event.repo);

  const rawContract = fs.readFileSync(contractPath, "utf8");
  const projectContract = JSON.parse(rawContract);
  projectContract._raw = rawContract;

  const rawResult = fs.readFileSync(resultPath, "utf8");
  const result = JSON.parse(rawResult);

  validateProjectContractAndResult(projectContract, result, evidenceRoot, event.commit_sha);

  // Check release mode gate: required cases must all PASS
  if (event.routing.mode === "release") {
    for (const c of result.cases || []) {
      if (c.status !== "PASS") {
        const err = new Error(`Release mode requires all cases to PASS, but found case ${c.id} with status ${c.status}`);
        err.exitCode = 3;
        err.status = "BLOCKED";
        throw err;
      }
    }
  }

  const eventKey = computeEventKey(event.repo, event.tag, event.commit_sha);
  const message = renderMessage({ event, result, projectContract, eventKey });

  const eventSha = computeSha256(rawEvent);
  const contractSha = computeSha256(rawContract);
  const resultSha = computeSha256(rawResult);
  const messageSha = computeSha256(message);

  const plan = {
    schema_version: 1,
    action: event.routing.mode,
    event_key: eventKey,
    event_sha256: eventSha,
    contract_sha256: contractSha,
    result_sha256: resultSha,
    message_sha256: messageSha,
    event,
    routing: event.routing,
    material_paths: {
      event: path.resolve(eventPath),
      contract: path.resolve(contractPath),
      result: path.resolve(resultPath),
      evidence_root: path.resolve(evidenceRoot),
    },
  };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "plan.json"), JSON.stringify(plan, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "message.md"), message, "utf8");

  return { exitCode: 0, status: "PLANNED", plan };
}

export async function executeApply({ planPath, mode, apiBase, stateDir, outDir }) {
  if (fs.existsSync(outDir)) {
    const err = new Error(`Output directory '${outDir}' already exists. Rejection to prevent overwrite.`);
    err.code = "ERR_OUT_EXISTS";
    err.exitCode = 2;
    throw err;
  }

  // Validate apiBase loopback only
  let parsedUrl;
  try {
    parsedUrl = new URL(apiBase);
  } catch {
    const err = new Error(`Invalid apiBase URL: '${apiBase}'`);
    err.exitCode = 2;
    throw err;
  }

  if (parsedUrl.hostname !== "127.0.0.1" && parsedUrl.hostname !== "localhost") {
    const err = new Error(`Non-loopback apiBase rejected in Phase A: '${apiBase}'`);
    err.exitCode = 2;
    throw err;
  }

  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });

  const rawPlan = fs.readFileSync(planPath, "utf8");
  const plan = JSON.parse(rawPlan);

  // If ignored event
  if (plan.action === "ignore") {
    if (plan.deleted) {
      const tombstoneDir = path.join(stateDir, "tombstones");
      fs.mkdirSync(tombstoneDir, { recursive: true });
      const tombstonePath = path.join(tombstoneDir, `${plan.event.repo.replace(/\//g, "_")}_${plan.event.tag}.json`);
      fs.writeFileSync(tombstonePath, JSON.stringify({
        tag: plan.event.tag,
        repo: plan.event.repo,
        deleted_at: new Date().toISOString(),
      }, null, 2), "utf8");
    }
    const delivery = { status: "IGNORED", reason: plan.reason };
    fs.writeFileSync(path.join(outDir, "delivery.json"), JSON.stringify(delivery, null, 2), "utf8");
    return { exitCode: 0, status: "IGNORED" };
  }

  // Re-verify material hashes
  const currentEventBytes = fs.readFileSync(plan.material_paths.event);
  const currentContractBytes = fs.readFileSync(plan.material_paths.contract);
  const currentResultBytes = fs.readFileSync(plan.material_paths.result);
  const messagePath = path.join(path.dirname(planPath), "message.md");
  const currentMessageBytes = fs.readFileSync(messagePath);

  if (computeSha256(currentEventBytes) !== plan.event_sha256) {
    const err = new Error("Event material changed after plan! Hash mismatch.");
    err.exitCode = 2;
    throw err;
  }
  if (computeSha256(currentContractBytes) !== plan.contract_sha256) {
    const err = new Error("Contract material changed after plan! Hash mismatch.");
    err.exitCode = 2;
    throw err;
  }
  if (computeSha256(currentResultBytes) !== plan.result_sha256) {
    const err = new Error("Result material changed after plan! Hash mismatch.");
    err.exitCode = 2;
    throw err;
  }
  if (computeSha256(currentMessageBytes) !== plan.message_sha256) {
    const err = new Error("Message markdown changed after plan! Hash mismatch.");
    err.exitCode = 2;
    throw err;
  }

  const messageText = currentMessageBytes.toString("utf8");
  const lockDir = path.join(stateDir, "locks");
  fs.mkdirSync(lockDir, { recursive: true });
  const repoSafe = plan.event.repo.replace(/[^a-zA-Z0-9_-]/g, "_");
  const lockFile = path.join(lockDir, `${repoSafe}-${plan.event.tag}.lock`);

  // Acquire lock using wx flag
  let lockFd = null;
  try {
    lockFd = fs.openSync(lockFile, "wx");
    fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, time: Date.now() }), "utf8");
  } catch (e) {
    const err = new Error(`Lock acquisition failed for ${lockFile}: already held or contested.`);
    err.exitCode = 3;
    err.status = "LOCK_FAILED";
    throw err;
  }

  const releaseLock = () => {
    if (lockFd !== null) {
      try {
        fs.closeSync(lockFd);
      } catch {}
      try {
        fs.unlinkSync(lockFile);
      } catch {}
      lockFd = null;
    }
  };

  const requestsLog = [];

  async function apiFetch(pathname, options = {}) {
    const targetUrl = new URL(pathname, apiBase).toString();
    requestsLog.push({ url: targetUrl, method: options.method || "GET", body: options.body });
    const res = await fetch(targetUrl, options);
    return res;
  }

  try {
    // Check ledger for corruption or conflicts
    const ledgerPath = path.join(stateDir, "ledger.json");
    let ledger = { deliveries: [] };
    if (fs.existsSync(ledgerPath)) {
      try {
        const content = fs.readFileSync(ledgerPath, "utf8");
        ledger = JSON.parse(content);
        if (!Array.isArray(ledger.deliveries)) {
          throw new Error("ledger.deliveries must be an array");
        }
      } catch {
        const err = new Error(`Ledger at ${ledgerPath} is corrupted! Fail-closed.`);
        err.exitCode = 3;
        err.status = "LEDGER_CORRUPTED";
        throw err;
      }
    }

    // Check if same event_key exists in ledger
    const existingDelivery = ledger.deliveries.find(d => d.event_key === plan.event_key);
    if (existingDelivery) {
      // Check target conflict
      const existingTarget = existingDelivery.target ?? null;
      const planTarget = plan.routing.target ?? null;
      if (existingDelivery.action !== plan.action || JSON.stringify(existingTarget) !== JSON.stringify(planTarget)) {
        const err = new Error(`Conflict: event_key ${plan.event_key} already delivered to target ${JSON.stringify(existingTarget)}, cannot deliver to ${JSON.stringify(planTarget)}`);
        err.exitCode = 3;
        err.status = "CONFLICT";
        throw err;
      }
    }

    // Check if tag exists with a different commit SHA (Repoint in ledger)
    const repointDelivery = ledger.deliveries.find(
      d => d.repo === plan.event.repo && d.tag === plan.event.tag && d.commit_sha !== plan.event.commit_sha
    );

    // Save remote before
    let remoteBefore = null;
    let remoteAfter = null;

    // Check remote marker lookup
    let markerFound = false;
    let existingItem = null;
    let remoteRepointFound = null;

    if (plan.action === "existing") {
      const { target } = plan.routing;
      // Paginated lookup of comments
      let page = 1;
      const allComments = [];
      while (true) {
        let res;
        try {
          res = await apiFetch(`/repos/${target.repo}/issues/${target.number}/comments?page=${page}&per_page=30`);
        } catch (netErr) {
          const delivery = { status: "PENDING_RECONCILE", error: netErr.message };
          fs.writeFileSync(path.join(outDir, "delivery.json"), JSON.stringify(delivery, null, 2), "utf8");
          fs.writeFileSync(path.join(outDir, "requests.json"), JSON.stringify(requestsLog, null, 2), "utf8");
          const err = new Error(`Network failure during pre-check: ${netErr.message}. PENDING_RECONCILE.`);
          err.exitCode = 4;
          err.status = "PENDING_RECONCILE";
          throw err;
        }
        if (res.status === 404) {
          const err = new Error(`Target ${target.kind} #${target.number} not found in repo ${target.repo}`);
          err.exitCode = 3;
          err.status = "BLOCKED";
          throw err;
        }
        if (!res.ok) {
          throw new Error(`API error ${res.status}: ${await res.text()}`);
        }
        const comments = await res.json();
        if (!Array.isArray(comments) || comments.length === 0) break;
        allComments.push(...comments);
        if (comments.length < 30) break;
        page++;
      }
      remoteBefore = { comments: allComments };

      for (const item of allComments) {
        const marker = parseMarker(item.body);
        if (marker) {
          if (marker.event_key === plan.event_key) {
            markerFound = true;
            existingItem = item;
            break;
          } else if (marker.repo === plan.event.repo && marker.tag === plan.event.tag && marker.commit_sha !== plan.event.commit_sha) {
            remoteRepointFound = { marker, item };
          }
        }
      }
    } else if (plan.action === "followup") {
      let page = 1;
      const allIssues = [];
      while (true) {
        let res;
        try {
          res = await apiFetch(`/repos/${plan.event.repo}/issues?state=all&page=${page}&per_page=30`);
        } catch (netErr) {
          const delivery = { status: "PENDING_RECONCILE", error: netErr.message };
          fs.writeFileSync(path.join(outDir, "delivery.json"), JSON.stringify(delivery, null, 2), "utf8");
          fs.writeFileSync(path.join(outDir, "requests.json"), JSON.stringify(requestsLog, null, 2), "utf8");
          const err = new Error(`Network failure during pre-check: ${netErr.message}. PENDING_RECONCILE.`);
          err.exitCode = 4;
          err.status = "PENDING_RECONCILE";
          throw err;
        }
        if (!res.ok) break;
        const issues = await res.json();
        if (!Array.isArray(issues) || issues.length === 0) break;
        allIssues.push(...issues);
        if (issues.length < 30) break;
        page++;
      }
      remoteBefore = { issues: allIssues };
      for (const item of allIssues) {
        const marker = parseMarker(item.body);
        if (marker && marker.event_key === plan.event_key) {
          markerFound = true;
          existingItem = item;
          break;
        }
      }
    } else if (plan.action === "release") {
      let res;
      try {
        res = await apiFetch(`/repos/${plan.event.repo}/releases`);
      } catch (netErr) {
        const delivery = { status: "PENDING_RECONCILE", error: netErr.message };
        fs.writeFileSync(path.join(outDir, "delivery.json"), JSON.stringify(delivery, null, 2), "utf8");
        fs.writeFileSync(path.join(outDir, "requests.json"), JSON.stringify(requestsLog, null, 2), "utf8");
        const err = new Error(`Network failure during pre-check: ${netErr.message}. PENDING_RECONCILE.`);
        err.exitCode = 4;
        err.status = "PENDING_RECONCILE";
        throw err;
      }
      let allReleases = [];
      if (res.ok) {
        allReleases = await res.json();
      }
      remoteBefore = { releases: allReleases };
      for (const item of allReleases) {
        const marker = parseMarker(item.body);
        if (marker) {
          if (marker.event_key === plan.event_key) {
            markerFound = true;
            existingItem = item;
            break;
          } else if (marker.repo === plan.event.repo && marker.tag === plan.event.tag && marker.commit_sha !== plan.event.commit_sha) {
            remoteRepointFound = { marker, item };
          }
        }
      }
    }

    // Handle Tag Repointing
    if (repointDelivery || remoteRepointFound) {
      const oldSha = repointDelivery?.commit_sha || remoteRepointFound?.marker?.commit_sha;
      const notificationText = `\n\n> [!WARNING]\n> **版本異動通知**：Tag \`${plan.event.tag}\` 參照由前次 SHA \`${oldSha}\` 改指向至新 SHA \`${plan.event.commit_sha}\`。異動時間：\`${new Date().toISOString()}\`。有效參照維持原紀錄，需人工審查。<!-- repoint-notification: ${plan.event.tag}-${plan.event.commit_sha} -->`;

      // Check if notification already appended
      let alreadyNotified = false;
      if (plan.action === "existing") {
        for (const c of remoteBefore?.comments || []) {
          if (c.body && c.body.includes(`repoint-notification: ${plan.event.tag}-${plan.event.commit_sha}`)) {
            alreadyNotified = true;
            break;
          }
        }
        if (!alreadyNotified) {
          const { target } = plan.routing;
          await apiFetch(`/repos/${target.repo}/issues/${target.number}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: notificationText }),
          });
        }
      } else if (plan.action === "release") {
        const rel = remoteRepointFound?.item || remoteBefore?.releases?.find(r => r.tag_name === plan.event.tag);
        if (rel && !rel.body.includes(`repoint-notification: ${plan.event.tag}-${plan.event.commit_sha}`)) {
          await apiFetch(`/repos/${plan.event.repo}/releases/${rel.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ body: rel.body + notificationText }),
          });
        }
      }

      const delivery = {
        status: "REVIEW_REQUIRED",
        reason: "Tag repointing detected",
        old_sha: oldSha,
        new_sha: plan.event.commit_sha,
      };
      fs.writeFileSync(path.join(outDir, "delivery.json"), JSON.stringify(delivery, null, 2), "utf8");
      fs.writeFileSync(path.join(outDir, "requests.json"), JSON.stringify(requestsLog, null, 2), "utf8");
      fs.writeFileSync(path.join(outDir, "remote-before.json"), JSON.stringify(remoteBefore, null, 2), "utf8");
      fs.writeFileSync(path.join(outDir, "remote-after.json"), JSON.stringify(remoteBefore, null, 2), "utf8");

      const err = new Error(`Tag repointing detected for tag ${plan.event.tag}. Old SHA: ${oldSha}, New SHA: ${plan.event.commit_sha}. REVIEW_REQUIRED.`);
      err.exitCode = 3;
      err.status = "REVIEW_REQUIRED";
      throw err;
    }

    // If marker already found remotely: ALREADY_DELIVERED
    if (markerFound && existingItem) {
      if (!existingDelivery) {
        ledger.deliveries.push({
          event_key: plan.event_key,
          repo: plan.event.repo,
          tag: plan.event.tag,
          commit_sha: plan.event.commit_sha,
          action: plan.action,
          target: plan.routing.target || null,
          delivered_at: new Date().toISOString(),
          item_id: existingItem.id || existingItem.number,
        });
        const tmpLedgerPath = path.join(stateDir, "ledger.tmp.json");
        fs.writeFileSync(tmpLedgerPath, JSON.stringify(ledger, null, 2), "utf8");
        fs.renameSync(tmpLedgerPath, ledgerPath);
      }
      // Readback GET check
      const delivery = {
        status: "ALREADY_DELIVERED",
        remote_item: existingItem,
        event_key: plan.event_key,
      };
      fs.writeFileSync(path.join(outDir, "delivery.json"), JSON.stringify(delivery, null, 2), "utf8");
      fs.writeFileSync(path.join(outDir, "requests.json"), JSON.stringify(requestsLog, null, 2), "utf8");
      fs.writeFileSync(path.join(outDir, "remote-before.json"), JSON.stringify(remoteBefore, null, 2), "utf8");
      fs.writeFileSync(path.join(outDir, "remote-after.json"), JSON.stringify(remoteBefore, null, 2), "utf8");
      return { exitCode: 0, status: "ALREADY_DELIVERED" };
    }

    // Perform Delivery POST
    let postResponse = null;
    let postError = null;

    try {
      if (plan.action === "existing") {
        const { target } = plan.routing;
        postResponse = await apiFetch(`/repos/${target.repo}/issues/${target.number}/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: messageText }),
        });
      } else if (plan.action === "followup") {
        postResponse = await apiFetch(`/repos/${plan.event.repo}/issues`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: plan.routing.title,
            body: messageText,
            work_key: plan.routing.work_key,
          }),
        });
      } else if (plan.action === "release") {
        postResponse = await apiFetch(`/repos/${plan.event.repo}/releases`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tag_name: plan.event.tag,
            target_commitish: plan.event.commit_sha,
            name: plan.event.tag,
            body: messageText,
          }),
        });
      }
    } catch (e) {
      postError = e;
    }

    // Handle network timeout / failure: reconcile attempt
    if (postError || !postResponse || !postResponse.ok) {
      // Reconcile by querying marker
      let reconciled = null;
      try {
        if (plan.action === "existing") {
          const { target } = plan.routing;
          const checkRes = await apiFetch(`/repos/${target.repo}/issues/${target.number}/comments?page=1&per_page=30`);
          if (checkRes.ok) {
            const comments = await checkRes.json();
            reconciled = comments.find(c => {
              const m = parseMarker(c.body);
              return m && m.event_key === plan.event_key;
            });
          }
        }
      } catch {}

      if (reconciled) {
        // Reconcile succeeded!
        postResponse = { ok: true, json: async () => reconciled };
      } else {
        // Reconcile failed: PENDING_RECONCILE
        fs.writeFileSync(path.join(outDir, "requests.json"), JSON.stringify(requestsLog, null, 2), "utf8");
        fs.writeFileSync(path.join(outDir, "remote-before.json"), JSON.stringify(remoteBefore, null, 2), "utf8");
        const delivery = { status: "PENDING_RECONCILE", error: postError?.message || `HTTP ${postResponse?.status}` };
        fs.writeFileSync(path.join(outDir, "delivery.json"), JSON.stringify(delivery, null, 2), "utf8");
        const err = new Error(`Delivery uncertain: ${postError?.message || `HTTP ${postResponse?.status}`}. PENDING_RECONCILE.`);
        err.exitCode = 4;
        err.status = "PENDING_RECONCILE";
        throw err;
      }
    }

    const createdItem = await postResponse.json();

    // GET Read-back verification
    let readbackUrl = createdItem.url;
    if (!readbackUrl) {
      if (plan.action === "existing") {
        readbackUrl = `/repos/${plan.routing.target.repo}/issues/comments/${createdItem.id}`;
      } else if (plan.action === "followup") {
        readbackUrl = `/repos/${plan.event.repo}/issues/${createdItem.number}`;
      } else if (plan.action === "release") {
        readbackUrl = `/repos/${plan.event.repo}/releases/${createdItem.id}`;
      }
    }

    const readbackRes = await apiFetch(readbackUrl);
    if (!readbackRes.ok) {
      const delivery = { status: "REMOTE_MISMATCH", error: `Read-back GET failed with HTTP ${readbackRes.status}` };
      fs.writeFileSync(path.join(outDir, "delivery.json"), JSON.stringify(delivery, null, 2), "utf8");
      fs.writeFileSync(path.join(outDir, "requests.json"), JSON.stringify(requestsLog, null, 2), "utf8");
      const err = new Error(`Read-back GET failed with HTTP ${readbackRes.status}`);
      err.exitCode = 3;
      err.status = "REMOTE_MISMATCH";
      throw err;
    }

    const readbackItem = await readbackRes.json();
    const readbackMarker = parseMarker(readbackItem.body);
    if (!readbackMarker || readbackMarker.event_key !== plan.event_key) {
      const delivery = { status: "REMOTE_MISMATCH", error: "Read-back verification failed: marker missing or event_key mismatch in remote body" };
      fs.writeFileSync(path.join(outDir, "delivery.json"), JSON.stringify(delivery, null, 2), "utf8");
      fs.writeFileSync(path.join(outDir, "requests.json"), JSON.stringify(requestsLog, null, 2), "utf8");
      const err = new Error("Read-back verification failed: marker missing or event_key mismatch in remote body");
      err.exitCode = 3;
      err.status = "REMOTE_MISMATCH";
      throw err;
    }

    // Atomic update ledger
    ledger.deliveries.push({
      event_key: plan.event_key,
      repo: plan.event.repo,
      tag: plan.event.tag,
      commit_sha: plan.event.commit_sha,
      action: plan.action,
      target: plan.routing.target || null,
      delivered_at: new Date().toISOString(),
      item_id: createdItem.id || createdItem.number,
    });

    const tmpLedgerPath = path.join(stateDir, "ledger.tmp.json");
    fs.writeFileSync(tmpLedgerPath, JSON.stringify(ledger, null, 2), "utf8");
    fs.renameSync(tmpLedgerPath, ledgerPath);

    remoteAfter = { delivered_item: readbackItem };

    const delivery = {
      status: "DELIVERED",
      event_key: plan.event_key,
      delivered_item: readbackItem,
    };

    fs.writeFileSync(path.join(outDir, "delivery.json"), JSON.stringify(delivery, null, 2), "utf8");
    fs.writeFileSync(path.join(outDir, "requests.json"), JSON.stringify(requestsLog, null, 2), "utf8");
    fs.writeFileSync(path.join(outDir, "remote-before.json"), JSON.stringify(remoteBefore, null, 2), "utf8");
    fs.writeFileSync(path.join(outDir, "remote-after.json"), JSON.stringify(remoteAfter, null, 2), "utf8");

    return { exitCode: 0, status: "DELIVERED" };
  } finally {
    releaseLock();
  }
}

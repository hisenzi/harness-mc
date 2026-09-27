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
  const isFixture = event.fixture === true || result.environment?.fixture === true || event.repo.includes("fixture");
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

function deliveryError(message, status = 'BLOCKED', exitCode = 3) {
  return Object.assign(new Error(message), { status, exitCode });
}

export function validateActivation(activation, plan) {
  if (activation?.schema_version !== 1 || activation.status !== 'authorized' ||
      !activation.operator || !activation.authorization?.source ||
      !Number.isFinite(Date.parse(activation.authorization?.approved_at))) {
    throw deliveryError('Live delivery requires a recorded, authorized activation.');
  }
  const e = plan.event;
  const allowed = activation.allowed_tags?.find(t => t.tag === e.tag);
  if (activation.repo !== e.repo || !allowed?.commit_shas?.includes(e.commit_sha)) {
    throw deliveryError('Event repo/tag/commit is outside the activation allowlist.');
  }
  if (plan.action !== 'existing' || !activation.target ||
      activation.target.repo !== e.repo ||
      activation.target.kind !== plan.routing.target?.kind ||
      activation.target.number !== plan.routing.target?.number ||
      activation.target.repo !== plan.routing.target?.repo ||
      !activation.allowed_write_types?.includes('issue_comment')) {
    throw deliveryError('Live routing must match the fixed existing target in activation.');
  }
  return activation;
}

export async function executeApply({ planPath, mode = 'fixture', apiBase, activationPath, stateDir, outDir, env = process.env, fetchImpl = globalThis.fetch }) {
  if (fs.existsSync(outDir)) throw deliveryError(`Output directory '${outDir}' already exists. Rejection to prevent overwrite.`, 'INVALID_INPUT', 2);
  if (!['fixture', 'live'].includes(mode)) throw deliveryError(`Unknown apply mode '${mode}'.`, 'INVALID_INPUT', 2);
  let base;
  try { base = new URL(apiBase || (mode === 'live' ? 'https://api.github.com' : '')); }
  catch { throw deliveryError('Invalid apiBase URL.', 'INVALID_INPUT', 2); }
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/') throw deliveryError('apiBase must be an origin without credentials or path.', 'INVALID_INPUT', 2);
  if (mode === 'fixture' && (!['127.0.0.1', 'localhost'].includes(base.hostname) || !['http:', 'https:'].includes(base.protocol))) {
    throw deliveryError('Non-loopback apiBase rejected in fixture mode.', 'INVALID_INPUT', 2);
  }
  if (mode === 'live' && base.origin !== 'https://api.github.com') throw deliveryError('Live API origin must be https://api.github.com.', 'INVALID_INPUT', 2);
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  let activation, token;
  if (mode === 'live') {
    if (!activationPath) throw deliveryError('Missing live activation file.');
    activation = validateActivation(JSON.parse(fs.readFileSync(activationPath, 'utf8')), plan);
    token = env.GITHUB_TOKEN || env.GH_TOKEN;
    if (!token) throw deliveryError('Missing job token in GITHUB_TOKEN or GH_TOKEN environment.');
  }
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const save = (name, value) => fs.writeFileSync(path.join(outDir, name), JSON.stringify(value, null, 2));
  if (plan.action === 'ignore') {
    if (plan.deleted) {
      fs.mkdirSync(path.join(stateDir, 'tombstones'), { recursive: true });
      const name = `${plan.event.repo}_${plan.event.tag}`.replace(/[^a-zA-Z0-9_.-]/g, '_');
      fs.writeFileSync(path.join(stateDir, 'tombstones', `${name}.json`), JSON.stringify({ repo: plan.event.repo, tag: plan.event.tag, deleted_at: new Date().toISOString() }));
    }
    save('delivery.json', { status: 'IGNORED', reason: plan.reason });
    return { exitCode: 0, status: 'IGNORED' };
  }
  const materialBytes = {};
  for (const key of ['event', 'contract', 'result']) {
    const bytes = fs.readFileSync(plan.material_paths[key]);
    if (computeSha256(bytes) !== plan[`${key}_sha256`]) throw deliveryError(`${key} material changed after plan! Hash mismatch.`, 'INVALID_INPUT', 2);
    materialBytes[key] = bytes;
  }
  const messageText = fs.readFileSync(path.join(path.dirname(planPath), 'message.md'), 'utf8');
  if (computeSha256(messageText) !== plan.message_sha256) throw deliveryError('Message markdown changed after plan! Hash mismatch.', 'INVALID_INPUT', 2);
  const originalEvent = JSON.parse(materialBytes.event);
  if (JSON.stringify(plan.event) !== JSON.stringify(originalEvent) ||
      JSON.stringify(plan.routing) !== JSON.stringify(originalEvent.routing) ||
      plan.action !== originalEvent.routing.mode ||
      plan.event_key !== computeEventKey(originalEvent.repo, originalEvent.tag, originalEvent.commit_sha)) {
    throw deliveryError('Plan identity does not match its hash-bound event.', 'INVALID_INPUT', 2);
  }
  validateEvent(originalEvent);
  validateRouting(plan.routing, plan.event.repo);
  const contract = JSON.parse(materialBytes.contract); contract._raw = materialBytes.contract.toString('utf8');
  validateProjectContractAndResult(contract, JSON.parse(materialBytes.result), plan.material_paths.evidence_root, plan.event.commit_sha);

  const lockDir = path.join(stateDir, 'locks'); fs.mkdirSync(lockDir, { recursive: true });
  const lockFile = path.join(lockDir, `${plan.event.repo.replace(/[^a-zA-Z0-9_-]/g, '_')}-${plan.event.tag}.lock`);
  let lockFd;
  try { lockFd = fs.openSync(lockFile, 'wx'); fs.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, time: Date.now() })); }
  catch { throw deliveryError(`Lock acquisition failed for ${lockFile}: already held or contested.`, 'LOCK_FAILED'); }
  const requests = [];
  let before = null, after = null;
  const repoPrefix = `/repos/${plan.event.repo}/`;
  async function apiFetch(endpoint, options = {}) {
    const url = new URL(endpoint, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(repoPrefix)) throw deliveryError('API request escaped the selected repo/origin.');
    const log = { url: url.toString(), method: options.method || 'GET', ...(options.body ? { body: options.body } : {}) };
    requests.push(log);
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...options.headers };
    if (mode === 'live') headers.Authorization = `Bearer ${token}`;
    try {
      const res = await fetchImpl(url.toString(), { ...options, headers, redirect: 'manual', signal: AbortSignal.timeout(15000) });
      log.status = res.status;
      if (res.status >= 300 && res.status < 400) throw deliveryError('API redirect rejected.');
      return res;
    } catch (e) {
      log.error = e.status ? e.message : 'network request failed';
      throw e;
    }
  }
  const listPath = plan.action === 'existing' ? `${repoPrefix}issues/${plan.routing.target.number}/comments` : plan.action === 'followup' ? `${repoPrefix}issues` : `${repoPrefix}releases`;
  const collectionName = plan.action === 'existing' ? 'comments' : plan.action === 'followup' ? 'issues' : 'releases';
  const snapshot = items => ({ [collectionName]: items });
  function httpError(res) {
    if ([401, 403, 404, 422].includes(res.status)) return deliveryError(`GitHub rejected request: HTTP ${res.status}.`);
    return deliveryError(`API response uncertain: HTTP ${res.status}.`, 'PENDING_RECONCILE', 4);
  }
  async function listItems(maxPages = 1000) {
    const items = [];
    for (let page = 1; page <= maxPages; page++) {
      const suffix = plan.action === 'followup' ? '&state=all' : '';
      const res = await apiFetch(`${listPath}?page=${page}&per_page=30${suffix}`);
      if (!res.ok) throw httpError(res);
      const rows = await res.json();
      if (!Array.isArray(rows)) throw deliveryError('Malformed API list response.', 'PENDING_RECONCILE', 4);
      items.push(...rows);
      if (rows.length < 30) return items;
    }
    throw deliveryError('Remote history exceeds this read budget; retry after inspection.', 'PENDING_RECONCILE', 4);
  }
  const itemPath = item => plan.action === 'existing' ? `${repoPrefix}issues/comments/${item.id}` : plan.action === 'followup' ? `${repoPrefix}issues/${item.number}` : `${repoPrefix}releases/${item.id}`;
  function verifyTarget(item, effectiveCommit = plan.event.commit_sha) {
    if (plan.action === 'existing') {
      const expected = `${base.origin}${repoPrefix}issues/${plan.routing.target.number}`;
      if ((mode === 'live' || item.issue_url) && item.issue_url !== expected) throw deliveryError('Remote item belongs to a different target.', 'CONFLICT');
    } else if (plan.action === 'release' && (item.tag_name !== plan.event.tag || (item.target_commitish && item.target_commitish !== effectiveCommit))) {
      throw deliveryError('Remote Release tag/commit does not match.', 'CONFLICT');
    }
  }
  async function readItem(item, expectedBody, expectedMarker = null) {
    const res = await apiFetch(itemPath(item));
    if (!res.ok) throw httpError(res);
    const actual = await res.json();
    const observed = (after?.[collectionName] || before?.[collectionName] || []).filter(i => i.id !== actual.id);
    after = { ...snapshot([...observed, actual]), readback_item: actual };
    if (actual.id !== item.id || actual.body !== expectedBody) throw deliveryError('Read-back body or identity differs from the planned content.', 'CONFLICT');
    verifyTarget(actual, expectedMarker?.commit_sha || plan.event.commit_sha);
    if (expectedMarker) {
      const marker = parseMarker(actual.body);
      if (!marker || ['event_key', 'repo', 'tag', 'commit_sha'].some(k => marker[k] !== expectedMarker[k])) throw deliveryError('Read-back marker differs from event identity.', 'CONFLICT');
    }
    return actual;
  }
  // One write attempt; an ambiguous response gets at most two reads, including final GET.
  async function writeAndRead(endpoint, method, payload, expectedBody, findItem, marker = null) {
    let res, created;
    try { res = await apiFetch(endpoint, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); }
    catch (e) { if (e.status) throw e; }
    if (res && !res.ok && [401, 403, 404, 422].includes(res.status)) throw httpError(res);
    if (res?.ok) {
      try { created = await res.json(); } catch { /* unreadable commit result requires reconcile */ }
    }
    if (!created) {
      // A full page cannot prove absence within the two-read budget. Never issue another POST.
      const items = await listItems(1);
      after = snapshot(items);
      created = findItem(items);
      if (!created) throw deliveryError('Write outcome unknown; remote marker not confirmed. Do not resend blindly.', 'PENDING_RECONCILE', 4);
    }
    return readItem(created, expectedBody, marker);
  }
  try {
    const ledgerPath = path.join(stateDir, 'ledger.json');
    let ledger = { deliveries: [] };
    if (fs.existsSync(ledgerPath)) {
      try { ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8')); if (!Array.isArray(ledger.deliveries)) throw new Error(); }
      catch { throw deliveryError(`Ledger at ${ledgerPath} is corrupted! Fail-closed.`, 'LEDGER_CORRUPTED'); }
    }
    const existing = ledger.deliveries.find(d => d.event_key === plan.event_key);
    if (existing && (existing.action !== plan.action || JSON.stringify(existing.target ?? null) !== JSON.stringify(plan.routing.target ?? null) || (existing.message_sha256 && existing.message_sha256 !== plan.message_sha256))) {
      throw deliveryError('Same event key has a different target/action/content.', 'CONFLICT');
    }
    const items = await listItems(); before = snapshot(items);
    const findCurrent = rows => rows.find(i => parseMarker(i.body)?.event_key === plan.event_key);
    const current = findCurrent(items);
    const prior = items.find(i => { const m = parseMarker(i.body); return m?.repo === plan.event.repo && m.tag === plan.event.tag && m.commit_sha !== plan.event.commit_sha; });
    const priorLedger = ledger.deliveries.find(d => d.repo === plan.event.repo && d.tag === plan.event.tag && d.commit_sha !== plan.event.commit_sha);
    if (prior || priorLedger) {
      if (!prior) throw deliveryError('Prior tag binding is no longer visible remotely.', 'CONFLICT');
      if (mode === 'live' && !activation.allowed_write_types.includes('tag_repoint_notice')) throw deliveryError('Tag repoint notices are not authorized.');
      const oldSha = parseMarker(prior.body).commit_sha;
      const noticeMarker = `<!-- repoint-notification: ${plan.event.tag}-${plan.event.commit_sha} -->`;
      const warning = `\n\n> [!WARNING]\n> **版本異動通知**：Tag \`${plan.event.tag}\` 參照由前次 SHA \`${oldSha}\` 改指向至新 SHA \`${plan.event.commit_sha}\`。異動時間：\`${plan.event.observed_at}\`。有效參照維持原紀錄，需人工審查。${noticeMarker}`;
      let notice;
      if (plan.action === 'existing') {
        const found = items.find(i => i.body?.includes(noticeMarker));
        notice = found ? await readItem(found, warning) : await writeAndRead(listPath, 'POST', { body: warning }, warning, rows => rows.find(i => i.body?.includes(noticeMarker)));
        after = snapshot(found ? items.map(i => i.id === notice.id ? notice : i) : [...items, notice]);
      } else if (plan.action === 'release') {
        const expected = prior.body.includes(noticeMarker) ? prior.body : prior.body + warning;
        notice = prior.body.includes(noticeMarker) ? await readItem(prior, expected, parseMarker(prior.body)) : await writeAndRead(itemPath(prior), 'PATCH', { body: expected }, expected, rows => rows.find(i => i.id === prior.id && i.body?.includes(noticeMarker)), parseMarker(prior.body));
        after = snapshot(items.map(i => i.id === prior.id ? notice : i));
      } else throw deliveryError('Tag repoint requires the previously recorded existing/Release destination.');
      save('delivery.json', { status: 'REVIEW_REQUIRED', reason: 'Tag repointing detected', old_sha: oldSha, new_sha: plan.event.commit_sha, notification: notice });
      throw deliveryError(`Tag repointing detected for ${plan.event.tag}. REVIEW_REQUIRED.`, 'REVIEW_REQUIRED');
    }
    const marker = { event_key: plan.event_key, repo: plan.event.repo, tag: plan.event.tag, commit_sha: plan.event.commit_sha };
    let actual, status;
    if (current) {
      actual = await readItem(current, messageText, marker); status = 'ALREADY_DELIVERED';
      after = snapshot(items.map(i => i.id === actual.id ? actual : i));
    } else {
      if (existing) throw deliveryError('Ledger delivery is missing remotely; do not recreate it.', 'CONFLICT');
      if (plan.action === 'release' && items.some(i => i.tag_name === plan.event.tag)) throw deliveryError('Existing Release has no verifiable tracking marker.');
      const payload = plan.action === 'existing' ? { body: messageText } : plan.action === 'followup' ? { title: plan.routing.title, body: messageText } : { tag_name: plan.event.tag, target_commitish: plan.event.commit_sha, name: plan.event.tag, body: messageText };
      actual = await writeAndRead(listPath, 'POST', payload, messageText, findCurrent, marker); status = 'DELIVERED';
      after = { ...snapshot([...items, actual]), delivered_item: actual };
    }
    if (!existing) {
      ledger.deliveries.push({ ...marker, action: plan.action, target: plan.routing.target || null, message_sha256: plan.message_sha256, delivered_at: new Date().toISOString(), item_id: actual.id || actual.number });
      const temp = `${ledgerPath}.tmp`; fs.writeFileSync(temp, JSON.stringify(ledger, null, 2)); fs.renameSync(temp, ledgerPath);
    }
    save('delivery.json', { status, event_key: plan.event_key, delivered_item: actual });
    return { exitCode: 0, status };
  } catch (e) {
    const error = e.status ? e : deliveryError('Network or API decoding failed; remote state is uncertain.', 'PENDING_RECONCILE', 4);
    if (error.status !== 'REVIEW_REQUIRED') save('delivery.json', { status: error.status, error: error.message });
    throw error;
  } finally {
    save('requests.json', requests);
    if (before) save('remote-before.json', before);
    if (after) save('remote-after.json', after);
    try { fs.closeSync(lockFd); } finally { fs.unlinkSync(lockFile); }
  }
}

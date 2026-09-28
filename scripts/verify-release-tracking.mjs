#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseMarker } from "./lib/release-tracking.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(ROOT, "system-workflow", "fixtures", "release-tracking");
const CLI_PATH = process.env.RELEASE_TRACKING_CLI_PATH || path.join(ROOT, "scripts", "release-tracking.mjs");

function computeSha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out") {
      options.out = args[++i];
    } else if (args[i] === "--case") {
      options.case = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      options.help = true;
    }
  }
  return options;
}

// In-Memory Mock GitHub Server
class MockGitHubServer {
  constructor() {
    this.server = null;
    this.port = null;
    this.url = null;
    this.reset();
  }

  reset() {
    this.issues = new Map();
    this.comments = new Map();
    this.releases = new Map();
    this.requests = [];
    this.nextCommentId = 1000;
    this.nextIssueId = 2000;
    this.nextReleaseId = 3000;
    this.faultMode = null; // 'post-disconnect' | 'refuse' | 'corrupt-readback'

    // Seed default issues
    this.issues.set("fixture/release-tracking#101", {
      id: 101,
      number: 101,
      repo: "fixture/release-tracking",
      title: "Pilot Target Issue",
      body: "Initial issue body for RT testing.",
      comments: [],
    });

    this.issues.set("fixture/release-tracking#102", {
      id: 102,
      number: 102,
      repo: "fixture/release-tracking",
      title: "Pilot Target PR",
      body: "Initial PR body for RT testing.",
      comments: [],
    });
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res));
      this.server.listen(0, "127.0.0.1", () => {
        this.port = this.server.address().port;
        this.url = `http://127.0.0.1:${this.port}`;
        resolve(this.url);
      });
      this.server.on("error", reject);
    });
  }

  async stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  handleRequest(req, res) {
    const parsed = new URL(req.url, this.url);
    const pathname = parsed.pathname;
    const method = req.method;

    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      this.requests.push({ method, pathname, query: Object.fromEntries(parsed.searchParams), body });

      // Handle Fault Modes
      if (this.faultMode === "refuse") {
        req.socket.destroy();
        return;
      }

      if (method === "POST" && this.faultMode === "post-disconnect") {
        this.processPost(pathname, body, () => {
          req.socket.destroy();
        });
        return;
      }

      if (method === "GET") {
        this.handleGet(pathname, parsed.searchParams, res);
      } else if (method === "POST") {
        this.processPost(pathname, body, (status, data) => {
          res.writeHead(status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(data));
        });
      } else if (method === "PATCH") {
        this.handlePatch(pathname, body, res);
      } else {
        res.writeHead(405);
        res.end();
      }
    });
  }

  handleGet(pathname, searchParams, res) {
    // 1. Comments of issue/PR: /repos/:owner/:repo/issues/:number/comments
    const commentsMatch = pathname.match(/^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/);
    if (commentsMatch) {
      const repo = commentsMatch[1];
      const number = parseInt(commentsMatch[2], 10);
      const key = `${repo}#${number}`;
      const issue = this.issues.get(key);
      if (!issue) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ message: "Not Found" }));
      }
      const page = parseInt(searchParams.get("page") || "1", 10);
      const perPage = parseInt(searchParams.get("per_page") || "30", 10);
      const start = (page - 1) * perPage;
      const paginated = issue.comments.slice(start, start + perPage);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(paginated));
    }

    // 2. Specific comment: /repos/:owner/:repo/issues/comments/:id
    const commentMatch = pathname.match(/^\/repos\/([^/]+\/[^/]+)\/issues\/comments\/(\d+)$/);
    if (commentMatch) {
      const commentId = parseInt(commentMatch[2], 10);
      const comment = this.comments.get(commentId);
      if (!comment) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ message: "Comment Not Found" }));
      }
      if (this.faultMode === "corrupt-readback") {
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ ...comment, body: "CORRUPTED_BODY_WITHOUT_MARKER" }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(comment));
    }

    // 3. List issues: /repos/:owner/:repo/issues
    const issuesListMatch = pathname.match(/^\/repos\/([^/]+\/[^/]+)\/issues$/);
    if (issuesListMatch) {
      const repo = issuesListMatch[1];
      const list = Array.from(this.issues.values()).filter((i) => i.repo === repo);
      const page = parseInt(searchParams.get("page") || "1", 10);
      const perPage = parseInt(searchParams.get("per_page") || "30", 10);
      const start = (page - 1) * perPage;
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(list.slice(start, start + perPage)));
    }

    // 4. Specific issue: /repos/:owner/:repo/issues/:number
    const issueMatch = pathname.match(/^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/);
    if (issueMatch) {
      const repo = issueMatch[1];
      const number = parseInt(issueMatch[2], 10);
      const issue = this.issues.get(`${repo}#${number}`);
      if (!issue) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ message: "Issue Not Found" }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(issue));
    }

    // 5. List releases: /repos/:owner/:repo/releases
    const releasesMatch = pathname.match(/^\/repos\/([^/]+\/[^/]+)\/releases$/);
    if (releasesMatch) {
      const repo = releasesMatch[1];
      const list = Array.from(this.releases.values()).filter((r) => r.repo === repo);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(list));
    }

    // 6. Specific release: /repos/:owner/:repo/releases/:id
    const releaseMatch = pathname.match(/^\/repos\/([^/]+\/[^/]+)\/releases\/(\d+)$/);
    if (releaseMatch) {
      const relId = parseInt(releaseMatch[2], 10);
      const rel = this.releases.get(relId);
      if (!rel) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ message: "Release Not Found" }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(rel));
    }

    res.writeHead(404);
    res.end();
  }

  processPost(pathname, body, callback) {
    let data = {};
    try { data = JSON.parse(body); } catch {}

    // 1. Post comment: /repos/:owner/:repo/issues/:number/comments
    const commentsMatch = pathname.match(/^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/);
    if (commentsMatch) {
      const repo = commentsMatch[1];
      const number = parseInt(commentsMatch[2], 10);
      const key = `${repo}#${number}`;
      const issue = this.issues.get(key);
      if (!issue) {
        return callback(404, { message: "Not Found" });
      }
      const commentId = ++this.nextCommentId;
      const comment = {
        id: commentId,
        body: data.body,
        created_at: new Date().toISOString(),
        url: `/repos/${repo}/issues/comments/${commentId}`,
      };
      this.comments.set(commentId, comment);
      issue.comments.push(comment);
      return callback(201, comment);
    }

    // 2. Post new issue: /repos/:owner/:repo/issues
    const issuesMatch = pathname.match(/^\/repos\/([^/]+\/[^/]+)\/issues$/);
    if (issuesMatch) {
      const repo = issuesMatch[1];
      const issueId = ++this.nextIssueId;
      const issue = {
        id: issueId,
        number: issueId,
        repo,
        title: data.title,
        body: data.body,
        work_key: data.work_key,
        comments: [],
        created_at: new Date().toISOString(),
        url: `/repos/${repo}/issues/${issueId}`,
      };
      this.issues.set(`${repo}#${issueId}`, issue);
      return callback(201, issue);
    }

    // 3. Post release: /repos/:owner/:repo/releases
    const releasesMatch = pathname.match(/^\/repos\/([^/]+\/[^/]+)\/releases$/);
    if (releasesMatch) {
      const repo = releasesMatch[1];
      const relId = ++this.nextReleaseId;
      const release = {
        id: relId,
        repo,
        tag_name: data.tag_name,
        target_commitish: data.target_commitish,
        name: data.name,
        body: data.body,
        created_at: new Date().toISOString(),
        url: `/repos/${repo}/releases/${relId}`,
      };
      this.releases.set(relId, release);
      return callback(201, release);
    }

    callback(404, { message: "Not Found" });
  }

  handlePatch(pathname, body, res) {
    let data = {};
    try { data = JSON.parse(body); } catch {}
    const releaseMatch = pathname.match(/^\/repos\/([^/]+\/[^/]+)\/releases\/(\d+)$/);
    if (releaseMatch) {
      const relId = parseInt(releaseMatch[2], 10);
      const rel = this.releases.get(relId);
      if (!rel) {
        res.writeHead(404);
        return res.end();
      }
      if (data.body) rel.body = data.body;
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(rel));
    }
    res.writeHead(404);
    res.end();
  }
}

// Asynchronous CLI Invocation Helpers (yielding Node event loop to serve mock HTTP)
function runCliPlan({ event, contract, result, evidenceRoot, out }) {
  return new Promise((resolve) => {
    const proc = spawn("node", [
      CLI_PATH,
      "plan",
      "--event", event,
      "--contract", contract,
      "--result", result,
      "--evidence-root", evidenceRoot,
      "--out", out,
    ], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
    proc.on("error", (err) => {
      resolve({ exitCode: 1, stdout, stderr: err.message });
    });
  });
}

function runCliApply({ plan, apiBase, stateDir, out, mode = "fixture" }) {
  return new Promise((resolve) => {
    const proc = spawn("node", [
      CLI_PATH,
      "apply",
      "--plan", plan,
      "--mode", mode,
      "--api-base", apiBase,
      "--state-dir", stateDir,
      "--out", out,
    ], {
      cwd: ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });
    proc.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
    proc.on("error", (err) => {
      resolve({ exitCode: 1, stdout, stderr: err.message });
    });
  });
}

// Main Test Execution Function
async function runAllTests(targetOutDir, targetCase = null) {
  if (fs.existsSync(targetOutDir)) {
    console.error(`Error: Output directory '${targetOutDir}' already exists. Rejection to prevent overwrite.`);
    process.exit(1);
  }

  const casesCatalogPath = path.join(FIXTURES_DIR, "cases.json");
  const contractFixturePath = path.join(FIXTURES_DIR, "contract.json");
  const projectContractTemplatePath = path.join(FIXTURES_DIR, "project-contract.template.json");

  const casesCatalog = JSON.parse(fs.readFileSync(casesCatalogPath, "utf8"));
  const contractSha256 = computeSha256(fs.readFileSync(contractFixturePath));

  if (targetCase && !casesCatalog.cases.some((c) => c.id === targetCase)) {
    console.error(`Error: Unknown test case '${targetCase}'.`);
    process.exit(1);
  }

  fs.mkdirSync(targetOutDir, { recursive: true });

  // 1. Prepare disposable git fixture repo
  const gitFixtureDir = path.join(targetOutDir, ".git-fixture");
  fs.mkdirSync(gitFixtureDir, { recursive: true });
  execFileSync("git", ["init"], { cwd: gitFixtureDir });
  execFileSync("git", ["config", "user.name", "Fixture Runner"], { cwd: gitFixtureDir });
  execFileSync("git", ["config", "user.email", "runner@example.local"], { cwd: gitFixtureDir });

  fs.writeFileSync(path.join(gitFixtureDir, "index.js"), 'console.log("fixture-ok");\n', "utf8");
  execFileSync("git", ["add", "index.js"], { cwd: gitFixtureDir });
  execFileSync("git", ["commit", "-m", "Commit A"], { cwd: gitFixtureDir });
  const commitA = execFileSync("git", ["rev-parse", "HEAD"], { cwd: gitFixtureDir, encoding: "utf8" }).trim();

  // Create tags pointing to A
  execFileSync("git", ["tag", "v0.0.1-pilot"], { cwd: gitFixtureDir });
  execFileSync("git", ["tag", "-a", "v0.0.2-pilot", "-m", "Annotated tag pointing to commit A"], { cwd: gitFixtureDir });

  // Create commit B
  fs.writeFileSync(path.join(gitFixtureDir, "index.js"), 'console.log("fixture-commit-b");\n', "utf8");
  execFileSync("git", ["add", "index.js"], { cwd: gitFixtureDir });
  execFileSync("git", ["commit", "-m", "Commit B"], { cwd: gitFixtureDir });
  const commitB = execFileSync("git", ["rev-parse", "HEAD"], { cwd: gitFixtureDir, encoding: "utf8" }).trim();

  // 2. Run real command to produce real fixture evidence
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const fixtureOutput = execFileSync("node", ["-e", 'console.log("fixture-ok")'], { encoding: "utf8" });
  const fixtureDuration = Date.now() - t0;

  // 3. Start Mock Server
  const mockServer = new MockGitHubServer();
  const apiBase = await mockServer.start();

  const caseResults = [];

  // Helper to create test input directory
  function createInputBundle(caseDir, overrides = {}) {
    const inputDir = path.join(caseDir, "input");
    const evidenceDir = path.join(inputDir, "evidence");
    fs.mkdirSync(evidenceDir, { recursive: true });

    // Evidence file
    const evidenceLogPath = path.join(evidenceDir, "run.log");
    fs.writeFileSync(evidenceLogPath, fixtureOutput, "utf8");
    const evidenceSha = computeSha256(fixtureOutput);

    // Project contract
    const projectContractPath = path.join(inputDir, "contract.json");
    const projectContractContent = fs.readFileSync(projectContractTemplatePath, "utf8");
    fs.writeFileSync(projectContractPath, projectContractContent, "utf8");
    const projectContractSha = computeSha256(projectContractContent);

    // Event
    const event = {
      schema_version: 1,
      event_id: overrides.event_id || "evt-01",
      event_type: "tag_push",
      repo: "fixture/release-tracking",
      ref: `refs/tags/${overrides.tag || "v0.0.1-pilot"}`,
      tag: overrides.tag || "v0.0.1-pilot",
      commit_sha: overrides.commit_sha || commitA,
      observed_at: "2026-09-26T00:00:00Z",
      deleted: Boolean(overrides.deleted),
      git_repo_path: gitFixtureDir,
      routing: overrides.routing || {
        mode: "existing",
        target: { kind: "issue", repo: "fixture/release-tracking", number: 101 },
      },
    };
    if (overrides.event_type) event.event_type = overrides.event_type;

    const eventPath = path.join(inputDir, "event.json");
    fs.writeFileSync(eventPath, JSON.stringify(event, null, 2), "utf8");

    // Result
    const result = {
      schema_version: 1,
      contract_sha256: projectContractSha,
      source_commit: overrides.result_source_commit || event.commit_sha,
      environment: {
        os: "darwin",
        arch: process.arch,
        node: process.version,
        git: "git CLI",
      },
      ci: {
        kind: "local",
      },
      cases: overrides.result_cases || [
        {
          id: "F-PASS-01",
          status: "PASS",
          command: 'node -e "console.log(\'fixture-ok\')"',
          exit_code: 0,
          started_at: startedAt,
          duration_ms: fixtureDuration,
          evidence: [
            {
              path: "evidence/run.log",
              sha256: evidenceSha,
            },
          ],
        },
      ],
    };
    const resultPath = path.join(inputDir, "result.json");
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), "utf8");

    return { inputDir, eventPath, projectContractPath, resultPath, evidenceDir, event, result };
  }

  try {
    // -------------------------------------------------------------
    // RT01: Minimal full delivery flow (existing Issue #101)
    // -------------------------------------------------------------
    if (!targetCase || targetCase === "RT01") {
      mockServer.reset();
      const caseDir = path.join(targetOutDir, "RT01");
      const { inputDir, eventPath, projectContractPath, resultPath } = createInputBundle(caseDir);
      const planOut = path.join(caseDir, "plan");
      const applyOut = path.join(caseDir, "apply");
      const stateDir = path.join(caseDir, "state");

      const planRes = await runCliPlan({
        event: eventPath,
        contract: projectContractPath,
        result: resultPath,
        evidenceRoot: inputDir,
        out: planOut,
      });

      const applyRes = await runCliApply({
        plan: path.join(planOut, "plan.json"),
        apiBase,
        stateDir,
        out: applyOut,
      });

      const issue101 = mockServer.issues.get("fixture/release-tracking#101");
      const comments = issue101.comments;
      const lastComment = comments[comments.length - 1];

      const bodyHasTag = !!(lastComment && lastComment.body.includes("v0.0.1-pilot"));
      const bodyHasCommitA = !!(lastComment && lastComment.body.includes(`**完整 Commit SHA**：\`${commitA}\``));
      const bodyHasFixture = !!(lastComment && lastComment.body.includes("fixture"));
      const bodyHasCase = !!(lastComment && lastComment.body.includes("F-PASS-01"));

      const pass =
        planRes.exitCode === 0 &&
        applyRes.exitCode === 0 &&
        comments.length === 1 &&
        bodyHasTag &&
        bodyHasCommitA &&
        bodyHasFixture &&
        bodyHasCase;

      caseResults.push({
        id: "RT01",
        status: pass ? "PASS" : "FAIL",
        actual: { exitCode: applyRes.exitCode, commentsCount: comments.length, bodyHasCommitA },
        expected: { exitCode: 0, commentsCount: 1, bodyHasCommitA: true },
        artifacts: [path.join("RT01", "apply", "delivery.json")],
      });
    }

    // -------------------------------------------------------------
    // RT02: PR #102 & 404 target
    // -------------------------------------------------------------
    if (!targetCase || targetCase === "RT02") {
      mockServer.reset();
      const caseDir = path.join(targetOutDir, "RT02");
      // Subcase 1: PR #102
      const sub1Dir = path.join(caseDir, "pr");
      const b1 = createInputBundle(sub1Dir, {
        routing: { mode: "existing", target: { kind: "pr", repo: "fixture/release-tracking", number: 102 } },
      });
      const p1 = path.join(sub1Dir, "plan");
      const a1 = path.join(sub1Dir, "apply");
      await runCliPlan({ event: b1.eventPath, contract: b1.projectContractPath, result: b1.resultPath, evidenceRoot: b1.inputDir, out: p1 });
      const r1 = await runCliApply({ plan: path.join(p1, "plan.json"), apiBase, stateDir: path.join(sub1Dir, "state"), out: a1 });

      // Subcase 2: Non-existent #999
      const sub2Dir = path.join(caseDir, "not-found");
      const b2 = createInputBundle(sub2Dir, {
        routing: { mode: "existing", target: { kind: "issue", repo: "fixture/release-tracking", number: 999 } },
      });
      const p2 = path.join(sub2Dir, "plan");
      const a2 = path.join(sub2Dir, "apply");
      await runCliPlan({ event: b2.eventPath, contract: b2.projectContractPath, result: b2.resultPath, evidenceRoot: b2.inputDir, out: p2 });
      const r2 = await runCliApply({ plan: path.join(p2, "plan.json"), apiBase, stateDir: path.join(sub2Dir, "state"), out: a2 });

      const pr102 = mockServer.issues.get("fixture/release-tracking#102");
      const pass = r1.exitCode === 0 && pr102.comments.length === 1 && r2.exitCode === 3;

      caseResults.push({
        id: "RT02",
        status: pass ? "PASS" : "FAIL",
        actual: { r1Exit: r1.exitCode, r2Exit: r2.exitCode },
        expected: { r1Exit: 0, r2Exit: 3 },
        artifacts: [path.join("RT02", "pr", "apply", "delivery.json")],
      });
    }

    // -------------------------------------------------------------
    // RT03: Deduplication and pagination
    // -------------------------------------------------------------
    if (!targetCase || targetCase === "RT03") {
      mockServer.reset();
      const caseDir = path.join(targetOutDir, "RT03");
      const b = createInputBundle(caseDir, { event_id: "evt-rt03-1" });
      const p = path.join(caseDir, "plan");
      const a = path.join(caseDir, "apply-1");
      const stateDir = path.join(caseDir, "state");
      await runCliPlan({ event: b.eventPath, contract: b.projectContractPath, result: b.resultPath, evidenceRoot: b.inputDir, out: p });
      const r1 = await runCliApply({ plan: path.join(p, "plan.json"), apiBase, stateDir, out: a });

      // Re-send with different event_id
      const b2 = createInputBundle(path.join(caseDir, "resend"), { event_id: "evt-rt03-2" });
      const p2 = path.join(caseDir, "resend", "plan");
      const a2 = path.join(caseDir, "apply-2");
      await runCliPlan({ event: b2.eventPath, contract: b2.projectContractPath, result: b2.resultPath, evidenceRoot: b2.inputDir, out: p2 });
      const r2 = await runCliApply({ plan: path.join(p2, "plan.json"), apiBase, stateDir, out: a2 });

      // Pagination check: create dummy comments on Issue 101 to push our comment to page 2, with empty local ledger
      const issue101 = mockServer.issues.get("fixture/release-tracking#101");
      const savedComments = [...issue101.comments];
      const dummies = Array.from({ length: 35 }, (_, idx) => ({
        id: 5000 + idx,
        body: `Dummy comment ${idx}`,
        url: `/repos/fixture/release-tracking/issues/comments/${5000 + idx}`,
      }));
      issue101.comments = [...dummies, ...savedComments];

      const a3 = path.join(caseDir, "apply-3");
      const emptyStateDir = path.join(caseDir, "empty-state");
      const r3 = await runCliApply({ plan: path.join(p2, "plan.json"), apiBase, stateDir: emptyStateDir, out: a3 });

      // Restore comments
      issue101.comments = savedComments;

      const d2 = fs.existsSync(path.join(a2, "delivery.json"))
        ? JSON.parse(fs.readFileSync(path.join(a2, "delivery.json"), "utf8"))
        : { status: "MISSING" };
      const d3 = fs.existsSync(path.join(a3, "delivery.json"))
        ? JSON.parse(fs.readFileSync(path.join(a3, "delivery.json"), "utf8"))
        : { status: "MISSING" };

      const pass =
        r1.exitCode === 0 &&
        r2.exitCode === 0 &&
        d2.status === "ALREADY_DELIVERED" &&
        r3.exitCode === 0 &&
        d3.status === "ALREADY_DELIVERED";

      caseResults.push({
        id: "RT03",
        status: pass ? "PASS" : "FAIL",
        actual: { r2Status: d2.status, r3Status: d3.status },
        expected: { r2Status: "ALREADY_DELIVERED", r3Status: "ALREADY_DELIVERED" },
        artifacts: [path.join("RT03", "apply-2", "delivery.json")],
      });
    }

    // -------------------------------------------------------------
    // RT04: Followup issue routing and validation
    // -------------------------------------------------------------
    if (!targetCase || targetCase === "RT04") {
      mockServer.reset();
      const caseDir = path.join(targetOutDir, "RT04");
      // Subcase 1: Valid followup twice
      const sub1Dir = path.join(caseDir, "valid");
      const b1 = createInputBundle(sub1Dir, {
        routing: {
          mode: "followup",
          work_key: "manual-check-01",
          title: "人工核對發布",
          reason: "需要人工核對",
          acceptance: "確認指定 SHA 的發布紀錄",
        },
      });
      const p1 = path.join(sub1Dir, "plan");
      const a1 = path.join(sub1Dir, "apply-1");
      const a2 = path.join(sub1Dir, "apply-2");
      const s1 = path.join(sub1Dir, "state");
      await runCliPlan({ event: b1.eventPath, contract: b1.projectContractPath, result: b1.resultPath, evidenceRoot: b1.inputDir, out: p1 });
      const r1 = await runCliApply({ plan: path.join(p1, "plan.json"), apiBase, stateDir: s1, out: a1 });
      const r2 = await runCliApply({ plan: path.join(p1, "plan.json"), apiBase, stateDir: s1, out: a2 });

      // Subcase 2: Blank acceptance
      const sub2Dir = path.join(caseDir, "blank-acceptance");
      const b2 = createInputBundle(sub2Dir, {
        routing: {
          mode: "followup",
          work_key: "k2",
          title: "t2",
          reason: "r2",
          acceptance: "   ",
        },
      });
      const p2 = path.join(sub2Dir, "plan");
      const rPlan2 = await runCliPlan({ event: b2.eventPath, contract: b2.projectContractPath, result: b2.resultPath, evidenceRoot: b2.inputDir, out: p2 });

      // Subcase 3: Dual target
      const sub3Dir = path.join(caseDir, "dual-target");
      const b3 = createInputBundle(sub3Dir, {
        routing: {
          mode: "followup",
          work_key: "k3",
          title: "t3",
          reason: "r3",
          acceptance: "acc3",
          target: { kind: "issue", repo: "fixture/release-tracking", number: 101 },
        },
      });
      const p3 = path.join(sub3Dir, "plan");
      const rPlan3 = await runCliPlan({ event: b3.eventPath, contract: b3.projectContractPath, result: b3.resultPath, evidenceRoot: b3.inputDir, out: p3 });

      const d2 = fs.existsSync(path.join(a2, "delivery.json"))
        ? JSON.parse(fs.readFileSync(path.join(a2, "delivery.json"), "utf8"))
        : { status: "MISSING" };

      const pass =
        r1.exitCode === 0 &&
        r2.exitCode === 0 &&
        d2.status === "ALREADY_DELIVERED" &&
        rPlan2.exitCode === 2 &&
        rPlan3.exitCode === 2;

      caseResults.push({
        id: "RT04",
        status: pass ? "PASS" : "FAIL",
        actual: { r1Exit: r1.exitCode, r2Status: d2.status, rPlan2Exit: rPlan2.exitCode, rPlan3Exit: rPlan3.exitCode },
        expected: { r1Exit: 0, r2Status: "ALREADY_DELIVERED", rPlan2Exit: 2, rPlan3Exit: 2 },
        artifacts: [path.join("RT04", "valid", "apply-1", "delivery.json")],
      });
    }

    // -------------------------------------------------------------
    // RT05: Release creation and status gating
    // -------------------------------------------------------------
    if (!targetCase || targetCase === "RT05") {
      mockServer.reset();
      const caseDir = path.join(targetOutDir, "RT05");
      // Subcase 1: Valid release twice
      const sub1Dir = path.join(caseDir, "valid");
      const b1 = createInputBundle(sub1Dir, {
        routing: { mode: "release", changelog: "fixture release" },
      });
      const p1 = path.join(sub1Dir, "plan");
      const a1 = path.join(sub1Dir, "apply-1");
      const a2 = path.join(sub1Dir, "apply-2");
      const s1 = path.join(sub1Dir, "state");
      await runCliPlan({ event: b1.eventPath, contract: b1.projectContractPath, result: b1.resultPath, evidenceRoot: b1.inputDir, out: p1 });
      const r1 = await runCliApply({ plan: path.join(p1, "plan.json"), apiBase, stateDir: s1, out: a1 });
      const r2 = await runCliApply({ plan: path.join(p1, "plan.json"), apiBase, stateDir: s1, out: a2 });

      // Subcase 2: Result has FAIL
      const sub2Dir = path.join(caseDir, "fail-case");
      const b2 = createInputBundle(sub2Dir, {
        routing: { mode: "release", changelog: "fail release" },
        result_cases: [
          {
            id: "F-PASS-01",
            status: "FAIL",
            command: "exit 1",
            exit_code: 1,
            started_at: startedAt,
            duration_ms: 10,
            evidence: [{ path: "evidence/run.log", sha256: computeSha256(fixtureOutput) }],
          },
        ],
      });
      const p2 = path.join(sub2Dir, "plan");
      const rPlan2 = await runCliPlan({ event: b2.eventPath, contract: b2.projectContractPath, result: b2.resultPath, evidenceRoot: b2.inputDir, out: p2 });

      // Subcase 3: Result has NOT_RUN
      const sub3Dir = path.join(caseDir, "notrun-case");
      const b3 = createInputBundle(sub3Dir, {
        routing: { mode: "release", changelog: "notrun release" },
        result_cases: [
          {
            id: "F-PASS-01",
            status: "NOT_RUN",
            command: null,
            exit_code: null,
            started_at: null,
            duration_ms: null,
            reason: "Skipped in test",
            evidence: [],
          },
        ],
      });
      const p3 = path.join(sub3Dir, "plan");
      const rPlan3 = await runCliPlan({ event: b3.eventPath, contract: b3.projectContractPath, result: b3.resultPath, evidenceRoot: b3.inputDir, out: p3 });

      const d2 = fs.existsSync(path.join(a2, "delivery.json"))
        ? JSON.parse(fs.readFileSync(path.join(a2, "delivery.json"), "utf8"))
        : { status: "MISSING" };

      const pass =
        r1.exitCode === 0 &&
        r2.exitCode === 0 &&
        d2.status === "ALREADY_DELIVERED" &&
        rPlan2.exitCode === 3 &&
        rPlan3.exitCode === 3;

      caseResults.push({
        id: "RT05",
        status: pass ? "PASS" : "FAIL",
        actual: { r1Exit: r1.exitCode, r2Status: d2.status, rPlan2Exit: rPlan2.exitCode, rPlan3Exit: rPlan3.exitCode },
        expected: { r1Exit: 0, r2Status: "ALREADY_DELIVERED", rPlan2Exit: 3, rPlan3Exit: 3 },
        artifacts: [path.join("RT05", "valid", "apply-1", "delivery.json")],
      });
    }

    // -------------------------------------------------------------
    // RT06: Tag Peel and SHA validation
    // -------------------------------------------------------------
    if (!targetCase || targetCase === "RT06") {
      mockServer.reset();
      const caseDir = path.join(targetOutDir, "RT06");

      // 1. Lightweight tag
      const sub1 = path.join(caseDir, "lightweight");
      const b1 = createInputBundle(sub1, { tag: "v0.0.1-pilot" });
      const p1 = await runCliPlan({ event: b1.eventPath, contract: b1.projectContractPath, result: b1.resultPath, evidenceRoot: b1.inputDir, out: path.join(sub1, "plan") });

      // 2. Annotated tag
      const sub2 = path.join(caseDir, "annotated");
      const b2 = createInputBundle(sub2, { tag: "v0.0.2-pilot" });
      const p2 = await runCliPlan({ event: b2.eventPath, contract: b2.projectContractPath, result: b2.resultPath, evidenceRoot: b2.inputDir, out: path.join(sub2, "plan") });

      // 3. Short sha
      const sub3 = path.join(caseDir, "short-sha");
      const b3 = createInputBundle(sub3, { commit_sha: commitA.slice(0, 7) });
      const p3 = await runCliPlan({ event: b3.eventPath, contract: b3.projectContractPath, result: b3.resultPath, evidenceRoot: b3.inputDir, out: path.join(sub3, "plan") });

      // 4. Object sha of annotated tag
      const annotatedObjectSha = execFileSync("git", ["rev-parse", "refs/tags/v0.0.2-pilot"], { cwd: gitFixtureDir, encoding: "utf8" }).trim();
      const sub4 = path.join(caseDir, "object-sha");
      const b4 = createInputBundle(sub4, { commit_sha: annotatedObjectSha, tag: "v0.0.2-pilot" });
      const p4 = await runCliPlan({ event: b4.eventPath, contract: b4.projectContractPath, result: b4.resultPath, evidenceRoot: b4.inputDir, out: path.join(sub4, "plan") });

      // 5. Commit mismatch with result
      const sub5 = path.join(caseDir, "sha-mismatch");
      const b5 = createInputBundle(sub5, { commit_sha: commitA, result_source_commit: commitB });
      const p5 = await runCliPlan({ event: b5.eventPath, contract: b5.projectContractPath, result: b5.resultPath, evidenceRoot: b5.inputDir, out: path.join(sub5, "plan") });

      const pass =
        p1.exitCode === 0 &&
        p2.exitCode === 0 &&
        p3.exitCode === 2 &&
        p4.exitCode === 2 &&
        p5.exitCode === 2;

      caseResults.push({
        id: "RT06",
        status: pass ? "PASS" : "FAIL",
        actual: { p1: p1.exitCode, p2: p2.exitCode, p3: p3.exitCode, p4: p4.exitCode, p5: p5.exitCode },
        expected: { p1: 0, p2: 0, p3: 2, p4: 2, p5: 2 },
        artifacts: [path.join("RT06", "lightweight", "plan", "plan.json")],
      });
    }

    // -------------------------------------------------------------
    // RT07: Evidence negative variants (10 variants)
    // -------------------------------------------------------------
    if (!targetCase || targetCase === "RT07") {
      mockServer.reset();
      const caseDir = path.join(targetOutDir, "RT07");
      const variants = [
        "missing-file",
        "hash-mismatch",
        "escape-root",
        "symlink-escape",
        "missing-case",
        "duplicate-case",
        "unknown-case",
        "unknown-status",
        "pass-nonzero-exit",
        "empty-evidence",
      ];
      let allPassed = true;
      const variantOuts = [];

      for (const v of variants) {
        const vDir = path.join(caseDir, v);
        const b = createInputBundle(vDir);

        if (v === "missing-file") {
          fs.unlinkSync(path.join(b.evidenceDir, "run.log"));
        } else if (v === "hash-mismatch") {
          b.result.cases[0].evidence[0].sha256 = "0000000000000000000000000000000000000000000000000000000000000000";
          fs.writeFileSync(b.resultPath, JSON.stringify(b.result, null, 2), "utf8");
        } else if (v === "escape-root") {
          b.result.cases[0].evidence[0].path = "../outside.log";
          fs.writeFileSync(b.resultPath, JSON.stringify(b.result, null, 2), "utf8");
        } else if (v === "symlink-escape") {
          const symPath = path.join(b.evidenceDir, "sym.log");
          try { fs.symlinkSync("/etc/hosts", symPath); } catch {}
          b.result.cases[0].evidence[0].path = "evidence/sym.log";
          fs.writeFileSync(b.resultPath, JSON.stringify(b.result, null, 2), "utf8");
        } else if (v === "missing-case") {
          b.result.cases = [];
          fs.writeFileSync(b.resultPath, JSON.stringify(b.result, null, 2), "utf8");
        } else if (v === "duplicate-case") {
          b.result.cases.push({ ...b.result.cases[0] });
          fs.writeFileSync(b.resultPath, JSON.stringify(b.result, null, 2), "utf8");
        } else if (v === "unknown-case") {
          b.result.cases.push({ ...b.result.cases[0], id: "UNKNOWN-CASE-01" });
          fs.writeFileSync(b.resultPath, JSON.stringify(b.result, null, 2), "utf8");
        } else if (v === "unknown-status") {
          b.result.cases[0].status = "SOMETHING_ELSE";
          fs.writeFileSync(b.resultPath, JSON.stringify(b.result, null, 2), "utf8");
        } else if (v === "pass-nonzero-exit") {
          b.result.cases[0].exit_code = 1;
          fs.writeFileSync(b.resultPath, JSON.stringify(b.result, null, 2), "utf8");
        } else if (v === "empty-evidence") {
          b.result.cases[0].evidence = [];
          fs.writeFileSync(b.resultPath, JSON.stringify(b.result, null, 2), "utf8");
        }

        const res = await runCliPlan({
          event: b.eventPath,
          contract: b.projectContractPath,
          result: b.resultPath,
          evidenceRoot: b.inputDir,
          out: path.join(vDir, "plan"),
        });

        if (res.exitCode !== 2) {
          allPassed = false;
        }
        variantOuts.push({ variant: v, exitCode: res.exitCode });
      }

      caseResults.push({
        id: "RT07",
        status: allPassed ? "PASS" : "FAIL",
        actual: variantOuts,
        expected: "All variants exitCode === 2",
        artifacts: [path.join("RT07", "missing-file")],
      });
    }

    // -------------------------------------------------------------
    // RT08: Honest reporting of unexecuted or failed cases
    // -------------------------------------------------------------
    if (!targetCase || targetCase === "RT08") {
      mockServer.reset();
      const caseDir = path.join(targetOutDir, "RT08");
      // 1. FAIL report
      const s1 = path.join(caseDir, "fail");
      const b1 = createInputBundle(s1, {
        result_cases: [
          {
            id: "F-PASS-01",
            status: "FAIL",
            command: 'node -e "process.exit(1)"',
            exit_code: 1,
            started_at: startedAt,
            duration_ms: 5,
            evidence: [{ path: "evidence/run.log", sha256: computeSha256(fixtureOutput) }],
          },
        ],
      });
      const p1 = path.join(s1, "plan");
      const a1 = path.join(s1, "apply");
      await runCliPlan({ event: b1.eventPath, contract: b1.projectContractPath, result: b1.resultPath, evidenceRoot: b1.inputDir, out: p1 });
      const r1 = await runCliApply({ plan: path.join(p1, "plan.json"), apiBase, stateDir: path.join(s1, "state"), out: a1 });
      const msg1 = fs.readFileSync(path.join(p1, "message.md"), "utf8");

      // Each RT08 variant has independent remote state (same original fixture event key).
      mockServer.reset();
      // 2. NOT_RUN report
      const s2 = path.join(caseDir, "notrun");
      const b2 = createInputBundle(s2, {
        result_cases: [
          {
            id: "F-PASS-01",
            status: "NOT_RUN",
            command: null,
            exit_code: null,
            started_at: null,
            duration_ms: null,
            reason: "Environment dependency not available",
            evidence: [],
          },
        ],
      });
      const p2 = path.join(s2, "plan");
      const a2 = path.join(s2, "apply");
      await runCliPlan({ event: b2.eventPath, contract: b2.projectContractPath, result: b2.resultPath, evidenceRoot: b2.inputDir, out: p2 });
      const r2 = await runCliApply({ plan: path.join(p2, "plan.json"), apiBase, stateDir: path.join(s2, "state"), out: a2 });
      const msg2 = fs.readFileSync(path.join(p2, "message.md"), "utf8");

      mockServer.reset();
      // 3. BLOCKED report
      const s3 = path.join(caseDir, "blocked");
      const b3 = createInputBundle(s3, {
        result_cases: [
          {
            id: "F-PASS-01",
            status: "BLOCKED",
            command: null,
            exit_code: null,
            started_at: null,
            duration_ms: null,
            reason: "Blocked by upstream task",
            evidence: [],
          },
        ],
      });
      const p3 = path.join(s3, "plan");
      const a3 = path.join(s3, "apply");
      await runCliPlan({ event: b3.eventPath, contract: b3.projectContractPath, result: b3.resultPath, evidenceRoot: b3.inputDir, out: p3 });
      const r3 = await runCliApply({ plan: path.join(p3, "plan.json"), apiBase, stateDir: path.join(s3, "state"), out: a3 });
      const msg3 = fs.readFileSync(path.join(p3, "message.md"), "utf8");

      // 4. False exit 0
      const s4 = path.join(caseDir, "false-exit0");
      const b4 = createInputBundle(s4, {
        result_cases: [
          {
            id: "F-PASS-01",
            status: "NOT_RUN",
            command: null,
            exit_code: 0,
            started_at: null,
            duration_ms: null,
            reason: "Fake zero",
            evidence: [],
          },
        ],
      });
      const p4 = path.join(s4, "plan");
      const r4 = await runCliPlan({ event: b4.eventPath, contract: b4.projectContractPath, result: b4.resultPath, evidenceRoot: b4.inputDir, out: p4 });

      const pass =
        r1.exitCode === 0 && msg1.includes("未通過 (FAIL)") &&
        r2.exitCode === 0 && msg2.includes("未完成 (NOT_RUN)") &&
        r3.exitCode === 0 && msg3.includes("已阻塞 (BLOCKED)") &&
        r4.exitCode === 2;

      caseResults.push({
        id: "RT08",
        status: pass ? "PASS" : "FAIL",
        actual: { r1: r1.exitCode, r2: r2.exitCode, r3: r3.exitCode, r4: r4.exitCode },
        expected: { r1: 0, r2: 0, r3: 0, r4: 2 },
        artifacts: [path.join("RT08", "fail", "apply", "delivery.json")],
      });
    }

    // -------------------------------------------------------------
    // RT09: Fault injection and uncertain delivery reconciliation
    // -------------------------------------------------------------
    if (!targetCase || targetCase === "RT09") {
      const caseDir = path.join(targetOutDir, "RT09");
      // 1. Post disconnect but saved on server -> reconcile success
      mockServer.reset();
      const s1 = path.join(caseDir, "post-disconnect");
      const b1 = createInputBundle(s1);
      const p1 = path.join(s1, "plan");
      const a1 = path.join(s1, "apply");
      await runCliPlan({ event: b1.eventPath, contract: b1.projectContractPath, result: b1.resultPath, evidenceRoot: b1.inputDir, out: p1 });

      mockServer.faultMode = "post-disconnect";
      const r1 = await runCliApply({ plan: path.join(p1, "plan.json"), apiBase, stateDir: path.join(s1, "state"), out: a1 });
      mockServer.faultMode = null;

      // 2. Refused connection -> PENDING_RECONCILE (exit 4)
      mockServer.reset();
      const s2 = path.join(caseDir, "refused");
      const b2 = createInputBundle(s2);
      const p2 = path.join(s2, "plan");
      const a2 = path.join(s2, "apply");
      await runCliPlan({ event: b2.eventPath, contract: b2.projectContractPath, result: b2.resultPath, evidenceRoot: b2.inputDir, out: p2 });

      mockServer.faultMode = "refuse";
      const r2 = await runCliApply({ plan: path.join(p2, "plan.json"), apiBase, stateDir: path.join(s2, "state"), out: a2 });
      mockServer.faultMode = null;

      // 3. Corrupt readback -> REMOTE_MISMATCH (exit 3)
      mockServer.reset();
      const s3 = path.join(caseDir, "corrupt-readback");
      const b3 = createInputBundle(s3);
      const p3 = path.join(s3, "plan");
      const a3 = path.join(s3, "apply");
      await runCliPlan({ event: b3.eventPath, contract: b3.projectContractPath, result: b3.resultPath, evidenceRoot: b3.inputDir, out: p3 });

      mockServer.faultMode = "corrupt-readback";
      const r3 = await runCliApply({ plan: path.join(p3, "plan.json"), apiBase, stateDir: path.join(s3, "state"), out: a3 });
      mockServer.faultMode = null;

      const d1 = fs.existsSync(path.join(a1, "delivery.json")) ? JSON.parse(fs.readFileSync(path.join(a1, "delivery.json"), "utf8")) : null;
      const d2 = fs.existsSync(path.join(a2, "delivery.json")) ? JSON.parse(fs.readFileSync(path.join(a2, "delivery.json"), "utf8")) : null;

      const pass =
        r1.exitCode === 0 && d1?.status === "DELIVERED" &&
        r2.exitCode === 4 && d2?.status === "PENDING_RECONCILE" &&
        r3.exitCode === 3;

      caseResults.push({
        id: "RT09",
        status: pass ? "PASS" : "FAIL",
        actual: { r1Exit: r1.exitCode, r2Exit: r2.exitCode, r3Exit: r3.exitCode },
        expected: { r1Exit: 0, r2Exit: 4, r3Exit: 3 },
        artifacts: [path.join("RT09", "post-disconnect", "apply", "delivery.json")],
      });
    }

    // -------------------------------------------------------------
    // RT10: Concurrent apply processes on same host with lock
    // -------------------------------------------------------------
    if (!targetCase || targetCase === "RT10") {
      mockServer.reset();
      const caseDir = path.join(targetOutDir, "RT10");
      const b = createInputBundle(caseDir);
      const p = path.join(caseDir, "plan");
      const stateDir = path.join(caseDir, "state");
      await runCliPlan({ event: b.eventPath, contract: b.projectContractPath, result: b.resultPath, evidenceRoot: b.inputDir, out: p });

      const planJson = path.join(p, "plan.json");
      const a1 = path.join(caseDir, "apply-proc-1");
      const a2 = path.join(caseDir, "apply-proc-2");

      const runProc = (out) => new Promise((resolve) => {
        const proc = spawn("node", [CLI_PATH, "apply", "--plan", planJson, "--mode", "fixture", "--api-base", apiBase, "--state-dir", stateDir, "--out", out], { cwd: ROOT });
        let stdout = "";
        let stderr = "";
        proc.stdout.on("data", (d) => { stdout += d.toString(); });
        proc.stderr.on("data", (d) => { stderr += d.toString(); });
        proc.on("close", (code) => resolve({ code, stdout, stderr }));
      });

      const [res1, res2] = await Promise.all([runProc(a1), runProc(a2)]);

      const codes = [res1.code, res2.code].sort();
      const oneSucceeded = codes[0] === 0;
      const oneLockFailed = codes[1] === 3;

      const retryOut = path.join(caseDir, "apply-retry");
      const retryRes = await runCliApply({ plan: planJson, apiBase, stateDir, out: retryOut });
      const retryDelivery = fs.existsSync(path.join(retryOut, "delivery.json"))
        ? JSON.parse(fs.readFileSync(path.join(retryOut, "delivery.json"), "utf8"))
        : null;

      const pass = oneSucceeded && oneLockFailed && retryRes.exitCode === 0 && retryDelivery?.status === "ALREADY_DELIVERED";

      caseResults.push({
        id: "RT10",
        status: pass ? "PASS" : "FAIL",
        actual: { codes, retryCode: retryRes.exitCode, retryStatus: retryDelivery?.status },
        expected: { codes: [0, 3], retryCode: 0, retryStatus: "ALREADY_DELIVERED" },
        artifacts: [path.join("RT10", "apply-retry", "delivery.json")],
      });
    }

    // -------------------------------------------------------------
    // RT11: Tag Repointing
    // -------------------------------------------------------------
    if (!targetCase || targetCase === "RT11") {
      mockServer.reset();
      const caseDir = path.join(targetOutDir, "RT11");
      // 1. Existing target repointing
      const s1 = path.join(caseDir, "existing");
      const b1 = createInputBundle(s1, { tag: "v0.0.1-pilot", commit_sha: commitA });
      const p1 = path.join(s1, "plan-1");
      const a1 = path.join(s1, "apply-1");
      const stateDir = path.join(s1, "state");
      await runCliPlan({ event: b1.eventPath, contract: b1.projectContractPath, result: b1.resultPath, evidenceRoot: b1.inputDir, out: p1 });
      await runCliApply({ plan: path.join(p1, "plan.json"), apiBase, stateDir, out: a1 });

      // Repoint tag to Commit B
      const s1Repoint = path.join(s1, "repoint");
      const b1Repoint = createInputBundle(s1Repoint, { tag: "v0.0.1-pilot", commit_sha: commitB });
      const p2 = path.join(s1, "plan-2");
      const a2 = path.join(s1, "apply-2");
      await runCliPlan({ event: b1Repoint.eventPath, contract: b1Repoint.projectContractPath, result: b1Repoint.resultPath, evidenceRoot: b1Repoint.inputDir, out: p2 });
      const r2 = await runCliApply({ plan: path.join(p2, "plan.json"), apiBase, stateDir, out: a2 });

      // Retry should not append duplicate notice
      const a3 = path.join(s1, "apply-3");
      const r3 = await runCliApply({ plan: path.join(p2, "plan.json"), apiBase, stateDir, out: a3 });

      // 2. Release target repointing
      const s2 = path.join(caseDir, "release");
      const b2 = createInputBundle(s2, {
        tag: "v0.0.2-pilot",
        commit_sha: commitA,
        routing: { mode: "release", changelog: "initial release" },
      });
      const pRel1 = path.join(s2, "plan-1");
      const aRel1 = path.join(s2, "apply-1");
      const stateRel = path.join(s2, "state");
      await runCliPlan({ event: b2.eventPath, contract: b2.projectContractPath, result: b2.resultPath, evidenceRoot: b2.inputDir, out: pRel1 });
      await runCliApply({ plan: path.join(pRel1, "plan.json"), apiBase, stateDir: stateRel, out: aRel1 });

      const b2Repoint = createInputBundle(path.join(s2, "repoint"), {
        tag: "v0.0.2-pilot",
        commit_sha: commitB,
        routing: { mode: "release", changelog: "repoint release" },
      });
      const pRel2 = path.join(s2, "plan-2");
      const aRel2 = path.join(s2, "apply-2");
      await runCliPlan({ event: b2Repoint.eventPath, contract: b2Repoint.projectContractPath, result: b2Repoint.resultPath, evidenceRoot: b2Repoint.inputDir, out: pRel2 });
      const rRel2 = await runCliApply({ plan: path.join(pRel2, "plan.json"), apiBase, stateDir: stateRel, out: aRel2 });
      const aRel3 = path.join(s2, "apply-3");
      const rRel3 = await runCliApply({ plan: path.join(pRel2, "plan.json"), apiBase, stateDir: stateRel, out: aRel3 });
      const dRel2 = JSON.parse(fs.readFileSync(path.join(aRel2, "delivery.json"), "utf8"));
      const dRel3 = JSON.parse(fs.readFileSync(path.join(aRel3, "delivery.json"), "utf8"));
      const release = [...mockServer.releases.values()].find(r => r.tag_name === "v0.0.2-pilot");
      const releasePreserved = release?.target_commitish === commitA && parseMarker(release?.body)?.commit_sha === commitA;
      const releaseNoticeOnce = (release?.body.match(/repoint-notification:/g) || []).length === 1;

      const d2 = fs.existsSync(path.join(a2, "delivery.json")) ? JSON.parse(fs.readFileSync(path.join(a2, "delivery.json"), "utf8")) : null;

      const pass =
        r2.exitCode === 3 &&
        d2?.status === "REVIEW_REQUIRED" &&
        r3.exitCode === 3 &&
        rRel2.exitCode === 3 && rRel3.exitCode === 3 &&
        dRel2.status === "REVIEW_REQUIRED" && dRel3.status === "REVIEW_REQUIRED" &&
        releasePreserved && releaseNoticeOnce;

      caseResults.push({
        id: "RT11",
        status: pass ? "PASS" : "FAIL",
        actual: { r2Exit: r2.exitCode, r2Status: d2?.status, r3Exit: r3.exitCode, rRel2Exit: rRel2.exitCode, releaseStatus: dRel2.status, releaseRepeatStatus: dRel3.status, releasePreserved, releaseNoticeOnce },
        expected: { r2Exit: 3, r2Status: "REVIEW_REQUIRED", r3Exit: 3, rRel2Exit: 3, releaseStatus: "REVIEW_REQUIRED", releaseRepeatStatus: "REVIEW_REQUIRED", releasePreserved: true, releaseNoticeOnce: true },
        artifacts: [path.join("RT11", "existing", "apply-2", "delivery.json")],
      });
    }

    // -------------------------------------------------------------
    // RT12: Ignored events and deletion tombstone
    // -------------------------------------------------------------
    if (!targetCase || targetCase === "RT12") {
      mockServer.reset();
      const caseDir = path.join(targetOutDir, "RT12");
      const ignoredEvents = [
        { id: "pr-merge", event_type: "pull_request" },
        { id: "release-publish", event_type: "release" },
        { id: "branch-push", event_type: "push", ref: "refs/heads/main" },
        { id: "invalid-tag", tag: "not-a-valid-tag" },
        { id: "tag-deleted", deleted: true },
      ];

      let allIgnored = true;
      const stateDir = path.join(caseDir, "state");

      for (const item of ignoredEvents) {
        const itemDir = path.join(caseDir, item.id);
        const b = createInputBundle(itemDir, item);
        const p = path.join(itemDir, "plan");
        const a = path.join(itemDir, "apply");
        const planRes = await runCliPlan({ event: b.eventPath, contract: b.projectContractPath, result: b.resultPath, evidenceRoot: b.inputDir, out: p });
        const applyRes = await runCliApply({ plan: path.join(p, "plan.json"), apiBase, stateDir, out: a });

        if (planRes.exitCode !== 0 || applyRes.exitCode !== 0) {
          allIgnored = false;
        }
      }

      const tombstoneFile = path.join(stateDir, "tombstones", "fixture_release-tracking_v0.0.1-pilot.json");
      const tombstoneExists = fs.existsSync(tombstoneFile);

      const pass = allIgnored && tombstoneExists;

      caseResults.push({
        id: "RT12",
        status: pass ? "PASS" : "FAIL",
        actual: { allIgnored, tombstoneExists },
        expected: { allIgnored: true, tombstoneExists: true },
        artifacts: [path.join("RT12", "tag-deleted", "apply", "delivery.json")],
      });
    }

    // -------------------------------------------------------------
    // RT13: Anti-tampering and ledger corruption
    // -------------------------------------------------------------
    if (!targetCase || targetCase === "RT13") {
      const caseDir = path.join(targetOutDir, "RT13");

      // 1. Tamper evidence after plan
      mockServer.reset();
      const s1 = path.join(caseDir, "tamper-evidence");
      const b1 = createInputBundle(s1);
      const p1 = path.join(s1, "plan");
      const a1 = path.join(s1, "apply");
      await runCliPlan({ event: b1.eventPath, contract: b1.projectContractPath, result: b1.resultPath, evidenceRoot: b1.inputDir, out: p1 });
      fs.writeFileSync(b1.resultPath, '{"tampered": true}\n', "utf8");
      const r1 = await runCliApply({ plan: path.join(p1, "plan.json"), apiBase, stateDir: path.join(s1, "state"), out: a1 });

      // 2. Change target for same event_key
      mockServer.reset();
      const s2 = path.join(caseDir, "tamper-target");
      const b2 = createInputBundle(s2);
      const p2 = path.join(s2, "plan-1");
      const a2 = path.join(s2, "apply-1");
      const state2 = path.join(s2, "state");
      await runCliPlan({ event: b2.eventPath, contract: b2.projectContractPath, result: b2.resultPath, evidenceRoot: b2.inputDir, out: p2 });
      await runCliApply({ plan: path.join(p2, "plan.json"), apiBase, stateDir: state2, out: a2 });

      // Second plan with changed target
      const s2Changed = path.join(s2, "changed-target");
      const b2Changed = createInputBundle(s2Changed, {
        routing: { mode: "existing", target: { kind: "pr", repo: "fixture/release-tracking", number: 102 } },
      });
      const p2Changed = path.join(s2, "plan-2");
      const a2Changed = path.join(s2, "apply-2");
      await runCliPlan({ event: b2Changed.eventPath, contract: b2Changed.projectContractPath, result: b2Changed.resultPath, evidenceRoot: b2Changed.inputDir, out: p2Changed });
      const r2 = await runCliApply({ plan: path.join(p2Changed, "plan.json"), apiBase, stateDir: state2, out: a2Changed });

      // 3. Corrupt ledger file
      mockServer.reset();
      const s3 = path.join(caseDir, "corrupt-ledger");
      const b3 = createInputBundle(s3);
      const p3 = path.join(s3, "plan");
      const a3 = path.join(s3, "apply");
      const state3 = path.join(s3, "state");
      fs.mkdirSync(state3, { recursive: true });
      fs.writeFileSync(path.join(state3, "ledger.json"), "{ NOT_VALID_JSON ...", "utf8");
      await runCliPlan({ event: b3.eventPath, contract: b3.projectContractPath, result: b3.resultPath, evidenceRoot: b3.inputDir, out: p3 });
      const r3 = await runCliApply({ plan: path.join(p3, "plan.json"), apiBase, stateDir: state3, out: a3 });

      const pass = r1.exitCode === 2 && r2.exitCode === 3 && r3.exitCode === 3;

      caseResults.push({
        id: "RT13",
        status: pass ? "PASS" : "FAIL",
        actual: { r1Exit: r1.exitCode, r2Exit: r2.exitCode, r3Exit: r3.exitCode },
        expected: { r1Exit: 2, r2Exit: 3, r3Exit: 3 },
        artifacts: [path.join("RT13", "tamper-evidence")],
      });
    }

    // -------------------------------------------------------------
    // RT14: Side-effect-free plan and network isolation
    // -------------------------------------------------------------
    if (!targetCase || targetCase === "RT14") {
      mockServer.reset();
      const caseDir = path.join(targetOutDir, "RT14");

      // 1. Plan makes 0 API calls
      const s1 = path.join(caseDir, "plan-noop");
      const b1 = createInputBundle(s1);
      const p1 = path.join(s1, "plan");
      const requestsBefore = mockServer.requests.length;
      const r1 = await runCliPlan({ event: b1.eventPath, contract: b1.projectContractPath, result: b1.resultPath, evidenceRoot: b1.inputDir, out: p1 });
      const requestsAfter = mockServer.requests.length;
      const zeroApiCalls = requestsAfter === requestsBefore;

      // 2. Unknown routing mode
      const s2 = path.join(caseDir, "unknown-routing");
      const b2 = createInputBundle(s2, { routing: { mode: "fly-to-moon" } });
      const r2 = await runCliPlan({ event: b2.eventPath, contract: b2.projectContractPath, result: b2.resultPath, evidenceRoot: b2.inputDir, out: path.join(s2, "plan") });

      // 3. Cross repo target
      const s3 = path.join(caseDir, "cross-repo");
      const b3 = createInputBundle(s3, {
        routing: { mode: "existing", target: { kind: "issue", repo: "other-org/other-repo", number: 101 } },
      });
      const r3 = await runCliPlan({ event: b3.eventPath, contract: b3.projectContractPath, result: b3.resultPath, evidenceRoot: b3.inputDir, out: path.join(s3, "plan") });

      // 4. Empty destination
      const s4 = path.join(caseDir, "empty-dest");
      const b4 = createInputBundle(s4, { routing: { mode: "existing" } });
      const requestsBefore4 = mockServer.requests.length;
      const r4 = await runCliPlan({ event: b4.eventPath, contract: b4.projectContractPath, result: b4.resultPath, evidenceRoot: b4.inputDir, out: path.join(s4, "plan") });
      const requestsAfter4 = mockServer.requests.length;
      const s4NoApi = requestsAfter4 === requestsBefore4;
      const s4NoPlanWritten = !fs.existsSync(path.join(s4, "plan", "plan.json"));

      // 5. Non-loopback URL rejected
      const s5 = path.join(caseDir, "non-loopback");
      const b5 = createInputBundle(s5);
      const p5 = path.join(s5, "plan");
      const a5 = path.join(s5, "apply");
      await runCliPlan({ event: b5.eventPath, contract: b5.projectContractPath, result: b5.resultPath, evidenceRoot: b5.inputDir, out: p5 });
      const r5 = await runCliApply({
        plan: path.join(p5, "plan.json"),
        apiBase: "https://api.github.com",
        stateDir: path.join(s5, "state"),
        out: a5,
      });

      const pass =
        r1.exitCode === 0 && zeroApiCalls &&
        r2.exitCode === 2 &&
        r3.exitCode === 2 &&
        r4.exitCode === 3 && r4.stderr.includes("BLOCKED") && s4NoApi && s4NoPlanWritten &&
        r5.exitCode === 2;

      caseResults.push({
        id: "RT14",
        status: pass ? "PASS" : "FAIL",
        actual: { zeroApiCalls, r2: r2.exitCode, r3: r3.exitCode, r4: r4.exitCode, r4Blocked: r4.stderr.includes("BLOCKED"), s4NoApi, s4NoPlanWritten, r5: r5.exitCode },
        expected: { zeroApiCalls: true, r2: 2, r3: 2, r4: 3, r4Blocked: true, s4NoApi: true, s4NoPlanWritten: true, r5: 2 },
        artifacts: [path.join("RT14", "plan-noop", "plan", "plan.json")],
      });
    }

    // -------------------------------------------------------------
    // RT15: Runner credibility & Mutation Verification
    // -------------------------------------------------------------
    if (!targetCase || targetCase === "RT15") {
      mockServer.reset();
      const caseDir = path.join(targetOutDir, "RT15");
      fs.mkdirSync(caseDir, { recursive: true });

      // 1. Verify unknown case fails
      let unknownCaseFails = false;
      try {
        execFileSync("node", [__filename, "--out", path.join(caseDir, "dummy-out"), "--case", "RT99"], { stdio: "pipe" });
      } catch (e) {
        unknownCaseFails = e.status !== 0;
      }

      // 2. Verify existing out directory fails
      let existingOutFails = false;
      try {
        execFileSync("node", [__filename, "--out", targetOutDir], { stdio: "pipe" });
      } catch (e) {
        existingOutFails = e.status !== 0;
      }

      // 3. Mutation test: RT01 remote content assertion verification
      // Disposable scripts copy with mutated renderer
      const dispDir = path.join(caseDir, "disposable-scripts");
      fs.mkdirSync(path.join(dispDir, "lib"), { recursive: true });
      fs.copyFileSync(
        path.join(ROOT, "scripts", "release-tracking.mjs"),
        path.join(dispDir, "release-tracking.mjs")
      );
      const originalLib = fs.readFileSync(path.join(ROOT, "scripts", "lib", "release-tracking.mjs"), "utf8");
      // Mutate renderMessage: inject erroneous 40-character SHA into rendered message body
      const mutatedLib = originalLib.replace(
        "export function renderMessage({ event, result, projectContract, eventKey }) {",
        "export function renderMessage({ event, result, projectContract, eventKey }) {\n  const mutationOriginalCommit = event.commit_sha;\n  event = { ...event, commit_sha: \"0000000000000000000000000000000000000000\" };"
      ).replace("const marker = formatMarker(eventKey, event.repo, event.tag, event.commit_sha);", "const marker = formatMarker(eventKey, event.repo, event.tag, mutationOriginalCommit);");
      if (mutatedLib === originalLib) {
        throw new Error("Failed to mutate renderer in disposable copy");
      }
      fs.writeFileSync(path.join(dispDir, "lib", "release-tracking.mjs"), mutatedLib, "utf8");

      const mutatedRt01Out = path.join(caseDir, "mutated-rt01-out");
      let childExitCode = 0;
      try {
        execFileSync("node", [__filename, "--out", mutatedRt01Out, "--case", "RT01"], {
          env: {
            ...process.env,
            RELEASE_TRACKING_CLI_PATH: path.join(dispDir, "release-tracking.mjs"),
          },
          stdio: "pipe",
        });
      } catch (e) {
        childExitCode = e.status ?? (e.exitCode ?? 1);
      }

      let childResults = null;
      let rt01Result = null;
      let applyDelivered = false;
      let remoteCommentHasWrongSha = false;
      let rt01FailedSpecificallyOnSha = false;

      if (fs.existsSync(path.join(mutatedRt01Out, "results.json"))) {
        childResults = JSON.parse(fs.readFileSync(path.join(mutatedRt01Out, "results.json"), "utf8"));
        rt01Result = childResults.results?.find((r) => r.id === "RT01");
      }

      if (fs.existsSync(path.join(mutatedRt01Out, "RT01", "apply", "delivery.json"))) {
        const deliv = JSON.parse(fs.readFileSync(path.join(mutatedRt01Out, "RT01", "apply", "delivery.json"), "utf8"));
        applyDelivered = deliv.status === "DELIVERED";
      }

      if (fs.existsSync(path.join(mutatedRt01Out, "RT01", "plan", "message.md"))) {
        const msg = fs.readFileSync(path.join(mutatedRt01Out, "RT01", "plan", "message.md"), "utf8");
        remoteCommentHasWrongSha = msg.includes("0000000000000000000000000000000000000000");
      }

      if (rt01Result && rt01Result.status === "FAIL" && rt01Result.actual?.exitCode === 0 && rt01Result.actual?.commentsCount === 1 && rt01Result.actual?.bodyHasCommitA === false) {
        rt01FailedSpecificallyOnSha = true;
      }

      const mutationPassed =
        childExitCode === 1 &&
        applyDelivered &&
        remoteCommentHasWrongSha &&
        rt01FailedSpecificallyOnSha;

      const pass = unknownCaseFails && existingOutFails && mutationPassed;

      caseResults.push({
        id: "RT15",
        status: pass ? "PASS" : "FAIL",
        actual: {
          unknownCaseFails,
          existingOutFails,
          childExitCode,
          applyDelivered,
          remoteCommentHasWrongSha,
          rt01FailedSpecificallyOnSha,
        },
        expected: {
          unknownCaseFails: true,
          existingOutFails: true,
          childExitCode: 1,
          applyDelivered: true,
          remoteCommentHasWrongSha: true,
          rt01FailedSpecificallyOnSha: true,
        },
        artifacts: [
          path.join("RT15", "mutated-rt01-out", "results.json"),
          path.join("RT15", "mutated-rt01-out", "RT01", "apply", "delivery.json"),
        ],
      });
    }

  } finally {
    await mockServer.stop();
  }

  // 4. Output Summary and Environment Reports
  const environment = {
    os: process.platform,
    arch: process.arch,
    node: process.version,
    git: execFileSync("git", ["--version"], { encoding: "utf8" }).trim(),
    locale: process.env.LANG || "en_US.UTF-8",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    cwd: ROOT,
    cli_command: `node scripts/verify-release-tracking.mjs --out ${targetOutDir}`,
  };
  fs.writeFileSync(path.join(targetOutDir, "environment.json"), JSON.stringify(environment, null, 2), "utf8");

  const sourceManifest = {
    harness_git_commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    contract_sha256: contractSha256,
    project_contract_template_sha256: computeSha256(fs.readFileSync(projectContractTemplatePath)),
    files: {
      contract: "system-workflow/fixtures/release-tracking/contract.json",
      cases: "system-workflow/fixtures/release-tracking/cases.json",
      project_contract_template: "system-workflow/fixtures/release-tracking/project-contract.template.json",
      cli: "scripts/release-tracking.mjs",
      lib: "scripts/lib/release-tracking.mjs",
      verifier: "scripts/verify-release-tracking.mjs",
    },
    fixture_commits: {
      commit_a: commitA,
      commit_b: commitB,
    },
  };
  fs.writeFileSync(path.join(targetOutDir, "source-manifest.json"), JSON.stringify(sourceManifest, null, 2), "utf8");

  const passCount = caseResults.filter((c) => c.status === "PASS").length;
  const failCount = caseResults.filter((c) => c.status === "FAIL").length;
  const overallStatus = failCount === 0 && caseResults.length > 0 ? "PASS" : "FAIL";

  const resultsJson = {
    contract_version: "1.3",
    contract_sha256: contractSha256,
    overall_status: overallStatus,
    total_cases: caseResults.length,
    passed_cases: passCount,
    failed_cases: failCount,
    results: caseResults,
  };
  fs.writeFileSync(path.join(targetOutDir, "results.json"), JSON.stringify(resultsJson, null, 2), "utf8");

  let summaryMd = `# Release Tracking Acceptance Verification Summary\n\n`;
  summaryMd += `- **Contract Version**: v1.3\n`;
  summaryMd += `- **Contract SHA-256**: \`${contractSha256}\`\n`;
  summaryMd += `- **Overall Status**: **${overallStatus}** (${passCount}/${caseResults.length} PASS)\n`;
  summaryMd += `- **Executed At**: ${new Date().toISOString()}\n\n`;
  summaryMd += `| Case ID | Status | Actual vs Expected | Artifact |\n`;
  summaryMd += `|---|---|---|---|\n`;
  for (const c of caseResults) {
    summaryMd += `| ${c.id} | ${c.status} | \`${JSON.stringify(c.actual)}\` | \`${(c.artifacts || []).join(", ")}\` |\n`;
  }
  fs.writeFileSync(path.join(targetOutDir, "summary.md"), summaryMd, "utf8");

  // Generate artifacts.sha256
  const artifacts = [];
  function collectFiles(dir, relPrefix = "") {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(".git")) continue;
      const full = path.join(dir, f);
      const rel = path.join(relPrefix, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        collectFiles(full, rel);
      } else {
        const hash = computeSha256(fs.readFileSync(full));
        artifacts.push(`${hash}  ${rel}`);
      }
    }
  }
  collectFiles(targetOutDir);
  fs.writeFileSync(path.join(targetOutDir, "artifacts.sha256"), artifacts.join("\n") + "\n", "utf8");

  console.log(`\n======================================================`);
  console.log(`Verification Complete: ${passCount}/${caseResults.length} PASS. Status: ${overallStatus}`);
  console.log(`Results saved to: ${targetOutDir}`);
  console.log(`======================================================\n`);

  if (overallStatus !== "PASS") {
    process.exit(1);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.out) {
    console.log(`
Usage:
  node scripts/verify-release-tracking.mjs --out <output-directory> [--case <case-id>]

Examples:
  node scripts/verify-release-tracking.mjs --out .runtime/release-tracking/full-01
  node scripts/verify-release-tracking.mjs --case RT09 --out .runtime/release-tracking/recheck-01
`);
    process.exit(options.help ? 0 : 2);
  }

  await runAllTests(path.resolve(options.out), options.case || null);
}

main().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});

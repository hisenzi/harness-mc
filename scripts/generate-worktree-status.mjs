import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = path.resolve(root, "..");
const outPath = path.join(root, "public", "data", "worktrees.json");

export function generateWorktreeStatus(options = {}) {
  const scanRoot = options.scanRoot || collabRoot;
  const repos = discoverGitRepos(scanRoot).map(readRepoStatus).filter(Boolean);
  const summary = summarize(repos);
  const data = {
    version: 1,
    generated_at: new Date().toISOString(),
    scan_root_label: "$COLLAB",
    summary,
    repositories: repos,
  };

  if (options.write !== false) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
    console.log(`Generated ${outPath} — ${summary.scanned} repos, ${summary.uncommitted} uncommitted, ${summary.local_commits} unpushed, ${summary.needs_reconcile} reconcile`);
  }

  return data;
}

function discoverGitRepos(scanRoot) {
  return fs
    .readdirSync(scanRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(scanRoot, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, ".git")))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function readRepoStatus(repoPath) {
  const branchOutput = git(repoPath, ["status", "--porcelain=v1", "-b"]);
  if (branchOutput.status !== 0) return null;

  const lines = branchOutput.stdout.split("\n").filter(Boolean);
  const branchInfo = parseBranchLine(lines[0] || "");
  const files = lines.slice(1).map(parseStatusLine);
  const head = git(repoPath, ["rev-parse", "--short", "HEAD"]).stdout.trim() || null;
  const remote = branchInfo.upstream || null;

  const stagedCount = files.filter((file) => file.indexStatus !== " " && file.indexStatus !== "?").length;
  const unstagedCount = files.filter((file) => file.worktreeStatus !== " " && file.worktreeStatus !== "?").length;
  const untrackedCount = files.filter((file) => file.indexStatus === "?" && file.worktreeStatus === "?").length;
  const dirtyCount = stagedCount + unstagedCount + untrackedCount;

  const ahead = branchInfo.ahead;
  const behind = branchInfo.behind;
  const isDetached = branchInfo.branch === "HEAD" || branchInfo.branch.startsWith("(no branch");
  const status = getPrimaryStatus({ dirtyCount, ahead, behind, isDetached });
  const risk = getRisk(status, dirtyCount);

  return {
    repo: path.basename(repoPath),
    path_label: toCollabLabel(repoPath),
    branch: branchInfo.branch,
    upstream: remote,
    head,
    is_detached: isDetached,
    staged_count: stagedCount,
    unstaged_count: unstagedCount,
    untracked_count: untrackedCount,
    local_commits_count: ahead,
    remote_commits_count: behind,
    status,
    risk,
    suggested_action: suggestedAction({ status, dirtyCount, ahead, behind, isDetached }),
    files: files.slice(0, 20),
  };
}

function parseBranchLine(line) {
  const raw = line.replace(/^##\s*/, "");
  const [branchPart, metaPart = ""] = raw.split("...");
  const metaMatch = metaPart.match(/\[(.+)\]/);
  const meta = metaMatch?.[1] || "";
  const aheadMatch = meta.match(/ahead\s+(\d+)/);
  const behindMatch = meta.match(/behind\s+(\d+)/);

  return {
    branch: (branchPart || "unknown").trim(),
    upstream: metaPart.replace(/\s*\[.+\]\s*$/, "").trim() || null,
    ahead: aheadMatch ? Number(aheadMatch[1]) : 0,
    behind: behindMatch ? Number(behindMatch[1]) : 0,
  };
}

function parseStatusLine(line) {
  return {
    indexStatus: line[0] || " ",
    worktreeStatus: line[1] || " ",
    path: line.slice(3),
  };
}

function getPrimaryStatus({ dirtyCount, ahead, behind, isDetached }) {
  if (behind > 0 || isDetached) return "needs_reconcile";
  if (dirtyCount > 0) return "uncommitted";
  if (ahead > 0) return "local_commits";
  return "clean";
}

function getRisk(status, dirtyCount) {
  if (status === "needs_reconcile") return "high";
  if (status === "uncommitted" && dirtyCount >= 10) return "high";
  if (status === "uncommitted" || status === "local_commits") return "medium";
  return "low";
}

function suggestedAction({ status, dirtyCount, ahead, behind, isDetached }) {
  if (isDetached) return "確認 detached HEAD 是否為預期；必要時切回分支再收尾。";
  if (behind > 0 && ahead > 0) return "本機與遠端分歧；先 git pull --rebase 對帳，解決衝突後再推。";
  if (behind > 0) return "遠端有新提交；先 git pull --rebase 更新本機。";
  if (dirtyCount > 0) return "逐檔讀 diff，分批 stage 本 session 檔案；不要使用 broad git add。";
  if (ahead > 0) return "確認 commit 範圍後 push；若是 shared repo，推後通知其他 session pull。";
  return "無需動作。";
}

function summarize(repos) {
  return {
    scanned: repos.length,
    uncommitted: repos.filter((repo) => repo.staged_count + repo.unstaged_count + repo.untracked_count > 0).length,
    local_commits: repos.filter((repo) => repo.local_commits_count > 0).length,
    needs_reconcile: repos.filter((repo) => repo.status === "needs_reconcile").length,
    clean: repos.filter((repo) => repo.status === "clean").length,
  };
}

function toCollabLabel(repoPath) {
  return `$COLLAB/${path.relative(collabRoot, repoPath) || "."}`;
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) generateWorktreeStatus();

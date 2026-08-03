import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { generateWorktreeStatus } from "./generate-worktree-status.mjs";
import { discoverMilestoneProjects } from "./lib/milestone-projects.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const collabRoot = path.resolve(root, "..");
const outPath = path.join(root, "public", "data", "commit-attention.json");
const notifyScript = path.join(collabRoot, "notyet-harness", "schedule", "lib", "notify.sh");

export function generateCommitAttention(options = {}) {
  const worktrees = options.worktrees || generateWorktreeStatus({ write: false, scanRoot: options.scanRoot });
  const taskIndex = readTaskIndex(options.root || root);
  const repositories = worktrees.repositories
    .filter((repo) => repo.status !== "clean")
    .map((repo) => enrichRepo(repo, taskIndex));

  const summary = summarize(repositories);
  const data = {
    version: 1,
    generated_at: new Date().toISOString(),
    read_only: true,
    source: {
      worktree_status: "$COLLAB/harness-mc/public/data/worktrees.json",
      task_source: "$COLLAB/harness-mc/milestones/*/tasks.json",
      generator: "$COLLAB/harness-mc/scripts/generate-commit-attention.mjs",
    },
    write_boundary: {
      allowed: ["read git porcelain status", "read MC task metadata", "write generated read model", "optional notification"],
      forbidden: ["read git diff contents", "stage files", "commit", "push", "close task", "read secrets"],
      commit_gate: "Actual commits must use worktree-commit with Vincent confirmation.",
    },
    stale_rule: "Regenerate after file edits, commits, checkouts, pushes, task-event changes, or agent handoff.",
    summary,
    notification: buildNotification(summary, repositories),
    repositories,
  };

  if (options.write !== false) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
    console.log(
      `Generated ${outPath} — ${summary.repositories_need_attention} repos need attention, ${summary.repositories_missing_task_anchor} missing task anchors`,
    );
  }

  if (options.notify) {
    data.delivery = sendNotification(data.notification.message);
  }

  return data;
}

function readTaskIndex(repoRoot) {
  const projects = new Map();
  for (const descriptor of discoverMilestoneProjects({ repoRoot })) {
    const data = readJson(descriptor.tasksPath);
    const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
    projects.set(descriptor.projectId, {
      project: descriptor.projectId,
      milestone_ref: descriptor.relativeDir,
      task_source: `$COLLAB/harness-mc/${descriptor.relativeDir}/tasks.json`,
      active_tasks: tasks
        .filter((task) => ["todo", "in_progress", "blocked"].includes(task.status))
        .map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          track: task.track || null,
        })),
    });
  }

  return projects;
}

function enrichRepo(repo, taskIndex) {
  const candidateProjects = inferProjects(repo, taskIndex);
  const task_links = candidateProjects.map((project) => linkProject(project, taskIndex.get(project)));
  const hasTaskAnchor = task_links.some((link) => link.state === "active_task_available");
  const needsCommitGate = repo.status === "uncommitted" || repo.status === "local_commits" || repo.status === "needs_reconcile";

  return {
    ...repo,
    files: repo.files.slice(0, 10),
    candidate_projects: candidateProjects,
    task_links,
    commit_attention: {
      state: hasTaskAnchor ? "task_anchor_available" : "missing_or_unclear_task_anchor",
      needs_commit_gate: needsCommitGate,
      next_action: nextAction(repo, hasTaskAnchor),
    },
  };
}

function inferProjects(repo, taskIndex) {
  const candidates = new Set();
  if (taskIndex.has(repo.repo)) candidates.add(repo.repo);

  for (const file of repo.files || []) {
    for (const [project, taskMeta] of taskIndex.entries()) {
      if (repo.repo === "harness-mc" && file.path.startsWith(`${taskMeta.milestone_ref}/`)) {
        candidates.add(project);
      }
      if (file.path.toLowerCase().includes(project.toLowerCase())) {
        candidates.add(project);
      }
    }
  }

  if (repo.repo === "notyet-harness" && taskIndex.has("morrowise")) {
    const touchesMorrowise = (repo.files || []).some((file) => file.path.includes("morrowise") || file.path.startsWith("schedule/"));
    if (touchesMorrowise) candidates.add("morrowise");
  }

  return [...candidates].sort();
}

function linkProject(project, taskSource) {
  if (!taskSource) {
    return {
      project,
      state: "missing_task_source",
      task_source: null,
      active_tasks: [],
    };
  }

  return {
    project,
    state: taskSource.active_tasks.length > 0 ? "active_task_available" : "no_active_task",
    task_source: taskSource.task_source,
    active_tasks: taskSource.active_tasks,
  };
}

function nextAction(repo, hasTaskAnchor) {
  if (!hasTaskAnchor) {
    return "先建立或指定 MC task anchor，再用 worktree-commit 規劃 commit scope。";
  }
  if (repo.status === "needs_reconcile") return "先處理分歧或 detached 狀態，再進 worktree-commit。";
  if (repo.status === "local_commits") return "確認本機 commit 對應 task 後，由 Vincent 決定是否 push。";
  return "逐檔讀 diff，按 task 分組，進 worktree-commit confirmation gate。";
}

function summarize(repositories) {
  return {
    repositories_need_attention: repositories.length,
    repositories_uncommitted: repositories.filter((repo) => repo.status === "uncommitted").length,
    repositories_local_commits: repositories.filter((repo) => repo.status === "local_commits").length,
    repositories_need_reconcile: repositories.filter((repo) => repo.status === "needs_reconcile").length,
    repositories_missing_task_anchor: repositories.filter((repo) => repo.commit_attention.state !== "task_anchor_available").length,
    total_dirty_files_sampled: repositories.reduce((sum, repo) => sum + repo.files.length, 0),
  };
}

function buildNotification(summary, repositories) {
  const topRepos = repositories.slice(0, 5).map((repo) => {
    const projects = repo.task_links.map((link) => `${link.project}:${link.state}`).join(", ") || "no-task-link";
    return `- ${repo.repo}: ${repo.status}, ${projects}`;
  });
  const message = [
    "MorroWise commit attention",
    `${summary.repositories_need_attention} repos need attention; ${summary.repositories_missing_task_anchor} missing/unclear task anchors.`,
    ...topRepos,
    "Next: use worktree-commit; do not broad git add.",
  ].join("\n");

  return {
    channel: "configured_delivery_adapter",
    message,
  };
}

function sendNotification(message) {
  if (!fs.existsSync(notifyScript)) {
    return { state: "skipped", reason: "notify.sh missing" };
  }

  const result = spawnSync("bash", [notifyScript, message], { encoding: "utf8" });
  return {
    state: result.status === 0 ? "sent" : "degraded",
    exit_code: result.status,
    stderr: result.stderr.trim(),
  };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  generateCommitAttention({
    notify: process.argv.includes("--notify"),
  });
}

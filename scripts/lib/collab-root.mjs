import { execFileSync } from "node:child_process";
import path from "node:path";

export function resolveCollabRoot(repoRoot, environment = process.env) {
  if (environment.COLLAB_DIR) return path.resolve(environment.COLLAB_DIR);

  const commonGitDir = execFileSync(
    "git",
    ["-C", repoRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim();

  return path.resolve(commonGitDir, "..", "..");
}

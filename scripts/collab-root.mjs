import fs from "node:fs";
import path from "node:path";

export function resolveCollabRoot(start) {
  let candidate = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(candidate, "harness-mc")) && fs.existsSync(path.join(candidate, "notyet-harness"))) return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Unable to resolve $COLLAB from ${start}`);
}

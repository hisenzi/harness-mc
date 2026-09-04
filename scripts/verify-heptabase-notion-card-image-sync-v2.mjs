import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const collab = path.resolve(scriptsDir, "..", "..");
const adapter = path.join(
  collab,
  "notyet-harness",
  "000_Agent",
  "scripts",
  "heptabase-notion-card-image-sync.py",
);

function noteWithImage(fileId, text) {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text }] },
      { type: "image", attrs: { fileId } },
    ],
  };
}

function fixture({ root, uploadIdentity = "notion-fixture-a", includeImage = true }) {
  const imageId = "fixture-image-a";
  const imageDir = path.join(root, "hepta-files", "workspace-b");
  fs.mkdirSync(imageDir, { recursive: true });
  const image = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  if (includeImage) fs.writeFileSync(path.join(imageDir, imageId), image);

  return {
    schema_version: "heptabase-notion-card-image-sync.fixture.v1",
    target: {
      id: "fixture-kj",
      whiteboard: { id: "fixture-whiteboard", name: "Fixture Board" },
      notion: {
        database_id: "fixture-database",
        title_property: "項目",
        integration_identity: "notion-fixture-a",
        upload_identity: uploadIdentity,
      },
    },
    cards: [
      {
        cardId: "card-b",
        title: "Second card",
        lastEditedTime: "2026-09-02T00:01:00.000Z",
        content: noteWithImage(imageId, "second"),
      },
      {
        cardId: "card-a",
        title: "First card",
        lastEditedTime: "2026-09-02T00:00:00.000Z",
        content: noteWithImage(imageId, "first"),
      },
    ],
    existing: [
      { card_id: "card-a", page_id: "page-a", content_md5: "obsolete", image_hashes: [] },
    ],
    file_roots: [path.join(root, "hepta-files")],
  };
}

function runFixture(inputPath) {
  return JSON.parse(execFileSync("python3", [adapter, "--fixture", inputPath], { encoding: "utf8" }));
}

function writeFakeHeptabase(root, source) {
  const metadata = source.cards.map(({ content, ...card }) => card);
  const notes = Object.fromEntries(source.cards.map((card) => [card.cardId, { content: JSON.stringify(card.content) }]));
  const commandPath = path.join(root, "fake-heptabase.py");
  fs.writeFileSync(
    commandPath,
    `#!/usr/bin/env python3
import json, os, sys
payload = ${JSON.stringify({ metadata, notes })}
with open(os.environ["FAKE_HEPTABASE_TRACE"], "a", encoding="utf-8") as trace:
    trace.write(" ".join(sys.argv[1:]) + "\\n")
if sys.argv[1:3] == ["whiteboard", "cards"]:
    print(json.dumps({"whiteboardName": "Fixture Board", "cards": payload["metadata"]}))
elif sys.argv[1:3] == ["note", "read"]:
    print(json.dumps(payload["notes"][sys.argv[3]]))
else:
    raise SystemExit(9)
`,
  );
  fs.chmodSync(commandPath, 0o755);
  return commandPath;
}

function runCliDryRun(mappingPath, commandPath, tracePath, extraArgs = []) {
  return JSON.parse(execFileSync("python3", [adapter, "--dry-run", "--mapping", mappingPath, "--heptabase-bin", commandPath, ...extraArgs], {
    encoding: "utf8",
    env: { ...process.env, FAKE_HEPTABASE_TRACE: tracePath },
  }));
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jv50-fixture-"));
try {
  const happyPath = path.join(tmp, "happy.json");
  fs.writeFileSync(happyPath, JSON.stringify(fixture({ root: tmp })));
  const happy = runFixture(happyPath);

  assert.equal(happy.status, "dry_run");
  assert.deepEqual(happy.mutations.map((entry) => entry.card_id), ["card-a", "card-b"]);
  assert.deepEqual(happy.mutations.map((entry) => entry.action), ["update", "create"]);
  assert.equal(happy.mutations[0].page_id, "page-a");
  for (const entry of happy.mutations) {
    assert.equal(entry.images.length, 1);
    assert.equal(entry.images[0].mime_type, "image/png");
    assert.equal(entry.images[0].sha256.length, 64);
    assert.equal(entry.images[0].source, "local-original");
  }
  assert.equal(happy.blocked.length, 0);
  assert.doesNotMatch(JSON.stringify(happy), /access_token|refresh_token|client_secret|NOTION_TOKEN/i);

  const mismatchPath = path.join(tmp, "identity-mismatch.json");
  fs.writeFileSync(mismatchPath, JSON.stringify(fixture({ root: tmp, uploadIdentity: "notion-fixture-b" })));
  const mismatch = spawnSync("python3", [adapter, "--fixture", mismatchPath], { encoding: "utf8" });
  assert.equal(mismatch.status, 2);
  assert.equal(JSON.parse(mismatch.stdout).blocked[0].code, "notion_identity_mismatch");

  const missingPath = path.join(tmp, "missing-image.json");
  fs.writeFileSync(missingPath, JSON.stringify(fixture({ root: path.join(tmp, "missing"), includeImage: false })));
  const missing = spawnSync("python3", [adapter, "--fixture", missingPath], { encoding: "utf8" });
  assert.equal(missing.status, 2);
  assert.equal(JSON.parse(missing.stdout).blocked[0].code, "missing_image_file");

  const oversizedRoot = path.join(tmp, "oversized");
  const oversizedFixture = fixture({ root: oversizedRoot });
  const oversizedImagePath = path.join(oversizedFixture.file_roots[0], "workspace-b", "fixture-image-a");
  const oversizedImage = Buffer.alloc(20 * 1024 * 1024 + 1);
  Buffer.from("89504e470d0a1a0a", "hex").copy(oversizedImage);
  fs.writeFileSync(oversizedImagePath, oversizedImage);
  const oversizedPath = path.join(tmp, "oversized-image.json");
  fs.writeFileSync(oversizedPath, JSON.stringify(oversizedFixture));
  const oversized = spawnSync("python3", [adapter, "--fixture", oversizedPath], { encoding: "utf8" });
  assert.equal(oversized.status, 2);
  assert.equal(JSON.parse(oversized.stdout).blocked[0].code, "image_too_large");

  const cliSource = fixture({ root: path.join(tmp, "cli") });
  const cliMappingPath = path.join(tmp, "cli-mapping.json");
  fs.writeFileSync(cliMappingPath, JSON.stringify({
    schema_version: "heptabase-notion-card-image-sync.mapping.v1",
    target: cliSource.target,
    state: cliSource.existing,
    file_roots: cliSource.file_roots,
  }));
  const tracePath = path.join(tmp, "cli.trace");
  const fakeHeptabase = writeFakeHeptabase(tmp, cliSource);
  const cliManifest = runCliDryRun(cliMappingPath, fakeHeptabase, tracePath);
  assert.deepEqual(cliManifest.mutations.map((entry) => entry.action), ["update", "create"]);
  assert.deepEqual(fs.readFileSync(tracePath, "utf8").trim().split("\n").sort(), [
    "note read card-a",
    "note read card-b",
    "whiteboard cards fixture-whiteboard",
  ]);

  const settledState = cliManifest.mutations.map((entry) => ({
    card_id: entry.card_id,
    page_id: entry.page_id || `page-${entry.card_id}`,
    content_md5: entry.content_md5,
    image_hashes: entry.images.map((image) => image.sha256),
  }));
  fs.writeFileSync(cliMappingPath, JSON.stringify({
    schema_version: "heptabase-notion-card-image-sync.mapping.v1",
    target: cliSource.target,
    state: settledState,
    file_roots: cliSource.file_roots,
  }));
  fs.writeFileSync(tracePath, "");
  const unchanged = runCliDryRun(cliMappingPath, fakeHeptabase, tracePath);
  assert.deepEqual(unchanged.mutations.map((entry) => entry.action), ["unchanged", "unchanged"]);

  const sourceOnlyPath = path.join(tmp, "source-only-mapping.json");
  fs.writeFileSync(sourceOnlyPath, JSON.stringify({
    schema_version: "heptabase-notion-card-image-sync.mapping.v1",
    target: { id: "source-only", whiteboard: cliSource.target.whiteboard },
    state: settledState,
    file_roots: cliSource.file_roots,
  }));
  const sourceOnly = runCliDryRun(sourceOnlyPath, fakeHeptabase, tracePath, ["--source-only"]);
  assert.deepEqual(sourceOnly.mutations.map((entry) => entry.action), ["unchanged", "unchanged"]);
  const noIdentity = spawnSync("python3", [adapter, "--dry-run", "--mapping", sourceOnlyPath, "--heptabase-bin", fakeHeptabase], {
    encoding: "utf8",
    env: { ...process.env, FAKE_HEPTABASE_TRACE: tracePath },
  });
  assert.equal(noIdentity.status, 2);
  assert.equal(JSON.parse(noIdentity.stdout).blocked[0].code, "notion_identity_mismatch");

  const targetsPath = path.join(tmp, "targets.json");
  fs.writeFileSync(targetsPath, JSON.stringify({
    schema_version: "heptabase-notion-card-image-sync.targets.v1",
    targets: [
      {
        id: "other-project",
        target: {
          id: "other-project",
          whiteboard: { id: "other-whiteboard", name: "Other Board" },
          notion: {
            database_id: "other-database",
            integration_identity: "notion-fixture-a",
            upload_identity: "notion-fixture-a",
          },
        },
        state: [],
        file_roots: cliSource.file_roots,
      },
      {
        id: "fixture-kj",
        target: cliSource.target,
        state: settledState,
        file_roots: cliSource.file_roots,
      },
    ],
  }));
  const selectedTarget = runCliDryRun(targetsPath, fakeHeptabase, tracePath, ["--target", "fixture-kj"]);
  assert.deepEqual(selectedTarget.mutations.map((entry) => entry.action), ["unchanged", "unchanged"]);
  const unknownTarget = spawnSync("python3", [adapter, "--dry-run", "--mapping", targetsPath, "--target", "unknown", "--heptabase-bin", fakeHeptabase], {
    encoding: "utf8",
    env: { ...process.env, FAKE_HEPTABASE_TRACE: tracePath },
  });
  assert.equal(unknownTarget.status, 2);
  assert.equal(JSON.parse(unknownTarget.stdout).blocked[0].code, "unknown_target");
  const implicitTarget = spawnSync("python3", [adapter, "--dry-run", "--mapping", targetsPath, "--heptabase-bin", fakeHeptabase], {
    encoding: "utf8",
    env: { ...process.env, FAKE_HEPTABASE_TRACE: tracePath },
  });
  assert.equal(implicitTarget.status, 2);
  assert.equal(JSON.parse(implicitTarget.stdout).blocked[0].code, "target_selection_required");

  const applyHarness = `
import importlib.util
import json

spec = importlib.util.spec_from_file_location("jv50", ${JSON.stringify(adapter)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
fixture = json.load(open(${JSON.stringify(happyPath)}, encoding="utf-8"))
manifest = mod.plan_fixture(fixture)

class FakeNotion:
    def __init__(self, identity="notion-fixture-a"):
        self.identity = identity
        self.calls = []
        self.bodies = {}
    def user_me(self):
        self.calls.append("identity")
        return {"name": self.identity}
    def upload_file(self, data, filename, mime_type):
        self.calls.append("upload")
        return "upload-" + filename
    def replace_page_body(self, page_id, blocks):
        self.calls.append("replace:" + page_id)
        self.bodies[page_id] = blocks
    def create_page(self, database_id, title_property, title, blocks):
        self.calls.append("create:" + title)
        page_id = "page-created-" + title
        self.bodies[page_id] = blocks
        return page_id
    def get_page(self, page_id):
        self.calls.append("get:" + page_id)
        return {"id": page_id}
    def list_children(self, page_id):
        return self.bodies.get(page_id, [])

client = FakeNotion()
result = mod.apply_manifest(manifest, fixture["target"], fixture["file_roots"], client)
assert result["verified_pages"] == 2
assert {entry["card_id"] for entry in result["state"]} == {"card-a", "card-b"}
assert "replace:page-a" in client.calls
assert any(call.startswith("create:Second card") for call in client.calls)
assert client.calls.count("upload") == 2
rendered_text = "\\n".join(
    part.get("text", {}).get("content", "")
    for blocks in client.bodies.values()
    for block in blocks
    if block.get("type") == "paragraph"
    for part in block.get("paragraph", {}).get("rich_text", [])
)
assert "fixture-image-a" not in rendered_text
bad_client = FakeNotion("notion-fixture-b")
try:
    mod.apply_manifest(manifest, fixture["target"], fixture["file_roots"], bad_client)
except mod.SyncBlocked as error:
    assert error.payload["code"] == "notion_identity_mismatch"
    assert bad_client.calls == ["identity"]
else:
    raise AssertionError("different integration identity was not blocked")
`;
  const applyResult = spawnSync("python3", ["-c", applyHarness], { encoding: "utf8" });
  assert.equal(applyResult.status, 0, applyResult.stderr || applyResult.stdout);

  const skill = fs.readFileSync(
    path.join(collab, "notyet-harness", "000_Agent", "skills", "heptabase-notion-sync", "SKILL.md"),
    "utf8",
  );
  assert.match(skill, /version:\s*"1\.3"/);
  assert.match(skill, /heptabase-notion-card-image-sync\.py --dry-run[\s\S]*--target <target-id>/);
  assert.match(skill, /heptabase-notion-card-image-sync\.py --apply --yes/);
  assert.match(skill, /protected_properties/);

  assert.equal(crypto.createHash("sha256").update("fixture").digest("hex").length, 64);
  console.log("JV-50 source/identity fixture verification OK");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

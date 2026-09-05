import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const initialPath = path.join(__dirname, "initial-card.json");
const initialData = JSON.parse(fs.readFileSync(initialPath, "utf-8"));
const initialDoc = JSON.parse(initialData.content);

const startSentinel = {
  type: "paragraph",
  content: [{ type: "text", text: "<!-- morrowise-manual-sync:start:v1 -->" }]
};

const endSentinel = {
  type: "paragraph",
  content: [{ type: "text", text: "<!-- morrowise-manual-sync:end:v1 -->" }]
};

const sampleManagedNodes = [
  {
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "Managed System Status" }]
  },
  {
    type: "paragraph",
    content: [{ type: "text", text: "Synced managed content block." }]
  }
];

const sampleUserNotes = [
  {
    type: "heading",
    attrs: { level: 2 },
    content: [{ type: "text", text: "手寫人類筆記" }]
  },
  {
    type: "paragraph",
    content: [
      { type: "text", text: "這是 Vincent 的自訂備忘錄，包含重要連結：" },
      { type: "text", text: "Obsidian 知識庫", marks: [{ type: "link", attrs: { href: "https://example.com/obsidian" } }] }
    ]
  }
];

function makeCard(id, title, doc) {
  const contentStr = typeof doc === "string" ? doc : JSON.stringify(doc);
  const md5 = crypto.createHash("md5").update(contentStr).digest("hex");
  return {
    id,
    title,
    content: contentStr,
    contentMd5: md5
  };
}

// 1. Initialized card with user notes
const initializedDoc = {
  type: "doc",
  content: [
    ...initialDoc.content,
    startSentinel,
    ...sampleManagedNodes,
    endSentinel,
    ...sampleUserNotes
  ]
};
fs.writeFileSync(
  path.join(__dirname, "initialized-card-with-user-notes.json"),
  JSON.stringify(makeCard(initialData.id, initialData.title, initializedDoc), null, 2),
  "utf-8"
);

// 2. Drifted card (managed nodes are stale)
const driftedDoc = {
  type: "doc",
  content: [
    ...initialDoc.content,
    startSentinel,
    {
      type: "paragraph",
      content: [{ type: "text", text: "Old stale managed content." }]
    },
    endSentinel,
    ...sampleUserNotes
  ]
};
fs.writeFileSync(
  path.join(__dirname, "drifted-card.json"),
  JSON.stringify(makeCard(initialData.id, initialData.title, driftedDoc), null, 2),
  "utf-8"
);

// 3. Invalid marker: missing start
const missingStartDoc = {
  type: "doc",
  content: [
    ...initialDoc.content,
    ...sampleManagedNodes,
    endSentinel,
    ...sampleUserNotes
  ]
};
fs.writeFileSync(
  path.join(__dirname, "invalid-marker-missing-start.json"),
  JSON.stringify(makeCard(initialData.id, initialData.title, missingStartDoc), null, 2),
  "utf-8"
);

// 4. Invalid marker: missing end
const missingEndDoc = {
  type: "doc",
  content: [
    ...initialDoc.content,
    startSentinel,
    ...sampleManagedNodes,
    ...sampleUserNotes
  ]
};
fs.writeFileSync(
  path.join(__dirname, "invalid-marker-missing-end.json"),
  JSON.stringify(makeCard(initialData.id, initialData.title, missingEndDoc), null, 2),
  "utf-8"
);

// 5. Invalid marker: duplicate
const duplicateMarkerDoc = {
  type: "doc",
  content: [
    ...initialDoc.content,
    startSentinel,
    ...sampleManagedNodes,
    startSentinel,
    endSentinel,
    ...sampleUserNotes
  ]
};
fs.writeFileSync(
  path.join(__dirname, "invalid-marker-duplicate.json"),
  JSON.stringify(makeCard(initialData.id, initialData.title, duplicateMarkerDoc), null, 2),
  "utf-8"
);

// 6. Invalid marker: reversed
const reversedMarkerDoc = {
  type: "doc",
  content: [
    ...initialDoc.content,
    endSentinel,
    ...sampleManagedNodes,
    startSentinel,
    ...sampleUserNotes
  ]
};
fs.writeFileSync(
  path.join(__dirname, "invalid-marker-reversed.json"),
  JSON.stringify(makeCard(initialData.id, initialData.title, reversedMarkerDoc), null, 2),
  "utf-8"
);

// 7. Invalid target ID
fs.writeFileSync(
  path.join(__dirname, "invalid-target-id.json"),
  JSON.stringify(makeCard("00000000-0000-0000-0000-000000000000", initialData.title, initializedDoc), null, 2),
  "utf-8"
);

// 8. Invalid target Title
fs.writeFileSync(
  path.join(__dirname, "invalid-target-title.json"),
  JSON.stringify(makeCard(initialData.id, "Wrong Title", initializedDoc), null, 2),
  "utf-8"
);

// 9. Invalid schema: non-doc
fs.writeFileSync(
  path.join(__dirname, "invalid-schema-non-doc.json"),
  JSON.stringify(makeCard(initialData.id, initialData.title, "{ \"not_a_doc\": true }"), null, 2),
  "utf-8"
);

console.log("Generated all test fixtures successfully.");

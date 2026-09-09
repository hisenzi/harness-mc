import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Synthetic UUIDs preserve the live-like tree shape without tracking live node identifiers or roadmap prose.
const sanitizedTableRows = [
  // Header row
  {
    type: "table_row",
    attrs: { id: "f0000000-0000-4000-8000-000000000001" },
    content: [
      {
        type: "table_header",
        attrs: { id: "f0000000-0000-4000-8000-000000000002", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000003" }, content: [{ type: "text", text: "順序" }] }]
      },
      {
        type: "table_header",
        attrs: { id: "f0000000-0000-4000-8000-000000000004", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000005" }, content: [{ type: "text", text: "Task" }] }]
      },
      {
        type: "table_header",
        attrs: { id: "f0000000-0000-4000-8000-000000000006", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000007" }, content: [{ type: "text", text: "要做的事" }] }]
      },
      {
        type: "table_header",
        attrs: { id: "f0000000-0000-4000-8000-000000000008", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000009" }, content: [{ type: "text", text: "產物／完成判準" }] }]
      }
    ]
  },
  // Row 1
  {
    type: "table_row",
    attrs: { id: "f0000000-0000-4000-8000-000000000010" },
    content: [
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000011", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000012" }, content: [{ type: "text", text: "1" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000013", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000014" }, content: [{ type: "text", marks: [{ type: "code" }], text: "[DEMO-01｜project/task-item-1]" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000015", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000016" }, content: [{ type: "text", text: "Sanitized task description 1" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000017", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000018" }, content: [{ type: "text", text: "Sanitized task criteria 1" }] }]
      }
    ]
  },
  // Row 2
  {
    type: "table_row",
    attrs: { id: "f0000000-0000-4000-8000-000000000019" },
    content: [
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000020", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000021" }, content: [{ type: "text", text: "2" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000022", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000023" }, content: [{ type: "text", marks: [{ type: "code" }], text: "[DEMO-02｜project/task-item-2]" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000024", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000025" }, content: [{ type: "text", text: "Sanitized task description 2" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000026", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000027" }, content: [{ type: "text", text: "Sanitized task criteria 2" }] }]
      }
    ]
  },
  // Row 3
  {
    type: "table_row",
    attrs: { id: "f0000000-0000-4000-8000-000000000028" },
    content: [
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000029", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000030" }, content: [{ type: "text", text: "3" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000031", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000032" }, content: [{ type: "text", marks: [{ type: "code" }], text: "[DEMO-03｜project/task-item-3]" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000033", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000034" }, content: [{ type: "text", text: "Sanitized task description 3" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000035", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000036" }, content: [{ type: "text", text: "Sanitized task criteria 3" }] }]
      }
    ]
  },
  // Row 4
  {
    type: "table_row",
    attrs: { id: "f0000000-0000-4000-8000-000000000037" },
    content: [
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000038", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000039" }, content: [{ type: "text", text: "4" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000040", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000041" }, content: [{ type: "text", marks: [{ type: "code" }], text: "[DEMO-04｜project/task-item-4]" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000042", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000043" }, content: [{ type: "text", text: "Sanitized task description 4" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000044", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000045" }, content: [{ type: "text", text: "Sanitized task criteria 4" }] }]
      }
    ]
  },
  // Row 5
  {
    type: "table_row",
    attrs: { id: "f0000000-0000-4000-8000-000000000046" },
    content: [
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000047", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000048" }, content: [{ type: "text", text: "5" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000049", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000050" }, content: [{ type: "text", marks: [{ type: "code" }], text: "[DEMO-05｜project/task-item-5]" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000051", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000052" }, content: [{ type: "text", text: "Sanitized task description 5" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000053", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000054" }, content: [{ type: "text", text: "Sanitized task criteria 5" }] }]
      }
    ]
  },
  // Row 6
  {
    type: "table_row",
    attrs: { id: "f0000000-0000-4000-8000-000000000055" },
    content: [
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000056", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000057" }, content: [{ type: "text", text: "6" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000058", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000059" }, content: [{ type: "text", marks: [{ type: "code" }], text: "[DEMO-06｜project/task-item-6]" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000060", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000061" }, content: [{ type: "text", text: "Sanitized task description 6" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000062", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000063" }, content: [{ type: "text", text: "Sanitized task criteria 6" }] }]
      }
    ]
  },
  // Row 7
  {
    type: "table_row",
    attrs: { id: "f0000000-0000-4000-8000-000000000064" },
    content: [
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000065", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000066" }, content: [{ type: "text", text: "7" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000067", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000068" }, content: [{ type: "text", marks: [{ type: "code" }], text: "[DEMO-07｜project/task-item-7]" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000069", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000070" }, content: [{ type: "text", text: "Sanitized task description 7" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000071", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000072" }, content: [{ type: "text", text: "Sanitized task criteria 7" }] }]
      }
    ]
  },
  // Row 8
  {
    type: "table_row",
    attrs: { id: "f0000000-0000-4000-8000-000000000073" },
    content: [
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000074", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000075" }, content: [{ type: "text", text: "8" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000076", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000077" }, content: [{ type: "text", marks: [{ type: "code" }], text: "[DEMO-08｜project/task-item-8]" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000078", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000079" }, content: [{ type: "text", text: "Sanitized task description 8" }] }]
      },
      {
        type: "table_cell",
        attrs: { id: "f0000000-0000-4000-8000-000000000080", colspan: 1, rowspan: 1, colwidth: null, backgroundColor: null, textColor: null },
        content: [{ type: "paragraph", attrs: { id: "f0000000-0000-4000-8000-000000000081" }, content: [{ type: "text", text: "Sanitized task criteria 8" }] }]
      }
    ]
  }
];

const sanitizedInitialDoc = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { id: "f0000000-0000-4000-8000-000000000082", level: 1 },
      content: [{ type: "text", text: "MorroWise 使用說明書" }]
    },
    {
      type: "paragraph",
      attrs: { id: "f0000000-0000-4000-8000-000000000083" },
      content: [{ type: "text", text: "Sanitized guidance paragraph for manual roadmap convergence testing." }]
    },
    {
      type: "table",
      attrs: { id: "f0000000-0000-4000-8000-000000000084", hasRowHeader: false, hasColumnHeader: false },
      content: sanitizedTableRows
    },
    {
      type: "paragraph",
      attrs: { id: "f0000000-0000-4000-8000-000000000085" },
      content: [{ type: "text", text: "Sanitized summary note regarding convergence sequence 1 to 4 and 5 to 8." }]
    }
  ]
};

const TARGET_CARD_ID = "76fcfdca-251c-412f-898c-24512e6ea144";
const TARGET_TITLE = "MorroWise 使用說明書";

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

const startSentinel = {
  type: "paragraph",
  attrs: { id: "11111111-1111-4111-8111-111111111111" },
  content: [{ type: "text", text: "<!-- morrowise-manual-sync:start:v1 -->" }]
};

const endSentinel = {
  type: "paragraph",
  attrs: { id: "22222222-2222-4222-8222-222222222222" },
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
    attrs: { id: "33333333-3333-4333-8333-333333333333", level: 2 },
    content: [{ type: "text", text: "手寫筆記範例" }]
  },
  {
    type: "paragraph",
    attrs: { id: "44444444-4444-4444-8444-444444444444" },
    content: [
      { type: "text", text: "這是自訂備忘錄範例，包含重要連結：" },
      { type: "text", text: "範例知識庫", marks: [{ type: "link", attrs: { href: "https://example.com/notes" } }] }
    ]
  }
];

// Write initial-card.json
fs.writeFileSync(
  path.join(__dirname, "initial-card.json"),
  JSON.stringify(makeCard(TARGET_CARD_ID, TARGET_TITLE, sanitizedInitialDoc), null, 2),
  "utf-8"
);

// 1. Initialized card with user notes
const initializedDoc = {
  type: "doc",
  content: [
    ...sanitizedInitialDoc.content,
    startSentinel,
    ...sampleManagedNodes,
    endSentinel,
    ...sampleUserNotes
  ]
};
fs.writeFileSync(
  path.join(__dirname, "initialized-card-with-user-notes.json"),
  JSON.stringify(makeCard(TARGET_CARD_ID, TARGET_TITLE, initializedDoc), null, 2),
  "utf-8"
);

// 2. Drifted card (managed nodes are stale)
const driftedDoc = {
  type: "doc",
  content: [
    ...sanitizedInitialDoc.content,
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
  JSON.stringify(makeCard(TARGET_CARD_ID, TARGET_TITLE, driftedDoc), null, 2),
  "utf-8"
);

// 3. Invalid marker: missing start
const missingStartDoc = {
  type: "doc",
  content: [
    ...sanitizedInitialDoc.content,
    ...sampleManagedNodes,
    endSentinel,
    ...sampleUserNotes
  ]
};
fs.writeFileSync(
  path.join(__dirname, "invalid-marker-missing-start.json"),
  JSON.stringify(makeCard(TARGET_CARD_ID, TARGET_TITLE, missingStartDoc), null, 2),
  "utf-8"
);

// 4. Invalid marker: missing end
const missingEndDoc = {
  type: "doc",
  content: [
    ...sanitizedInitialDoc.content,
    startSentinel,
    ...sampleManagedNodes,
    ...sampleUserNotes
  ]
};
fs.writeFileSync(
  path.join(__dirname, "invalid-marker-missing-end.json"),
  JSON.stringify(makeCard(TARGET_CARD_ID, TARGET_TITLE, missingEndDoc), null, 2),
  "utf-8"
);

// 5. Invalid marker: duplicate
const duplicateMarkerDoc = {
  type: "doc",
  content: [
    ...sanitizedInitialDoc.content,
    startSentinel,
    ...sampleManagedNodes,
    startSentinel,
    endSentinel,
    ...sampleUserNotes
  ]
};
fs.writeFileSync(
  path.join(__dirname, "invalid-marker-duplicate.json"),
  JSON.stringify(makeCard(TARGET_CARD_ID, TARGET_TITLE, duplicateMarkerDoc), null, 2),
  "utf-8"
);

// 6. Invalid marker: reversed
const reversedMarkerDoc = {
  type: "doc",
  content: [
    ...sanitizedInitialDoc.content,
    endSentinel,
    ...sampleManagedNodes,
    startSentinel,
    ...sampleUserNotes
  ]
};
fs.writeFileSync(
  path.join(__dirname, "invalid-marker-reversed.json"),
  JSON.stringify(makeCard(TARGET_CARD_ID, TARGET_TITLE, reversedMarkerDoc), null, 2),
  "utf-8"
);

// 7. Invalid marker attrs (non-UUID or custom styling attribute on sentinel)
const invalidMarkerAttrsDoc = {
  type: "doc",
  content: [
    ...sanitizedInitialDoc.content,
    {
      type: "paragraph",
      attrs: { id: "not-a-valid-uuid", customStyle: "forbidden" },
      content: [{ type: "text", text: "<!-- morrowise-manual-sync:start:v1 -->" }]
    },
    ...sampleManagedNodes,
    endSentinel,
    ...sampleUserNotes
  ]
};
fs.writeFileSync(
  path.join(__dirname, "invalid-marker-attrs.json"),
  JSON.stringify(makeCard(TARGET_CARD_ID, TARGET_TITLE, invalidMarkerAttrsDoc), null, 2),
  "utf-8"
);

// 8. Invalid marker: exact sentinel text nested below the top level
const nestedMarkerDoc = {
  type: "doc",
  content: [
    ...sanitizedInitialDoc.content,
    startSentinel,
    {
      type: "blockquote",
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "<!-- morrowise-manual-sync:start:v1 -->" }]
      }]
    },
    endSentinel,
    ...sampleUserNotes
  ]
};
fs.writeFileSync(
  path.join(__dirname, "invalid-marker-nested.json"),
  JSON.stringify(makeCard(TARGET_CARD_ID, TARGET_TITLE, nestedMarkerDoc), null, 2),
  "utf-8"
);

// 9. Invalid marker: sentinel text uses a marked text child
const malformedMarkerDoc = {
  type: "doc",
  content: [
    ...sanitizedInitialDoc.content,
    startSentinel,
    ...sampleManagedNodes,
    {
      type: "paragraph",
      content: [{
        type: "text",
        text: "<!-- morrowise-manual-sync:end:v1 -->",
        marks: [{ type: "code" }]
      }]
    },
    endSentinel,
    ...sampleUserNotes
  ]
};
fs.writeFileSync(
  path.join(__dirname, "invalid-marker-malformed.json"),
  JSON.stringify(makeCard(TARGET_CARD_ID, TARGET_TITLE, malformedMarkerDoc), null, 2),
  "utf-8"
);

// 10. Invalid target ID
fs.writeFileSync(
  path.join(__dirname, "invalid-target-id.json"),
  JSON.stringify(makeCard("00000000-0000-0000-0000-000000000000", TARGET_TITLE, initializedDoc), null, 2),
  "utf-8"
);

// 11. Invalid target Title
fs.writeFileSync(
  path.join(__dirname, "invalid-target-title.json"),
  JSON.stringify(makeCard(TARGET_CARD_ID, "Wrong Title", initializedDoc), null, 2),
  "utf-8"
);

// 12. Invalid schema: non-doc
fs.writeFileSync(
  path.join(__dirname, "invalid-schema-non-doc.json"),
  JSON.stringify(makeCard(TARGET_CARD_ID, TARGET_TITLE, "{ \"not_a_doc\": true }"), null, 2),
  "utf-8"
);

console.log("Generated all sanitized test fixtures successfully.");

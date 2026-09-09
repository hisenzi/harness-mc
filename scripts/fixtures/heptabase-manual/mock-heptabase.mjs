#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

function main() {
  const args = process.argv.slice(2);
  const ledgerPath = process.env.MOCK_CALL_LEDGER;
  if (ledgerPath) {
    fs.appendFileSync(ledgerPath, `${JSON.stringify({ args })}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
  }

  if (args.includes("--version")) {
    console.log(`heptabase ${process.env.MOCK_CLI_VERSION || "0.6.0"}`);
    process.exit(0);
  }

  const command = args[0];
  const subCommand = args[1];

  if (process.env.MOCK_CLI_MODE === "offline") {
    console.error("Error: connect ECONNREFUSED 127.0.0.1:2345 (Heptabase desktop app offline)");
    process.exit(1);
  }

  if (process.env.MOCK_CLI_MODE === "error_126") {
    console.error("heptabase: Operation not permitted");
    process.exit(126);
  }

  if (command === "note") {
    const mockFile = process.env.MOCK_CARD_FILE;
    if (!mockFile || !fs.existsSync(mockFile)) {
      console.error(`Error: mock file not found: ${mockFile}`);
      process.exit(1);
    }

    if (subCommand === "read") {
      const cardId = args[2];
      if (process.env.MOCK_CLI_MODE === "corrupt") {
        console.log("{ \"id\": \"corrupted");
        process.exit(0);
      }
      const cardData = JSON.parse(fs.readFileSync(mockFile, "utf-8"));
      const postReadMode = cardData.__mockPostReadMode;
      if (postReadMode) {
        delete cardData.__mockPostReadMode;
        const beforeMd5 = cardData.__mockBeforeMd5;
        delete cardData.__mockBeforeMd5;

        if (postReadMode === "identity_changed") {
          cardData.id = "00000000-0000-4000-8000-000000000000";
        } else if (postReadMode === "md5_missing") {
          delete cardData.contentMd5;
        } else if (postReadMode === "md5_unchanged") {
          cardData.contentMd5 = beforeMd5;
        } else if (postReadMode === "malformed_content") {
          cardData.content = "{ malformed";
          cardData.contentMd5 = crypto.createHash("md5").update(cardData.content).digest("hex");
        } else if (postReadMode === "marker_id_changed" || postReadMode === "outside_id_changed") {
          const doc = JSON.parse(cardData.content);
          if (postReadMode === "marker_id_changed") {
            const marker = doc.content.find((node) => node.type === "paragraph" && node.content?.[0]?.text === "<!-- morrowise-manual-sync:start:v1 -->");
            marker.attrs = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
          } else {
            doc.content[0].attrs.id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
          }
          cardData.content = JSON.stringify(doc);
          cardData.contentMd5 = crypto.createHash("md5").update(cardData.content).digest("hex");
        }
      }
      process.stdout.write(JSON.stringify(cardData, null, 2) + "\n", () => {
        process.exit(0);
      });
      return;
    }

    if (subCommand === "save") {
      const cardId = args[2];
      let contentMd5 = null;
      let contentFile = null;

      for (let i = 3; i < args.length; i++) {
        if (args[i] === "--content-md5") {
          contentMd5 = args[++i];
        } else if (args[i] === "--content-file") {
          contentFile = args[++i];
        }
      }

      if (!contentMd5 || !contentFile) {
        console.error("Usage error: --content-md5 and --content-file are required");
        process.exit(1);
      }

      if (process.env.MOCK_CLI_MODE === "generic_mismatch") {
        console.error("Error: response schema mismatch while saving note");
        process.exit(1);
      }

      const currentCard = JSON.parse(fs.readFileSync(mockFile, "utf-8"));
      if (currentCard.contentMd5 !== contentMd5) {
        console.error(`Error: Note content MD5 mismatch. Conflict detected. Stale content-md5: expected ${currentCard.contentMd5}, got ${contentMd5}`);
        process.exit(1);
      }

      const newContent = fs.readFileSync(contentFile, "utf-8");
      const newMd5 = crypto.createHash("md5").update(newContent).digest("hex");
      const timeoutMode = process.env.MOCK_CLI_MODE;
      if (["timeout", "timeout_expected", "timeout_before", "timeout_neither", "timeout_same_md5_changed_ast"].includes(timeoutMode)) {
        if (timeoutMode === "timeout_expected") {
          currentCard.content = newContent;
          currentCard.contentMd5 = newMd5;
          fs.writeFileSync(mockFile, JSON.stringify(currentCard, null, 2), "utf-8");
        } else if (timeoutMode === "timeout_neither" || timeoutMode === "timeout_same_md5_changed_ast") {
          currentCard.content = JSON.stringify({
            type: "doc",
            content: [{ type: "paragraph", content: [{ type: "text", text: "Indeterminate third state" }] }],
          });
          if (timeoutMode === "timeout_neither") {
            currentCard.contentMd5 = crypto.createHash("md5").update(currentCard.content).digest("hex");
          }
          fs.writeFileSync(mockFile, JSON.stringify(currentCard, null, 2), "utf-8");
        }
        console.error("Error: save timed out");
        process.exit(124);
      }

      currentCard.content = newContent;
      currentCard.contentMd5 = newMd5;
      if (process.env.MOCK_POST_READ_MODE) {
        currentCard.__mockPostReadMode = process.env.MOCK_POST_READ_MODE;
        currentCard.__mockBeforeMd5 = contentMd5;
      }

      fs.writeFileSync(mockFile, JSON.stringify(currentCard, null, 2), "utf-8");

      process.stdout.write(JSON.stringify({
        id: cardId,
        title: currentCard.title,
        contentMd5: newMd5
      }) + "\n", () => {
        process.exit(0);
      });
      return;
    }
  }

  console.error(`Unknown mock command: ${args.join(" ")}`);
  process.exit(1);
}

main();

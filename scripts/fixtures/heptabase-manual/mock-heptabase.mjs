#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--version")) {
    console.log("heptabase 0.6.0");
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

      if (process.env.MOCK_CLI_MODE === "timeout") {
        console.error("Error: save timed out");
        process.exit(124);
      }

      const currentCard = JSON.parse(fs.readFileSync(mockFile, "utf-8"));
      if (currentCard.contentMd5 !== contentMd5) {
        console.error(`Error: Note content MD5 mismatch. Conflict detected. Stale content-md5: expected ${currentCard.contentMd5}, got ${contentMd5}`);
        process.exit(1);
      }

      const newContent = fs.readFileSync(contentFile, "utf-8");
      const newMd5 = crypto.createHash("md5").update(newContent).digest("hex");

      currentCard.content = newContent;
      currentCard.contentMd5 = newMd5;

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

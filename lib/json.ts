import fs from "fs";

export function stripUtf8Bom(text: string): string {
  return text.replace(/^﻿/, "");
}

export function readJsonFileSync<T = any>(filePath: string): T {
  return JSON.parse(stripUtf8Bom(fs.readFileSync(filePath, "utf-8"))) as T;
}

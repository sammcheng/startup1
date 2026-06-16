import fs from "node:fs/promises";
import path from "node:path";

const ROOT = new URL("../.next", import.meta.url);
const TS_BUILD_INFO = new URL("../tsconfig.tsbuildinfo", import.meta.url);
const DUPLICATE_SUFFIX = / \d+\.(ts|json)$/;

async function walk(dirUrl) {
  let entries = [];
  try {
    entries = await fs.readdir(dirUrl, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dirUrl);
    if (entry.isDirectory()) {
      await walk(entryUrl);
      continue;
    }
    if (!DUPLICATE_SUFFIX.test(entry.name)) continue;
    await fs.rm(entryUrl, { force: true });
  }
}

await walk(ROOT);
await fs.rm(TS_BUILD_INFO, { force: true });

import fs from "node:fs/promises";

const ROOT = new URL("../.next/", import.meta.url);
const TYPES_ROOT = new URL("../.next/types/", import.meta.url);
const TS_BUILD_INFO = new URL("../tsconfig.tsbuildinfo", import.meta.url);
const DUPLICATE_SUFFIX = / \d+(?:\.[^.]+)?$/;

async function removeDuplicateEntries(dirUrl) {
  let entries = [];
  try {
    entries = await fs.readdir(dirUrl, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dirUrl);
    if (!DUPLICATE_SUFFIX.test(entry.name)) continue;
    await fs.rm(entryUrl, { force: true, recursive: entry.isDirectory() });
  }
}

await removeDuplicateEntries(ROOT);
await removeDuplicateEntries(TYPES_ROOT);
await fs.rm(TS_BUILD_INFO, { force: true });

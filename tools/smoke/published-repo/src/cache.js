import { readFile, writeFile } from "node:fs/promises";
export async function load(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return {}; }
}
export async function save(path, data) { await writeFile(path, JSON.stringify(data)); }

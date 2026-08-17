import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const MAX_MESSAGES = 60;

export function emptyLocalState() {
  return { threadId: null, messages: [] };
}

function normalizeLocalState(value) {
  return {
    threadId: typeof value?.threadId === "string" ? value.threadId : null,
    messages: Array.isArray(value?.messages) ? value.messages.slice(-MAX_MESSAGES) : [],
  };
}

export async function loadLocalState(statePath) {
  try {
    return normalizeLocalState(JSON.parse(await readFile(statePath, "utf8")));
  } catch {
    return emptyLocalState();
  }
}

export async function saveLocalState(statePath, value) {
  await mkdir(dirname(statePath), { recursive: true });
  const normalized = normalizeLocalState(value);
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  await rename(temporaryPath, statePath);
}

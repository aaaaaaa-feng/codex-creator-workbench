import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  emptyLocalState,
  loadLocalState,
  saveLocalState,
} from "../bridge/local-state.mjs";

test("returns an empty local state when no saved file exists", async () => {
  const missingPath = join(tmpdir(), `missing-creator-state-${process.pid}.json`);
  assert.deepEqual(await loadLocalState(missingPath), emptyLocalState());
});

test("persists the Codex thread and recent conversation across fresh loads", async (context) => {
  const stateDirectory = await mkdtemp(join(tmpdir(), "creator-state-"));
  context.after(() => rm(stateDirectory, { recursive: true, force: true }));
  const statePath = join(stateDirectory, "state.json");
  const messages = Array.from({ length: 65 }, (_, index) => ({
    id: `message-${index + 1}`,
    role: index % 2 ? "assistant" : "user",
    text: `内容 ${index + 1}`,
    createdAt: new Date(2026, 7, 18, 9, index).toISOString(),
  }));

  await saveLocalState(statePath, { threadId: "thread-local-1", messages });
  const restored = await loadLocalState(statePath);

  assert.equal(restored.threadId, "thread-local-1");
  assert.equal(restored.messages.length, 60);
  assert.equal(restored.messages[0].id, "message-6");
  assert.equal(restored.messages.at(-1).id, "message-65");
  assert.deepEqual(await readdir(stateDirectory), ["state.json"]);
});

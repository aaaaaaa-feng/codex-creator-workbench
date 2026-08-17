import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadLatestInspirationBrief, parseInspirationBrief } from "../bridge/inspirations.mjs";

test("parses one-line inspiration records from a Markdown brief", () => {
  const brief = `# 今日简报

## 5 条重点资讯

### 1. 第一条热点
- 发生了什么：第一条摘要。
- 为什么重要：第一条价值。
- [AIHOT](https://aihot.example/items/1)
- [原文](https://example.com/1)

### 2. 第二条热点
- 发生了什么：第二条摘要。
- 为什么重要：第二条价值。
- [AIHOT](https://aihot.example/items/2)
`;
  const result = parseInspirationBrief(brief, { relativePath: "00_收件箱/test.md" });
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.items[0], {
    id: "00_收件箱/test.md::1",
    rank: 1,
    title: "第一条热点",
    summary: "第一条摘要。",
    whyItMatters: "第一条价值。",
    aihotUrl: "https://aihot.example/items/1",
    sourceUrl: "https://example.com/1",
    sourceLabel: "原文",
    verification: "已有原文",
  });
  assert.equal(result.items[1].verification, "待核验");
});

test("loads a five-item AIHOT brief from a clean workspace", async (context) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "creator-workbench-"));
  context.after(() => rm(workspaceRoot, { recursive: true, force: true }));
  const inbox = join(workspaceRoot, "00_收件箱");
  await mkdir(inbox, { recursive: true });
  const items = Array.from({ length: 5 }, (_, index) => `### ${index + 1}. 热点 ${index + 1}
- 发生了什么：摘要 ${index + 1}。
- 为什么重要：价值 ${index + 1}。
- [AIHOT](https://aihot.example/items/${index + 1})
- [原文](https://example.com/${index + 1})`).join("\n\n");
  await writeFile(
    join(inbox, "2026-08-18-0900-AIHOT简报.md"),
    `# AIHOT 热点简报\n\n## 5 条重点资讯\n\n${items}\n`,
    "utf8",
  );

  const result = await loadLatestInspirationBrief(workspaceRoot);
  assert.equal(result.items.length, 5);
  assert.equal(result.items[0].title, "热点 1");
  assert.match(result.items[0].aihotUrl, /^https:\/\/aihot\.example\/items\//);
});

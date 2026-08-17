import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
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

test("loads the newest real AIHOT brief from the content workspace", async () => {
  const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));
  const result = await loadLatestInspirationBrief(workspaceRoot);
  const content = await readFile(new URL("../../00_收件箱/2026-08-17-AIHOT简报.md", import.meta.url), "utf8");
  if (content.includes("## 5 条重点资讯")) {
    assert.equal(result.items.length, 5);
    assert.match(result.items[0].aihotUrl, /^https:\/\/aihot\.virxact\.com\/items\//);
  }
});

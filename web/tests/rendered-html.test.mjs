import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the AI self-media workbench", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>[^<]*AI 自媒体工作台<\/title>/i);
  assert.match(html, /AI 自媒体工作台/);
  assert.match(html, /采集今日热点/);
  assert.match(html, /勾选后生成科普稿/);
  assert.match(html, /生成 6 张封面/);
  assert.match(html, /今日灵感池/);
  assert.match(html, /打包生成科普稿/);
  assert.match(html, /Codex 内容搭档/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("keeps the local Codex bridge and removes starter artifacts", async () => {
  const [page, layout, workbench, packageJson, bridge, starter] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../bridge/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/start-workbench.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<Workbench \/>/);
  assert.match(layout, /lang="zh-CN"/);
  assert.match(workbench, /http:\/\/127\.0\.0\.1:4317/);
  assert.match(workbench, /artifact-template-creator/);
  assert.match(packageJson, /@openai\/codex-sdk/);
  assert.match(packageJson, /"workbench": "node scripts\/start-workbench\.mjs"/);
  assert.match(bridge, /sandboxMode: "workspace-write"/);
  assert.match(bridge, /approvalPolicy: "never"/);
  assert.match(bridge, /AIHOT MCP/);
  assert.match(starter, /const url = "http:\/\/localhost:3000\/"/);
  assert.match(starter, /\["-a", "Google Chrome", url\]/);
  await assert.rejects(access(new URL("../app/_sites-preview", import.meta.url)));
  await access(new URL("../scripts/start-workbench.mjs", import.meta.url));
  assert.doesNotMatch(page + layout + workbench, /codex-preview|SkeletonPreview/);
});

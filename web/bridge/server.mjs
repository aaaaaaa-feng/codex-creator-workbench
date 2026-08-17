import { Codex } from "@openai/codex-sdk";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { loadLatestInspirationBrief } from "./inspirations.mjs";

const BRIDGE_DIR = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(BRIDGE_DIR, "..");
const WORKSPACE_ROOT = process.env.WORKBENCH_CONTENT_ROOT
  ? resolve(process.env.WORKBENCH_CONTENT_ROOT)
  : resolve(WEB_ROOT, "..");
const STATE_DIR = join(WEB_ROOT, ".workbench");
const STATE_PATH = join(STATE_DIR, "state.json");
const STATE_TEMP_PATH = join(STATE_DIR, "state.tmp.json");
const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.WORKBENCH_PORT || "4317", 10);
const ALLOWED_ORIGINS = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
const CONTENT_ROOTS = new Set([
  "00_收件箱",
  "01_待选题",
  "02_制作中",
  "03_已发布",
  "04_复盘",
]);
const TEXT_EXTENSIONS = new Set([".md", ".txt", ".csv"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const CREATOR_NAME = process.env.CREATOR_NAME || process.env.NEXT_PUBLIC_CREATOR_NAME || "创作者";
const COVER_SKILL_NAME = process.env.COVER_SKILL_NAME || "artifact-template-creator";

const codexHome = process.env.CODEX_HOME || join(homedir(), ".codex");
const codex = new Codex();
let activeThread = null;
let turnInProgress = false;

await mkdir(STATE_DIR, { recursive: true });
let state = await loadState();

function emptyState() {
  return { threadId: null, messages: [] };
}

async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_PATH, "utf8"));
    return {
      threadId: typeof parsed.threadId === "string" ? parsed.threadId : null,
      messages: Array.isArray(parsed.messages) ? parsed.messages.slice(-60) : [],
    };
  } catch {
    return emptyState();
  }
}

async function saveState() {
  const payload = JSON.stringify(
    { threadId: state.threadId, messages: state.messages.slice(-60) },
    null,
    2,
  );
  await writeFile(STATE_TEMP_PATH, payload, "utf8");
  await rename(STATE_TEMP_PATH, STATE_PATH);
}

function isAllowedOrigin(request) {
  const origin = request.headers.origin;
  return !origin || ALLOWED_ORIGINS.has(origin);
}

function corsHeaders(request) {
  const origin = request.headers.origin;
  return {
    "Access-Control-Allow-Origin":
      origin && ALLOWED_ORIGINS.has(origin) ? origin : "http://localhost:3000",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
}

function sendJson(request, response, statusCode, payload) {
  response.writeHead(statusCode, {
    ...corsHeaders(request),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function sendEvent(response, payload) {
  if (!response.destroyed && !response.writableEnded) {
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("请求内容超过 1MB");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function assertContentPath(relativePath) {
  if (
    typeof relativePath !== "string" ||
    !relativePath ||
    relativePath.includes("\0") ||
    isAbsolute(relativePath)
  ) {
    throw new Error("无效文件路径");
  }
  const normalized = relativePath.replaceAll("\\", "/");
  const firstSegment = normalized.split("/")[0];
  if (!CONTENT_ROOTS.has(firstSegment) && normalized !== "选题看板.md") {
    throw new Error("只允许读取内容工作区文件");
  }
  const absolutePath = resolve(WORKSPACE_ROOT, normalized);
  const backtrack = relative(WORKSPACE_ROOT, absolutePath);
  if (backtrack.startsWith(`..${sep}`) || backtrack === "..") {
    throw new Error("文件路径超出工作区");
  }
  return { absolutePath, normalized };
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectAiHot() {
  try {
    const config = await readFile(join(codexHome, "config.toml"), "utf8");
    return /(?:mcp_servers\.|\[mcp_servers\.)aihot\b/i.test(config) ||
      /\baihot\b/i.test(config);
  } catch {
    return false;
  }
}

async function healthPayload() {
  const coverSkill = join(codexHome, "skills", COVER_SKILL_NAME, "SKILL.md");
  return {
    ok: true,
    codexSdk: true,
    aihot: await detectAiHot(),
    coverSkill: await pathExists(coverSkill),
    coverSkillName: COVER_SKILL_NAME,
    creatorName: CREATOR_NAME,
    workspace: basename(WORKSPACE_ROOT),
  };
}

function classifyFile(relativePath) {
  const lower = relativePath.toLowerCase();
  const extension = extname(lower);
  if (IMAGE_EXTENSIONS.has(extension)) return "cover";
  if (extension === ".csv") return "data";
  if (lower.includes("aihot") || lower.includes("简报")) return "brief";
  if (lower.includes("选题卡")) return "idea";
  if (lower.includes("口播") || lower.includes("脚本")) return "script";
  if (lower.includes("复盘") || lower.startsWith("04_复盘/")) return "review";
  if (lower.startsWith("01_待选题/")) return "idea";
  if (lower.startsWith("02_制作中/")) return "script";
  return "note";
}

function extractTitle(content, relativePath) {
  const heading = content
    .split(/\r?\n/)
    .find((line) => /^#\s+\S/.test(line));
  if (heading) return heading.replace(/^#\s+/, "").trim();
  return basename(relativePath, extname(relativePath));
}

function extractPreview(content) {
  return content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

async function walkDirectory(rootName, directoryPath, depth = 0) {
  if (depth > 6) return [];
  const output = [];
  let entries = [];
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch {
    return output;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "说明.md") continue;
    const absolutePath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      output.push(...(await walkDirectory(rootName, absolutePath, depth + 1)));
      continue;
    }
    const extension = extname(entry.name).toLowerCase();
    if (!TEXT_EXTENSIONS.has(extension) && !IMAGE_EXTENSIONS.has(extension)) continue;

    const fileStat = await stat(absolutePath);
    const relativePath = relative(WORKSPACE_ROOT, absolutePath).split(sep).join("/");
    let content = "";
    if (TEXT_EXTENSIONS.has(extension)) {
      content = (await readFile(absolutePath, "utf8")).slice(0, 12_000);
    }
    output.push({
      name: entry.name,
      title: content ? extractTitle(content, relativePath) : basename(entry.name, extension),
      relativePath,
      stage: rootName,
      type: classifyFile(relativePath),
      updatedAt: fileStat.mtime.toISOString(),
      preview: content ? extractPreview(content) : "已归档封面",
    });
  }
  return output;
}

async function listLibrary() {
  const groups = await Promise.all(
    [...CONTENT_ROOTS].map((rootName) =>
      walkDirectory(rootName, join(WORKSPACE_ROOT, rootName)),
    ),
  );
  return groups
    .flat()
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 240);
}

function getThread() {
  if (activeThread) return activeThread;
  const options = {
    workingDirectory: WORKSPACE_ROOT,
    skipGitRepoCheck: true,
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: true,
    webSearchMode: "live",
    modelReasoningEffort: "medium",
  };
  activeThread = state.threadId
    ? codex.resumeThread(state.threadId, options)
    : codex.startThread(options);
  return activeThread;
}

function buildPrompt(message, selectedPath) {
  const selectedContext = selectedPath
    ? `\n用户在页面中选中了本地内容文件：${selectedPath}。仅在与本次任务相关时读取它。`
    : "";
  return `你正在通过本地“AI 自媒体工作台”接收${CREATOR_NAME}的指令。

必须先遵守当前工作目录根部的 AGENTS.md。内容任务的产出写入既定的 00_收件箱、01_待选题、02_制作中、03_已发布或 04_复盘；不要修改 web/ 目录，除非用户明确要求改工作台本身。

需要实时热点时必须实际调用已配置的 AIHOT MCP，并保留 AIHOT 链接；关键事实按项目规则核验。需要生成封面时必须显式使用 $${COVER_SKILL_NAME}，严格生成三个 3:4 竖版和三个 16:9 横版，并保存到对应主题的“封面/”目录。不要把计划、待核验结果或生成中状态说成已经完成。
${selectedContext}

用户指令：${message}`;
}

function activityForItem(item, completed = false) {
  if (item.type === "mcp_tool_call") {
    const name = `${item.server || "MCP"}/${item.tool || "工具"}`;
    return completed ? `${name} 已返回结果` : `正在调用 ${name}`;
  }
  if (item.type === "web_search") return "正在核对最新资料";
  if (item.type === "command_execution") return "正在执行本地检查";
  if (item.type === "file_change") return "正在保存内容文件";
  if (item.type === "todo_list") return "正在安排内容流程";
  return null;
}

async function handleChat(request, response) {
  if (turnInProgress) {
    sendJson(request, response, 409, { error: "已有任务正在执行，请完成后再发送。" });
    return;
  }

  const body = await readJsonBody(request);
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    sendJson(request, response, 400, { error: "请输入指令。" });
    return;
  }
  if (message.length > 20_000) {
    sendJson(request, response, 400, { error: "单次指令不能超过 20000 字。" });
    return;
  }

  let selectedPath = null;
  if (typeof body.selectedPath === "string" && body.selectedPath) {
    try {
      selectedPath = assertContentPath(body.selectedPath).normalized;
    } catch {
      selectedPath = null;
    }
  }

  response.writeHead(200, {
    ...corsHeaders(request),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });
  response.flushHeaders?.();
  sendEvent(response, { type: "activity", message: "Codex 已收到任务" });

  turnInProgress = true;
  let assistantText = "";
  try {
    const thread = getThread();
    const { events } = await thread.runStreamed(buildPrompt(message, selectedPath));
    for await (const event of events) {
      if (event.type === "thread.started") {
        state.threadId = event.thread_id;
        await saveState();
        sendEvent(response, { type: "thread", threadId: event.thread_id });
      }
      if (event.type === "item.started" || event.type === "item.updated") {
        const activity = activityForItem(event.item);
        if (activity) sendEvent(response, { type: "activity", message: activity });
      }
      if (event.type === "item.completed") {
        const activity = activityForItem(event.item, true);
        if (activity) sendEvent(response, { type: "activity", message: activity });
        if (event.item.type === "agent_message") {
          assistantText = event.item.text;
          sendEvent(response, { type: "assistant", text: assistantText });
        }
        if (event.item.type === "file_change") {
          sendEvent(response, { type: "files", changes: event.item.changes });
        }
      }
      if (event.type === "turn.failed") {
        throw new Error(event.error.message || "Codex 任务失败");
      }
      if (event.type === "error") {
        throw new Error(event.message || "Codex 连接中断");
      }
      if (event.type === "turn.completed") {
        sendEvent(response, { type: "done", usage: event.usage });
      }
    }

    state.messages.push(
      {
        id: `user-${Date.now()}`,
        role: "user",
        text: message,
        createdAt: new Date().toISOString(),
      },
      {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        text: assistantText || "任务已完成，请在内容库查看结果。",
        createdAt: new Date().toISOString(),
      },
    );
    await saveState();
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Codex 任务失败";
    sendEvent(response, { type: "error", message: messageText });
    if (/thread|resume|session/i.test(messageText)) {
      activeThread = null;
      state.threadId = null;
      await saveState();
    }
  } finally {
    turnInProgress = false;
    if (!response.writableEnded) response.end();
  }
}

function assetContentType(extension) {
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}

const server = createServer(async (request, response) => {
  try {
    if (!isAllowedOrigin(request)) {
      sendJson(request, response, 403, { error: "只允许本机工作台访问。" });
      return;
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, corsHeaders(request));
      response.end();
      return;
    }

    const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
    if (request.method === "GET" && url.pathname === "/api/health") {
      sendJson(request, response, 200, await healthPayload());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/library") {
      sendJson(request, response, 200, { items: await listLibrary() });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/inspirations") {
      sendJson(request, response, 200, await loadLatestInspirationBrief(WORKSPACE_ROOT));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/history") {
      sendJson(request, response, 200, { messages: state.messages.slice(-60) });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/file") {
      const { absolutePath } = assertContentPath(url.searchParams.get("path") || "");
      if (!TEXT_EXTENSIONS.has(extname(absolutePath).toLowerCase())) {
        sendJson(request, response, 415, { error: "该文件请使用图片预览。" });
        return;
      }
      sendJson(request, response, 200, {
        content: (await readFile(absolutePath, "utf8")).slice(0, 200_000),
      });
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/asset") {
      const { absolutePath } = assertContentPath(url.searchParams.get("path") || "");
      const extension = extname(absolutePath).toLowerCase();
      if (!IMAGE_EXTENSIONS.has(extension)) {
        sendJson(request, response, 415, { error: "不支持的图片格式。" });
        return;
      }
      response.writeHead(200, {
        ...corsHeaders(request),
        "Content-Type": assetContentType(extension),
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
      });
      createReadStream(absolutePath).pipe(response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/thread/reset") {
      if (turnInProgress) {
        sendJson(request, response, 409, { error: "任务执行中，暂时不能开启新对话。" });
        return;
      }
      activeThread = null;
      state = emptyState();
      await saveState();
      sendJson(request, response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      await handleChat(request, response);
      return;
    }
    sendJson(request, response, 404, { error: "未找到接口。" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "本地服务发生错误";
    if (!response.headersSent) sendJson(request, response, 500, { error: message });
    else if (!response.writableEnded) response.end();
  }
});

server.maxConnections = 20;
server.requestTimeout = 0;
server.listen(PORT, HOST, () => {
  console.log(`AI 自媒体工作台桥接服务：http://${HOST}:${PORT}`);
  console.log(`内容目录：${WORKSPACE_ROOT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

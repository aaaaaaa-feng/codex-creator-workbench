import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const children = [];

function start(label, script) {
  const child = spawn("npm", ["run", script], {
    cwd: webRoot,
    env: process.env,
    stdio: "inherit",
  });
  child.on("exit", (code, signal) => {
    if (code && code !== 0) {
      console.error(`${label} 已退出（${signal || code}）`);
      stopAll(code);
    }
  });
  children.push(child);
  return child;
}

function stopAll(exitCode = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 120).unref();
}

async function openWhenReady() {
  if (process.env.WORKBENCH_OPEN !== "1") return;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch("http://127.0.0.1:3000/");
      if (response.ok) {
        const url = "http://localhost:3000/";
        const [command, args] =
          process.platform === "darwin"
            ? ["open", ["-a", "Google Chrome", url]]
            : process.platform === "win32"
              ? ["cmd", ["/c", "start", "", url]]
              : ["xdg-open", [url]];
        const opener = spawn(command, args, { detached: true, stdio: "ignore" });
        opener.unref();
        return;
      }
    } catch {
      // The page is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  console.error("页面启动超时，请在 Chrome 中打开 http://localhost:3000/");
}

console.log("正在启动 Codex AI 自媒体工作台……");
console.log("页面：http://localhost:3000/");
console.log("按 Control + C 可以停止。\n");

start("Codex 桥接服务", "bridge");
start("工作台页面", "dev");
void openWhenReady();

process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));

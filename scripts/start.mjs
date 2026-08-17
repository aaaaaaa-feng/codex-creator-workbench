import { spawn } from "node:child_process";
import { prepareWorkspace } from "./setup.mjs";

const { webRoot } = await prepareWorkspace();
const child = spawn("npm", ["run", "workbench"], {
  cwd: webRoot,
  env: { ...process.env, WORKBENCH_OPEN: process.env.WORKBENCH_OPEN || "1" },
  stdio: "inherit",
});

function stop(signal) {
  if (!child.killed) child.kill(signal);
}

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
child.on("error", (error) => {
  console.error(`工作台启动失败：${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exit(code ?? 0);
});

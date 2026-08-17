import { spawn } from "node:child_process";
import { access, copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = join(projectRoot, "web");
const contentDirectories = [
  "00_收件箱",
  "01_待选题",
  "02_制作中",
  "03_已发布",
  "04_复盘",
  "90_模板",
];

function exists(path) {
  return access(path).then(() => true).catch(() => false);
}

function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env: process.env, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} 执行失败，退出码 ${code ?? "未知"}`));
    });
  });
}

function assertNodeVersion() {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 13)) {
    throw new Error(`当前 Node.js 为 ${process.versions.node}，请升级到 22.13 或更高版本。`);
  }
}

async function copyWhenMissing(source, target) {
  if (!(await exists(target)) && (await exists(source))) await copyFile(source, target);
}

export async function prepareWorkspace({ installDependencies = true } = {}) {
  assertNodeVersion();
  for (const directory of contentDirectories) {
    await mkdir(join(projectRoot, directory), { recursive: true });
  }

  await copyWhenMissing(join(projectRoot, "AGENTS.example.md"), join(projectRoot, "AGENTS.md"));
  await copyWhenMissing(
    join(projectRoot, "90_模板", "选题看板模板.md"),
    join(projectRoot, "选题看板.md"),
  );
  await copyWhenMissing(
    join(projectRoot, "90_模板", "发布数据模板.csv"),
    join(projectRoot, "04_复盘", "发布数据.csv"),
  );

  const sdkPath = join(webRoot, "node_modules", "@openai", "codex-sdk", "package.json");
  if (installDependencies && !(await exists(sdkPath))) {
    console.log("首次运行：正在安装本地依赖，请稍候……");
    await run("npm", ["install", "--no-audit", "--no-fund"], webRoot);
  }

  return { projectRoot, webRoot };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await prepareWorkspace();
  console.log("工作台准备完成。下一步运行：npm start");
}

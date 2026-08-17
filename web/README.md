# AI 自媒体工作台 Web 应用

这是当前项目的本地 Web 操作页面。页面负责展示灵感、脚本、封面和复盘文件；本地桥接服务通过官方 Codex SDK 执行自然语言指令。

## 启动

推荐在项目根目录运行 `npm start`。macOS 也可以双击 `启动自媒体工作台.command`，页面会自动在 Google Chrome 打开。

也可以在本目录运行：

```bash
npm run workbench
```

然后打开：

- 页面：`http://localhost:3000/`
- 本地桥接：`http://127.0.0.1:4317/api/health`

## 工作方式

- 页面中的对话会保持同一个本地 Codex 线程，点击“新对话”才会重置。
- Codex 的工作目录是上一级项目根目录，因此会自动读取根目录的 `AGENTS.md`。
- 实时热点使用已经配置的 AIHOT MCP。
- 稿件详情和 Codex 回复使用只读 Markdown 阅读排版；“复制正文”复制的是页面可见文本。
- “用 Codex 修改”会把当前文件作为上下文载入右侧对话，不会在点击按钮时直接改稿。
- 封面生成使用 `.env.local` 中配置的 Skill，默认名称为 `$artifact-template-creator`。
- 内容产出写入 `00_收件箱` 至 `04_复盘`，不会自动发布到外部平台。
- 本地桥接仅监听 `127.0.0.1`，不向局域网或公网开放。

## 常用命令

```bash
npm run workbench   # 同时启动页面和 Codex 桥接
npm run build       # 检查页面能否构建
npm test            # 构建并检查核心页面内容
npm run lint        # 代码规范检查
```

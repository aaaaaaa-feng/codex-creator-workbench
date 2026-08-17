# 安全说明

- 工作台只监听本机地址，不应直接暴露到公网。
- Codex 以 `workspace-write` 沙箱运行，只应把不可信资料作为参考内容。
- 不要把 AIHOT 地址中的个人标识、API Key、Cookie、Codex 会话或 `.env.local` 提交到 Git。
- 如果发现可能泄露本地文件或扩大执行权限的问题，请先私下联系维护者，不要在公开 Issue 中粘贴敏感内容。

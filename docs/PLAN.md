# v0.1 方案

## 目标

用户装好客户端、登录之后，能看到余额，并能一键把本机的 AI 编程工具切到 Cloudborne，也能一键切回去。

## 技术栈

Tauri 2 + React + TypeScript + Tailwind，与 Keysmith Switch 一致。配置读写、备份和还原的写法可参考 Keysmith Switch（`Jia-Ethan/keysmith-switch`）的 `src-tauri/src/adapter`、`ops.rs`、`lock.rs`，但这里单独实现，不共享代码。

## v0.1 范围

1. 登录：邮箱密码，走 sub2api 的 `POST /api/v1/auth/login`，令牌存进系统钥匙串。
2. 首页顶栏：钱包余额（`GET /api/v1/user/profile`）、充值按钮（打开网页充值页）、刷新。
3. 客户端卡片，每张卡显示「已安装 / 未安装 / 已连接」：
   - Codex 桌面版和 Codex CLI：在 `~/.codex/config.toml` 里写一段带标记的 provider 配置块。
   - Claude Code：写 `~/.claude/settings.json` 里的 `env.ANTHROPIC_BASE_URL` 和 `env.ANTHROPIC_AUTH_TOKEN`。
   - Claude Desktop：第三方网关配置，需要先确认 Claude Desktop 当前支持的写法再做。
4. 连接时，从账号下拉选一个 API Key（`GET /api/v1/keys`），没有就新建一个（`POST /api/v1/keys`）。
5. 每次写配置之前先备份原文件；「断开」时只移除我们写进去的那一段，用户原有配置不动。

## 不在 v0.1 做

Codex 生图 skill、历史记录 provider 迁移、Kimi Code、首次登录奖励、遥测、Windows 版。

## 发布门槛

macOS 首次打开不被 Gatekeeper 拦截，需要 Apple Developer ID 签名和公证，这个要单独申请账号。没有签名之前只发内测包。

# v0.1 方案

## 目标

用户装好客户端、用中转站账号登录后，能看到余额，并能一键把本机的 Codex、Claude Code、ZCode、Grok Build 接到 Cloudborne 中转站；工具没装时能一键安装；随时能一键断开，恢复成连接前的样子。

## 已定的边界

- 只登录中转站（`api.cloudborne.cn`）账号。官网 cloudborne.cn 的账号体系是另一套，客户端不碰，官网只放下载链接。
- 登录只做邮箱密码，账号开了两步验证时再要验证码。第三方登录（GitHub、Google、微信等）以后再做。
- 平台：macOS（Apple Silicon 和 Intel）和 Windows x64。
- 不做：支付、充值、使用数据上报、Claude Desktop、Kimi Code、Pi、Codex 生图 skill、历史会话迁移。
- 发布：公开仓库，安装包不做 Apple 公证和 Windows 代码签名，先内测。下载页放在中转站网站和官网。

## 技术栈

Tauri 2 + React + TypeScript + Tailwind，与 Keysmith Switch 一致。所有读写用户配置的逻辑放在 Rust 端，前端只调命令。

## 参考 TeamoRouter 的做法

拆过 `Teamo.app` 0.2.35（Tauri 2，Developer ID 签名）的二进制字符串，下面这些做法可以借鉴，只参考思路，不复用代码和素材：

- Codex：在 `~/.codex/config.toml` 里写一段带 `# >>> 标记` / `# <<< 标记` 的配置块，断开时只删这一段；改之前把原文件复制成 `config.toml.<产品名>-backup-<时间>`。
- Claude Code：写 `~/.claude/settings.json` 的 `env.ANTHROPIC_BASE_URL`、`env.ANTHROPIC_AUTH_TOKEN`，以及 `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU}_MODEL` 这几个模型变量。
- 检测工具是否安装：除了 PATH，还要找 `/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin`、`~/.volta/bin`、`~/.nvm/versions/node/*/bin`、`~/.fnm/...`、`~/.asdf/shims`。GUI 程序启动时拿不到用户 shell 的 PATH，必须自己补上。
- 一键安装：Codex 用 npm 装 `@openai/codex`，国内走 `registry.npmmirror.com` 镜像；官方提供脚本安装的工具（Kimi Code）则在 macOS 上用 AppleScript 打开「终端」，让用户看着它运行 `curl … | bash`。装完重新检测，找不到时提示「已安装但当前会话的 PATH 里看不到」。
- 余额：调中转站自己的用户接口。

Teamo 还做了这些，我们不跟：改 Codex 的 `auth.json` 和桌面版 `app.asar`、替换 Codex 的 imagegen skill、改写 Codex 历史数据库里的 provider、LaunchAgent 常驻。这些侵入性大，出问题时用户很难自己恢复。

## 登录与账号

| 功能 | 中转站接口 |
| --- | --- |
| 登录 | `POST /api/v1/auth/login`，需要两步验证时再调 `POST /api/v1/auth/login/2fa` |
| 刷新令牌 | `POST /api/v1/auth/refresh` |
| 退出 | `POST /api/v1/auth/logout` |
| 用户信息、余额 | `GET /api/v1/user/profile` |
| 可用分组及其平台 | `GET /api/v1/groups/available` |
| API 密钥 | `GET / POST /api/v1/keys`，`DELETE /api/v1/keys/:id` |

令牌存进系统钥匙串（macOS Keychain、Windows Credential Manager），不写明文文件。

## 四个工具怎么接

每个工具用一把专用密钥，名字是 `Cloudborne Desktop · <工具名>`，从对应平台的分组里创建。断开时可以选「同时删除这把密钥」。

| 工具 | 写入的文件 | 写法 | 分组平台 | 协议 |
| --- | --- | --- | --- | --- |
| Codex（CLI 和桌面版共用） | `~/.codex/config.toml` | 带标记的配置块：`[model_providers.cloudborne]`（`base_url`、`wire_api = "responses"`、`env_key` 或 `experimental_bearer_token`），外加顶层 `model_provider = "cloudborne"` | OpenAI | Responses |
| Claude Code | `~/.claude/settings.json` | 只增改 `env` 里我们管的几个键，记录原值，断开时还原 | Anthropic | Messages |
| ZCode | `~/.zcode/v2/config.json`、`~/.zcode/cli/config.json` | 在 `provider` 里加一个 `cloudborne` 条目：`kind: "openai-compatible"`，带 `options.baseURL`、`options.apiKey`、`models` | 国产模型分组（GLM、DeepSeek、Kimi、MiniMax 等） | OpenAI 兼容 |
| Grok Build | `~/.grok/config.toml` | 带标记的配置块，加 `[model."cloudborne-grok-4.7"]` 这类条目：`base_url`、`api_backend = "responses"`，`model` 用中转站的别名 | Grok | Responses |

### 不能踩的坑

- 别人也在改这些文件。比如 Keysmith Switch 会在 `~/.grok/config.toml` 里写一段 `keysmith-switch input rewrite`，ZCode 里也可能有用户自己加的 provider。所以只改自己标记的那一段，不重排、不重新格式化文件的其他部分。TOML 用保留格式的写法（Rust `toml_edit`），JSON 只动我们自己的键。
- Grok 的模型名不能和内置模型重名（`grok-4.6`、`grok-4.7` 等）。重名时 Grok 会把官方 session 凭证发到我们的 `base_url`，结果是 401，还会把凭证泄露给中转站。条目名和 `model` 字段都必须带 `cloudborne` 前缀。
- 写文件之前先备份，写的时候先写临时文件再原子替换，写完重新读一遍确认能解析。任何一步失败就恢复备份。
- 工具正在运行时改配置，有的要重启才会生效。连接成功后提示「重启 <工具> 后生效」。

## 一键安装

| 工具 | macOS | Windows |
| --- | --- | --- |
| Codex CLI | `npm i -g @openai/codex`（npmmirror 镜像） | 同左 |
| Claude Code | 官方脚本 `curl -fsSL https://claude.ai/install.sh \| bash` | 官方 PowerShell 脚本 `irm https://claude.ai/install.ps1 \| iex` |
| Grok Build | 官方脚本 `curl -fsSL https://x.ai/cli/install.sh \| bash`，装到 `~/.grok/bin` | 官方 PowerShell 脚本 `irm https://x.ai/cli/install.ps1 \| iex`，装到 `%USERPROFILE%\.grok\bin` |
| ZCode | 下载官方 `.dmg`（区分 `macos-arm64` / `macos-x64`），挂载后拷进「应用程序」 | 下载官方 `.exe`（`windows-x64` / `windows-arm64`）并运行 |

- 用 npm 安装时，如果本机没有 Node.js，先引导安装 Node.js LTS，不在客户端里内置 Node。
- 跑脚本的安装一律打开一个可见的终端窗口（macOS 用「终端」，Windows 用 PowerShell），让用户看到每一步在做什么，不在后台静默执行。
- 安装命令和下载地址写在一份配置里，不硬编码在代码各处，方便以后改。
- ZCode 安装包的地址格式是 `https://cdn-zcode.z.ai/zcode/electron/releases/<版本>/<平台>/ZCode-<版本>-<平台后缀>.<dmg|exe>`（2026-10-12 官网 zcode.z.ai/cn 上是 3.14.5）。CDN 根目录没有 `latest.yml`，最新版本号要从官网页面里解析；解析失败时退回配置里写死的版本号。
- 以上脚本地址 2026-10-12 实测都返回 200：`x.ai/cli/install.sh`、`x.ai/cli/install.ps1`、`claude.ai/install.sh`、`claude.ai/install.ps1`。

## 界面

参照 Teamo 的首页布局：

- 顶栏：Cloudborne 标志、账号、余额（带刷新按钮）。v0.1 没有充值入口。
- 不放解释性的小字（副标题、卡片说明、底部提示），界面只留必要的信息和按钮。
- 主体：四张工具卡片，每张显示工具图标、名称、状态（未安装、已安装、已连接 Cloudborne），以及一个主按钮（「一键安装」、「连接 Cloudborne」或「断开」）。
- 风格：与新图标一致，浅色暖调、圆角、柔和渐变；支持深色模式。

## 发布

- CI 用 GitHub Actions 构建 macOS universal `.dmg` 和 Windows x64 `.exe`（NSIS）。
- 应用内更新用 Tauri updater，更新包用我们自己的密钥签名，与 Apple 和 Windows 的代码签名无关。
- 下载页：中转站网站加一个 `/download` 页面，官网 cloudborne.cn 加一个下载入口，都链接到 GitHub Releases 上的安装包。
- 没有签名时用户第一次打开会被拦。下载页要写清楚怎么放行：macOS 是右键「打开」，或在「系统设置 → 隐私与安全性」里点「仍要打开」；Windows 是在 SmartScreen 里点「更多信息 → 仍要运行」。

## 测试

- Rust 单元测试：每个工具的写入和断开，都用临时目录模拟 HOME 来测，覆盖「文件不存在」「已有别人的配置」「已经连接过一次」「文件损坏」这几种情况。测试不碰开发者自己的 `~/.codex` 等目录。
- Windows：没有实机，靠 CI 在 `windows-latest` 上跑单元测试和打包，再请用户实测后反馈。

## 待确认

- ZCode 是否需要重启才会读到新的 provider。
- 中转站给 Codex 和 Grok 用的模型名清单：从 `/v1/models` 拿，还是在客户端里写一份默认列表。

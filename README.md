# Cloudborne Desktop

Cloudborne（栖云）中转站的桌面客户端：用中转站账号登录、看余额，一键把 Codex、Claude Code、ZCode、Grok Build 和 Pi 接到 Cloudborne，没装的工具可以一键安装。支持 macOS 和 Windows。

产品形态参照 TeamoRouter 桌面端（首页是客户端卡片列表，每张卡片一个「连接」按钮）。只参照交互，不复用对方的代码、素材或图形。

## 状态

v0.5 内测中（未签名）。已完成：

- 邮箱密码登录、两步验证、令牌自动刷新；令牌存在系统钥匙串。注册和找回密码在中转站网页上做，客户端不提供。
- 登录状态不随网络变化失效：首次启动生成一个随机设备 ID，存在系统钥匙串里，放进 User-Agent（`CloudborneDesktop/<版本> (<系统>; device=<ID>)`）。中转站的会话绑定对这种 UA 只校验设备 ID，不校验 IP 和版本号；其他客户端仍按 IP + UA 校验。需要中转站 `0.2.8-cloudborne.8-devicebind` 及以上，旧版中转站上换网络仍会被要求重新登录。
- 窗口：macOS 用系统侧边栏材质做毛玻璃，标题栏隐藏、红绿灯嵌在侧边栏上；Windows 11 用 Mica；Windows 10 及更早是实心背景。页面从 `window.__CB_GLASS__`（`vibrancy` / `mica` / `none`）得知拿到的是哪种，见 `src-tauri/src/window.rs`。
- 布局：左侧边栏（新任务、首页、最近任务；底部头像菜单：复制邮箱、控制台、语言、检查更新、关于、退出账号），右侧主页面顶部一抹晨光渐变。
- 语言：简体中文和英文，首次按系统语言选择，可在登录页右上角或头像菜单里切换，不用重启。Rust 侧的报错和安装窗口提示通过 `set_language` 跟着切换。
- 应用内更新：启动 3 秒后和每 6 小时静默检查一次，发现新版本时首页右上角出现「更新到 vX」、头像旁出现小红点，点了下载、安装、重启；头像菜单里的「检查更新」可以手动检查。更新源是本仓库 Latest Release 里的 `latest.json`，安装包用更新密钥签名（minisign，和苹果、微软的代码签名无关），客户端只装签名对得上的包。
- 登录页左边是品牌面板（渐变缓慢流动，五个工具标签绕图标转），首页各块依次淡入上移，连接时工具图标外圈转动，连上后状态点弹一下。系统开了「减少动态效果」时动画都关掉。
- 新任务：描述问题，AI 在本机检查、配置、修复 AI 工具，见下一节。
- 首页显示余额。不做充值。
- 首页右上角「实时折扣」：取这个账号在 GPT、Claude、Grok 各家能用的分组里最低的倍率（中转站给账号设了专属倍率时用专属倍率），按 `倍率 ÷ 汇率` 换成折扣，保留一位小数并向上取整，三家每 3 秒轮换。充值是 ¥1 = $1，所以付 ¥倍率 就能用到官方 $1 的量。汇率读中转站后台「支付设置 → 订阅 CNY 换算汇率」（`/api/v1/payment/config` 的 `subscription_usd_to_cny_rate`），没设时按 7.2。倍率和汇率每次刷新余额时重新读。
- 工具图标用各家官方 logo（矢量来自 [lobe-icons](https://github.com/lobehub/lobe-icons)，MIT），见 `src/components/Logo.tsx`。
- 五个工具的检测、连接、断开。每个工具在中转站上用一把专用密钥，名字是 `Cloudborne Desktop · <工具名>`。
- 一键安装：Claude Code、Grok Build、Pi 在可见的终端里跑官方脚本；Codex 用 npm（没有 Node.js 时打开 Node.js 下载页）；ZCode 从官方 CDN 下载安装包并打开。

方案和边界见 [`docs/PLAN.md`](docs/PLAN.md)。

## 新任务

做法参照 TeamoRouter：每一轮用 `codex exec --json` 跑 Codex，界面把它吐出的事件画成对话。代码在 `src-tauri/src/agent/`。

- 运行环境：客户端自带一份 Codex CLI（`runtime.rs` 里固定版本），第一次用时从 npm 下载对应平台的包，先走 npmmirror，失败再走 npmjs，按写死的 sha512 校验后解压到应用数据目录 `agent/codex/<版本>/`，不依赖、也不改用户自己装的 Codex。macOS 包约 140 MB。
- Codex 的 home 是应用数据目录里的 `agent/codex-home/`，只配了中转站一个 provider，关掉了更新检查、统计和反馈；用户的 `~/.codex` 和它的历史不受影响。工作目录是用户主目录。
- 权限：完全访问，不弹确认（`--dangerously-bypass-approvals-and-sandbox`）。提示词（`instructions.rs`）要求改文件前先备份、不完整显示密钥、删数据或要管理员权限前先问。
- 密钥：在账号第一个可用的 OpenAI 分组里建一把 `Cloudborne Desktop · Agent`，通过环境变量交给 Codex，不写进文件。模型列表来自这把密钥的 `/v1/models`，去掉 codex、image、audio 类模型。
- 对话：后续轮次用 `codex exec resume <thread>` 接着上一轮。界面上的历史存在 `agent/sessions/<id>.json`。
- 失败分类：余额不足（402 / quota）、登录失效（401）、请求太多（429）、网络、运行环境，各自给出提示和按钮。

## 连接时改了什么

| 工具 | 文件 | 写入内容 | 断开时 |
| --- | --- | --- | --- |
| Codex | `~/.codex/config.toml` | 文件末尾一段带 `# >>> cloudborne-desktop` 标记的 `[model_providers.cloudborne]`，顶层 `model_provider` 改成 `cloudborne` | 删掉这段，`model_provider` 改回原值 |
| Claude Code | `~/.claude/settings.json` | `env` 里的 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`；暂时移走 `ANTHROPIC_API_KEY` | 三个键恢复原值和原顺序 |
| ZCode | `~/.zcode/v2/config.json`、`~/.zcode/cli/config.json` | `provider.cloudborne`（OpenAI 兼容） | 只删 `provider.cloudborne` |
| Grok Build | `~/.grok/config.toml` | 文件末尾一段带标记的 `[model."cloudborne/<模型>"]` | 删掉这段 |
| Pi | `~/.pi/agent/models.json`、`~/.pi/agent/settings.json`（设了 `PI_CODING_AGENT_DIR` 时在那里） | `providers.cloudborne`，协议跟着分组走：GPT、Grok 用 Responses，Claude 用 Messages，国产模型用 Chat Completions；`defaultProvider` / `defaultModel` 改成它 | 只删 `providers.cloudborne`；默认模型还是我们设的就改回原值，用户自己换过就不动 |

- 每次写之前把原文件复制成 `<文件名>.cloudborne-backup-<时间>`，写入是原子替换，写完重新读一遍校验，校验失败就恢复备份。
- 原文件解析不了时直接报错，不会去改它。
- Claude Code 和 Pi 被覆盖前的原值记在 `~/.cloudborne-desktop/state.json`。
- 用本机真实的 Codex、Claude Code、ZCode、Grok 配置文件副本做过「连接 + 断开」，五个文件都和原来逐字节一致。

## 开发

需要 Node.js 22+ 和 Rust stable。

```sh
npm install
npm run tauri dev                         # 开发模式
npm run tauri build                       # 打包
cargo test --manifest-path src-tauri/Cargo.toml
```

- `CLOUDBORNE_HOME=<目录>`：所有配置读写都改到这个目录，测试时不碰自己的真实配置。
- `CLOUDBORNE_ORIGIN=<地址>`：换中转站地址，默认 `https://api.cloudborne.cn`。
- `cargo run --example roundtrip`（配合 `CLOUDBORNE_HOME`）：对四个工具各做一次连接和断开。

CI（`.github/workflows/ci.yml`）在 macOS 和 Windows 上跑测试，并打包未签名的 `.dmg`（universal）和 `.exe`（NSIS）。推 `v*` 标签时，安装包会附到一个草稿 Release 上。

## 目录

- `src/`：界面（React + Tailwind）。
- `src-tauri/src/`：`api.rs` 中转站接口，`session.rs` 登录和钥匙串，`tools/` 四个工具的读写，`install.rs` 一键安装，`fsx.rs` 备份、原子写入和标记段。
- `brand/`：图标和 logo，全部从 `brand/build.mjs` 里的几何参数生成，不手改 SVG。
- `docs/PLAN.md`：v0.1 的范围、技术栈和接口。

## 品牌资产

```sh
npm install              # 只装 polygon-clipping，用来把标志合成单一路径
node brand/build.mjs     # 生成 brand/dist/*.svg
brand/render.sh          # 用本机 Chrome 渲染 app-icon-1024.png 和 preview.png
```

`brand/dist/AppIcon.icns` 由 `app-icon-1024.png` 经 `sips` 和 `iconutil` 导出。

| 文件 | 用途 |
| --- | --- |
| `app-icon.svg` / `app-icon-1024.png` / `AppIcon.icns` | 桌面应用图标 |
| `avatar.svg` / `avatar-1024.png` | 满版方图，公众号、社交头像用（平台会裁成圆形） |
| `mark.svg` | 单色标志，`currentColor`，网页内联用 |
| `mark-ink.svg` / `mark-white.svg` | 浅底 / 深底的单色标志 |
| `mark-path.json` | 标志的单一路径和 viewBox，给不支持 mask 的渲染器用（如 Satori） |

## 发版与推送更新

1. 改 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 三处版本号，提交。
2. 打带说明的 tag 并推送：`git tag -a v0.2.1 -m "更新说明"`、`git push origin v0.2.1`。tag 说明会成为更新提示里的 notes。
3. CI 构建 macOS 通用包和 Windows 安装包，生成 `.app.tar.gz` / `-setup.exe` 的签名和 `latest.json`，挂到一个 draft Release 上。
4. 检查 draft 没问题后点 Publish（不要勾 pre-release，保持 Latest）。发布那一刻起，已安装的客户端在下次检查时就会看到更新。

更新私钥在本机 `~/.cloudborne-desktop-signing/`（权限 700），CI 里是 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 两个 secret。私钥丢了，已装的客户端就收不到后续更新，只能手动重装，所以要另外备份。0.2.0 及更早的版本没有更新功能，需要手动装一次 0.2.1。

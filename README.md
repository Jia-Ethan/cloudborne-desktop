# Cloudborne Desktop

Cloudborne（栖云）中转站的桌面客户端：用中转站账号登录、看余额，一键把 Codex、Claude Code、ZCode 和 Grok Build 接到 Cloudborne，没装的工具可以一键安装。支持 macOS 和 Windows。

产品形态参照 TeamoRouter 桌面端（首页是客户端卡片列表，每张卡片一个「连接」按钮）。只参照交互，不复用对方的代码、素材或图形。

## 状态

v0.3 内测中（未签名）。已完成：

- 邮箱密码登录、两步验证、令牌自动刷新；令牌存在系统钥匙串。注册和找回密码在中转站网页上做，客户端不提供。
- 登录状态不随网络变化失效：首次启动生成一个随机设备 ID，存在系统钥匙串里，放进 User-Agent（`CloudborneDesktop/<版本> (<系统>; device=<ID>)`）。中转站的会话绑定对这种 UA 只校验设备 ID，不校验 IP 和版本号；其他客户端仍按 IP + UA 校验。需要中转站 `0.2.8-cloudborne.8-devicebind` 及以上，旧版中转站上换网络仍会被要求重新登录。
- 窗口：macOS 用系统侧边栏材质做毛玻璃，标题栏隐藏、红绿灯嵌在侧边栏上；Windows 11 用 Mica；Windows 10 及更早是实心背景。页面从 `window.__CB_GLASS__`（`vibrancy` / `mica` / `none`）得知拿到的是哪种，见 `src-tauri/src/window.rs`。
- 布局：左侧边栏（首页；底部头像菜单：复制邮箱、控制台、语言、检查更新、关于、退出账号），右侧主页面顶部一抹晨光渐变。
- 语言：简体中文和英文，首次按系统语言选择，可在登录页右上角或头像菜单里切换，不用重启。Rust 侧的报错和安装窗口提示通过 `set_language` 跟着切换。
- 应用内更新：启动 3 秒后和每 6 小时静默检查一次，发现新版本时首页右上角出现「更新到 vX」、头像旁出现小红点，点了下载、安装、重启；头像菜单里的「检查更新」可以手动检查。更新源是本仓库 Latest Release 里的 `latest.json`，安装包用更新密钥签名（minisign，和苹果、微软的代码签名无关），客户端只装签名对得上的包。
- 登录页左边是品牌面板（渐变缓慢流动，四个工具标签绕图标转），首页各块依次淡入上移，连接时工具图标外圈转动，连上后状态点弹一下。系统开了「减少动态效果」时动画都关掉。
- 首页显示余额。v0.1 不做充值。
- 四个工具的检测、连接、断开。每个工具在中转站上用一把专用密钥，名字是 `Cloudborne Desktop · <工具名>`。
- 一键安装：Claude Code、Grok Build 在可见的终端里跑官方脚本；Codex 用 npm（没有 Node.js 时打开 Node.js 下载页）；ZCode 从官方 CDN 下载安装包并打开。

方案和边界见 [`docs/PLAN.md`](docs/PLAN.md)。

## 连接时改了什么

| 工具 | 文件 | 写入内容 | 断开时 |
| --- | --- | --- | --- |
| Codex | `~/.codex/config.toml` | 文件末尾一段带 `# >>> cloudborne-desktop` 标记的 `[model_providers.cloudborne]`，顶层 `model_provider` 改成 `cloudborne` | 删掉这段，`model_provider` 改回原值 |
| Claude Code | `~/.claude/settings.json` | `env` 里的 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`；暂时移走 `ANTHROPIC_API_KEY` | 三个键恢复原值和原顺序 |
| ZCode | `~/.zcode/v2/config.json`、`~/.zcode/cli/config.json` | `provider.cloudborne`（OpenAI 兼容） | 只删 `provider.cloudborne` |
| Grok Build | `~/.grok/config.toml` | 文件末尾一段带标记的 `[model."cloudborne/<模型>"]` | 删掉这段 |

- 每次写之前把原文件复制成 `<文件名>.cloudborne-backup-<时间>`，写入是原子替换，写完重新读一遍校验，校验失败就恢复备份。
- 原文件解析不了时直接报错，不会去改它。
- Claude Code 被覆盖前的原值记在 `~/.cloudborne-desktop/state.json`。
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

# Cloudborne Desktop

Cloudborne（栖云）中转站的桌面客户端：用中转站账号登录、看余额，一键把 Codex、Claude Code、ZCode、Grok Build 和 Pi 接到 Cloudborne，没装的工具可以一键安装。支持 macOS 和 Windows。

产品形态参照 TeamoRouter 桌面端（首页是客户端卡片列表，每张卡片一个「连接」按钮）。只参照交互，不复用对方的代码、素材或图形。

## 状态

v0.9 内测中（未签名）。已完成：

- 邮箱密码登录、两步验证、令牌自动刷新。令牌和设备 ID 在 Windows 上存系统凭据管理器；在 macOS 上存应用数据目录里只有本人能读的文件（`~/Library/Application Support/cn.cloudborne.desktop/*.secret`，权限 600），不用钥匙串：应用是 ad-hoc 签名，每次更新代码哈希都变，钥匙串会在每次更新后弹窗要登录密码。注册和找回密码在中转站网页上做，客户端不提供。
- 多账号（v0.9，v0.9.1 改进）：可以保存多个账号。左下角显示当前账号的用户名（没设用户名时用邮箱 @ 前面的部分），点开的菜单顶部是当前账号（用户名 + 邮箱，点击复制邮箱），下面「切换账号」列出其他账号，一键切换；还有添加账号、移除（悬停出现 ×，会在中转站登出并忘掉这个账号和它记住的密码）。登录时默认勾选「记住密码」：密码和令牌存在同一个地方（macOS 是应用数据目录下仅本人可读的文件，Windows/Linux 是系统凭据），条目名 `password.<user_id>`，只有 Rust 端读取，界面只拿到 `has_password`。这样账号的会话过期或被退出后，点一下仍能直接登录（用记住的密码重新登录；需要两步验证时直接进验证码页；密码已改则提示重新输入并忘掉旧密码）。「退出账号」只退出当前账号，账号留在列表里，有其他已登录账号就切过去，否则回登录页。登录页有已保存账号时先显示「选择账号」卡片（用户名、邮箱、状态：已登录 / 一键登录 / 需要密码），点卡片直接登录，「使用其他账号」进入表单；表单的邮箱框像浏览器一样弹出已保存的账号（可上下键选择），密码框可以显示/隐藏。账号列表存在 `accounts`（user_id、邮箱、用户名和当前账号），每个账号的令牌单独存在 `session.<user_id>`，因为 Windows 凭据最多 2560 字节。v0.8 的 `session` 在首次启动时接管为当前账号，拿到资料后搬到它自己的条目。刷新令牌按账号各自处理：被中转站拒绝时只把这个账号标成已登出，其他账号不受影响；「另一个进程已经换过令牌」的恢复也按账号做。设备 ID 全安装共用一个。切换后各页面状态、用量缓存、宝箱状态、管理页焦点都重置；新任务的历史按安装保留，模型列表按账号重新读取。
- 兑换（v0.9.1）：侧边栏「兑换」页，输入或粘贴兑换码兑换余额、并发或订阅，下面是最近记录（兑换码、管理员调整、返利转入、宝箱购买等所有余额变动，可加载更多）。接口：`POST /api/v1/redeem`、`GET /api/v1/redeem/history?page=&page_size=`。
- 登录状态不随网络变化失效：首次启动生成一个随机设备 ID，和令牌存在一起，放进 User-Agent（`CloudborneDesktop/<版本> (<系统>; device=<ID>)`）。中转站的会话绑定对这种 UA 只校验设备 ID，不校验 IP 和版本号；其他客户端仍按 IP + UA 校验。需要中转站 `0.2.8-cloudborne.8-devicebind` 及以上，旧版中转站上换网络仍会被要求重新登录。
- 更新后不掉登录（v0.7）：刷新令牌是一次性的，中转站用过就作废。两个请求同时遇到 401 时只刷新一次，另一个直接用新令牌；刷新成功但存盘失败时新令牌仍留在内存里；中转站说旧令牌无效时，先看文件里是否已有别的进程存下的新令牌，有就接着用。设备 ID 读不出来时这次运行临时用一个，不覆盖已存的那个，免得会话绑定对不上。启动时检查登录失败（比如更新重启后网络还没好）会自动重试，不再直接显示登录页。
- 窗口：macOS 用系统侧边栏材质做毛玻璃，标题栏隐藏、红绿灯嵌在侧边栏上；Windows 11 用 Mica；Windows 10 及更早是实心背景。页面从 `window.__CB_GLASS__`（`vibrancy` / `mica` / `none`）得知拿到的是哪种，见 `src-tauri/src/window.rs`。
- 布局：左侧边栏（新任务、首页、用量、宝箱、兑换、API 密钥、服务状态，管理员另有「管理」组，再往下是最近任务；底部显示用户名，点开头像菜单：当前账号（点击复制邮箱）、切换账号和添加账号、控制台、语言、检查更新、关于、退出账号），右侧主页面顶部一抹晨光渐变。
- 语言：简体中文和英文，首次按系统语言选择，可在登录页右上角或头像菜单里切换，不用重启。Rust 侧的报错和安装窗口提示通过 `set_language` 跟着切换。
- 应用内更新：启动 3 秒后和每 6 小时静默检查一次，发现新版本时首页右上角出现「更新到 vX」、头像旁出现小红点，点了下载、安装、重启；头像菜单里的「检查更新」可以手动检查。更新源是本仓库 Latest Release 里的 `latest.json`，安装包用更新密钥签名（minisign，和苹果、微软的代码签名无关），客户端只装签名对得上的包。
- 登录页左边是品牌面板（渐变缓慢流动，五个工具标签绕图标转），首页各块依次淡入上移，连接时工具图标外圈转动，连上后状态点弹一下。系统开了「减少动态效果」时动画都关掉。
- 新任务：描述问题，AI 在本机检查、配置、修复 AI 工具，见下一节。
- 首页显示余额。不做充值。
- 用量：看整个账号（含网页上建的密钥）在今天、近 7 天、近 30 天的花费、请求、Token 和缓存命中率，趋势图按缓存读取、输入、缓存写入、输出分层，可切换成看花费；厂商汇总按模型名归到厂商，鼠标停在一行上列出具体模型。右上角可以只看某个工具（按客户端给它建的密钥筛）。数据来自中转站的用户接口 `/api/v1/usage/stats` 和 `/api/v1/usage/dashboard/snapshot-v2`，只在打开页面和点刷新时请求。缓存命中率 = 缓存读取 ÷（输入 + 缓存读取 + 缓存写入），因为中转站记录的输入 token 不含缓存部分。花费是实际扣费，不显示「相当于官方价多少」。
- API 密钥：列出账号下所有密钥（含网页上建的），每把显示所属分组和倍率（有专属倍率时显示专属的）、今日和近 30 天花费、额度和限额用量、到期日。可以创建、编辑、停用/启用、删除；创建时选名称和分组，「更多设置」里有自定义密钥、有效期、总额度、5 小时/每日/7 天限额、IP 白名单和黑名单，规则和中转站网页一致。「使用方法」给出接口地址、密钥，以及 cURL、Python、Node.js 调用示例（Claude 分组用 Messages API，其余用 Chat Completions，示例模型取这把密钥能用的第一个对话模型），Claude、GPT、Gemini、Grok 分组可以一键导入 CC Switch（`ccswitch://` 链接，和网页控制台一样）。删除客户端给工具建的专用密钥前会提示工具会断开。接口：`GET/POST /api/v1/keys`、`PUT/DELETE /api/v1/keys/:id`、`POST /api/v1/usage/dashboard/api-keys-usage`。
- 服务状态：中转站的探活结果，每个厂商一行，显示当前状态（正常、较慢、不可用）、最近 60 次探测的色条、7 天可用率和延迟；同一厂商有多个探测时取最差的状态、可用率取平均、延迟取未宕机探测的中位数。页面打开时每分钟刷新。数据来自 `GET /api/v1/channel-monitors`（后台「渠道监控」开启且为 v1 模式时才有数据）。
- 宝箱（v0.9，替换 v0.8 的每日抽奖）：中转站开了活动时侧边栏才有「宝箱」，旁边的数字是未开启的宝箱数。宝箱四种来源：低消宝箱（当日消费满门槛送，每人每天有上限、全站每天限量，当天 24:00 过期）、满额宝箱（每消费 $50 得 1 个，可设每人和全站每日上限；v0.9.2 起有单独开关，关闭时卡片显示「满额宝箱暂未开放」）、购买（用余额买，可设每人和全站每日上限，确认框里写明总价）、开箱抽中「再得一个宝箱」。除低消宝箱外都可以囤，每人最多持有 `hold_cap` 个（满了以后应得的宝箱作废）。页面顶部是「我的宝箱 N 个」、持有上限、活动时间（北京时间，开始前和进行中各有倒计时）和「开启 1 个 / 开启 10 个」；单开保留原来的揭晓动画，连开先放最好那个的爆开效果，再弹出清单（按稀有度排，史诗和传说高亮，合计获得余额）。活动结束后已有的宝箱仍可开启。今日结果标出来源（低消 / 消费 / 购买 / 奖励）。接口：`GET /api/v1/lottery`、`POST /api/v1/lottery/open`（`{count}`，1–10）、`POST /api/v1/lottery/buy`（`{count}`）。规则见中转站仓库 `docs/LOTTERY.md`。
- 管理（v0.8）：账号 `role` 为 `admin` 时显示「总览」（今日全站花费、请求、活跃用户、模型占比、7 天趋势、今日抽奖）、「用户」（搜索、今日和近 30 天花费、加减余额、启用停用）、「宝箱管理」（当日汇总：开启次数、各来源发出数、低消过期未开、满仓未发、发放、购买收入、奖池余额；大奖记录、全部记录；设置：活动时间、持有上限、低消宝箱、满额宝箱（v0.9.2 起有开关）和奖池预算、购买的价格和上限、奖池垫付、奖品表，以及平均每箱成本上限和返奖率，开放购买时成本上限超过售价不能保存；「使用推荐奖池」把推荐设置载入表单，保存后才生效）。点一条大奖打开中奖人详情：账号、这次的奖、他的抽奖历史，可跳到「用户」页。管理接口走 `https://ops.cloudborne.cn/api/v1/admin/...`（`api.cloudborne.cn` 对管理路径返回 404），令牌和设备 ID 与普通接口相同，写操作带 `Idempotency-Key`。管理员要先在网页后台确认过合规声明，否则接口返回 423 `ADMIN_COMPLIANCE_ACK_REQUIRED`。
- 首页右上角「实时折扣」：取这个账号在各家能用的分组里最低的倍率（中转站给账号设了专属倍率时用专属倍率），换成官方价的几折，七家每 3 秒轮换。充值是 ¥1 = $1。GPT、Claude、Gemini、Grok 在中转站按官方美元价计费，付 ¥倍率 用到官方 $1 的量，所以折扣是 `倍率 ÷ 汇率`；DeepSeek、GLM、Kimi 按官方人民币价计费，付 ¥倍率 用到官方 ¥1 的量，折扣就是倍率本身（DeepSeek 包含「限时 Lite」分组）。向上取整，1 折以上保留一位小数，不到 1 折保留两位，好让 0.25、0.3 这类专属倍率显示得出差别。汇率读中转站后台「支付设置 → 订阅 CNY 换算汇率」（`/api/v1/payment/config` 的 `subscription_usd_to_cny_rate`），没设时按 7.2。倍率和汇率每次刷新余额时重新读。
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
- `CLOUDBORNE_ORIGIN=<地址>`：换中转站地址，默认 `https://api.cloudborne.cn`；设了它时管理接口也走这个地址（默认走 `https://ops.cloudborne.cn`）。
- `cargo run --example roundtrip`（配合 `CLOUDBORNE_HOME`）：对四个工具各做一次连接和断开。

CI（`.github/workflows/ci.yml`）在 macOS 和 Windows 上跑测试，并打包未签名的 `.dmg`（universal）和 `.exe`（NSIS）。推 `v*` 标签时，安装包会附到一个草稿 Release 上。

## 目录

- `src/`：界面（React + Tailwind）。
- `src-tauri/src/`：`api.rs` 中转站接口，`session.rs` 登录、令牌存储和刷新，`accounts.rs` 已保存账号的列表，`tools/` 四个工具的读写，`install.rs` 一键安装，`fsx.rs` 备份、原子写入和标记段。
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

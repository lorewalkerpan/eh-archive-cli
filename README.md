# eh-archive-cli

[English](README.en.md) | 中文

用于下载你有权访问的图库归档 ZIP 的 Node.js 命令行工具。支持单本、批量队列、断点续传、失败重试、Cookie 本机配置和安全覆盖更新。

> 本工具不会绕过登录、访问控制、配额或内容限制。请仅下载和保存你拥有相应权利的内容。

## 安装

需要 Node.js 22.14 或更高版本：

```powershell
npm install -g @lorewalkerpan/eh-archive-cli
eharchive --help
```

### 升级

```powershell
npm update -g @lorewalkerpan/eh-archive-cli
eharchive --version
```

升级不会删除 `%APPDATA%\eharchive\config.json` 中保存的 Cookie 或代理策略。

## 快速开始

最常见的流程是：先确认配置状态，再下载一个已授权图库。首次需要登录的命令会自动进入 Cookie 向导。

```powershell
eharchive config show
eharchive download "图库ID/Token" --out .\downloads
```

`ID/Token` 是站点图库地址中的两段标识，例如 URL `https://e-hentai.org/g/123/token/` 对应 `123/token`。仅有数字 ID 无法请求图库。

## Cookie 设置

首次运行需要登录 Cookie 的命令（如 `download`、`favorites list`）时，工具会自动检查本机配置。若未配置且当前终端可交互，会依次提示输入 `ipb_member_id`、`ipb_pass_hash`，再可选输入 `igneous`：每项输入都不会回显、不会写入命令历史，并会自动保存供后续命令使用。

必须提供 `ipb_member_id` 与 `ipb_pass_hash`；`igneous` 可以直接跳过。环境变量、文件和 `--stdin` 导入仍支持浏览器导出的多行 `key: value` 内容，工具会转换为标准 Cookie 格式并忽略 `igneous: null`。

默认保存位置固定为 Windows 的 `%APPDATA%\eharchive\config.json`，独立于 npm 的全局安装目录；正常升级或重新安装 CLI 都不会删除它。可随时用下面的命令确认保存位置和状态：

```powershell
eharchive config show
```

也可主动运行 `eharchive config set-cookie`，按提示隐藏录入。若更适合从环境变量、文件或剪贴板导入，推荐：

```powershell
$env:EH_COOKIE = "ipb_member_id=...; ipb_pass_hash=..."
eharchive config set-cookie --cookie-env EH_COOKIE
eharchive config show
```

也可从剪贴板经标准输入传入，避免手动粘贴进命令行：

```powershell
Get-Clipboard | eharchive config set-cookie --stdin
```

配置文件含有登录 Cookie，请勿上传、共享或提交到 Git；Unix 系统会限制为仅当前用户可读写。`eharchive config clear` 只删除 Cookie，保留已保存的代理策略。管道、CI 等非交互环境不会等待输入；请先用 `config set-cookie --stdin` 保存，或临时传入 `--cookie-file`。

## 系统代理

默认自动使用系统环境中的 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 和 `NO_PROXY`，无需额外设置 Node 参数。也可将策略持久化到本机配置：

```powershell
eharchive config set-proxy system                  # 使用系统代理（默认）
eharchive config set-proxy direct                  # 始终直连
eharchive config set-proxy http://127.0.0.1:7890   # 固定使用指定 HTTP(S) 代理
eharchive config show
```

需要仅对一次命令直连时，将根选项放在命令前：

```powershell
eharchive --no-proxy favorites list
```

## 日志

默认记录简要日志：命令开始、完成、失败以及网络错误。日志文件位于配置文件同目录：`%APPDATA%\eharchive\eharchive.log`。日志不会记录 Cookie 内容。

```powershell
eharchive config set-log simple    # 简要日志（默认）
eharchive config set-log verbose   # 详细日志，增加请求状态和重试信息
eharchive config set-log none      # 完全关闭日志
eharchive config show              # 查看级别和日志路径
```

预览、搜索、收藏、单本下载和批量下载共用同一日志策略。详细日志会隐藏 Cookie 字段；如果不希望在磁盘留下请求记录，可设为 `none`。

无需保存 Cookie 时，可在每次执行中使用环境变量或文件：

```powershell
eharchive download "https://e-hentai.org/g/123/token/" --cookie-env EH_COOKIE
eharchive download "https://e-hentai.org/g/123/token/" --cookie-file .\cookies.txt
```

## 下载单个图库

```powershell
eharchive download "https://e-hentai.org/g/123/token/" --quality original --out .\downloads
```

完整 URL 也可简写为 `图库 ID/Token`：

```powershell
eharchive download "2724315/34536084b4" --out .\downloads
```

纯数字 ID 不足以下载：站点还要求对应 Token。完整 URL 仅接受 `e-hentai.org` 或 `exhentai.org` 的图库路径。

常用选项：

- `--quality original|resampled|auto`：原图、压缩版本，或优先原图、原图归档选项不存在时自动改用压缩版本。
- `--out <目录>`、`--name <文件名>`：输出位置和 ZIP 名称。未指定名称时，自动使用 `标题 [图库ID] [original].zip` 或 `标题 [图库ID] [resampled].zip`，两个版本可并存；不适合作为 Windows 文件名的标题字符会自动清理。
- `--overwrite`：完整 ZIP 已存在时重新下载，并在成功后安全替换。
- `--retries <次数>`：请求失败后的重试次数，默认 `3`。
- `--timeout <秒>`：每次 ZIP 请求的超时，默认 `60` 秒。
- `--no-resume`：不续传已有 `.part` 文件。

下载先写入 `.part`。出现网络中断时保留该文件，下次默认从断点续传；只有完整下载成功后才替换正式 ZIP。登录 Cookie 只发送给受信任的图库域名，不会随 ZIP 直链发出。

## 搜索预览

搜索只显示结果，不会自动下载。默认搜索标题和标签；无需 Cookie 也可预览公开搜索结果。

```powershell
eharchive search "artist:example" --pages 2
eharchive search "关键词" --title-only --min-rating 3 --json
```

可使用 `--description`、`--torrents`、`--min-pages`、`--max-pages` 扩展筛选。导出结果后再确认批量下载：

```powershell
eharchive search "关键词" --pages 3 --export .\search-results.txt
eharchive batch .\search-results.txt --out .\downloads
```

## 图库可视化预览

`preview` 会生成一个本地 HTML 页面，展示图库封面和 EH 默认第一页的前 20 张压缩缩略图。它只引用站点缩略图地址：不会下载原始页面，也不会把 CLI 的 Cookie 写进 HTML 文件。

```powershell
eharchive preview "2724315/34536084b4"
eharchive preview "2724315/34536084b4" --images 12 --out .\previews\my-gallery.html
```

默认文件位于 `previews\`。点击缩略图会在浏览器打开对应的 EH 图片页；只需要封面和缩略图元数据时可用 `--json`。

## 批量下载与失败重试

新建 UTF-8 文本文件 `galleries.txt`；每行一个完整图库 URL 或 `ID/Token`，空行与 `#` 开头的注释会忽略：

```text
# 我的下载列表
2724315/34536084b4
https://e-hentai.org/g/456/token-b/
```

执行并生成报告：

```powershell
eharchive batch .\galleries.txt --quality original --out .\downloads --concurrency 2 --delay 1 --report .\batch-report.json
```

- `--concurrency 1` 到 `8`：并行任务数，默认 `2`。
- `--delay <秒>`：每次任务启动之间的最小间隔，默认 `1`；建议保留或提高该值。
- 默认开启自适应并发：检测到 `429`、`503`、超时等限流迹象时，会自动降并发并冷却；连续成功后逐步恢复。可用 `--no-adaptive` 关闭。
- `--report <文件>`：生成不含 Cookie 的 JSON 报告，记录下载、跳过与失败项目。
- 单项失败不会停止其余任务，命令会以非零状态码提示存在失败。

只重试报告中的失败项目：

```powershell
eharchive retry .\batch-report.json --out .\downloads --report .\retry-report.json
```

## 查看和导出云端收藏

使用已保存的 Cookie 查看当前账号的云端收藏。默认读取一页：

```powershell
eharchive favorites list
eharchive favorites list --category 0 --pages 3
eharchive favorites list --search "关键词" --json
```

`--category` 可选 `0` 到 `9`；`--all` 会连续读取全部页面（最多 100 页）。需要 ExH 页面时可传 `--site exhentai`。

导出为与 `batch` 兼容的 `ID/Token` 清单后直接下载：

```powershell
eharchive favorites list --category 0 --all --export .\favorites-0.txt
eharchive batch .\favorites-0.txt --out .\downloads --concurrency 2
```

收藏列表和导出文件不包含 Cookie；该功能只读取收藏，不会修改线上收藏夹。

## 配置与命令速查

| 需求 | 命令 |
| --- | --- |
| 查看本机配置状态 | `eharchive config show` |
| 重新设置 Cookie | `eharchive config set-cookie` |
| 清除 Cookie、保留代理 | `eharchive config clear` |
| 使用系统代理 | `eharchive config set-proxy system` |
| 持久化直连 | `eharchive config set-proxy direct` |
| 单次直连 | `eharchive --no-proxy <命令>` |
| 设置日志级别 | `eharchive config set-log simple|verbose|none` |
| 查看收藏并导出下载列表 | `eharchive favorites list --all --export .\favorites.txt` |
| 搜索后再下载 | `eharchive search "关键词" --export .\results.txt` 后执行 `eharchive batch .\results.txt` |

配置文件字段只有 `cookie` 与 `proxy`；前者是敏感信息，后者可为 `system`、`direct` 或 HTTP(S) 代理地址。不要手工复制或分享配置文件。

## 常见问题

### `fetch failed` / `UND_ERR_CONNECT_TIMEOUT`

先运行 `eharchive config show` 确认代理策略。使用本地代理时选择 `system`，或保存明确地址：`eharchive config set-proxy http://127.0.0.1:7890`。若网络本应直连，可临时用 `eharchive --no-proxy favorites list` 排查。

### 登录重定向、收藏读取失败或权限不足

重新运行 `eharchive config set-cookie`，按向导填写 `ipb_member_id` 与 `ipb_pass_hash`。工具不会绕过登录、配额、访问控制或站点内容限制；请确认账号本身拥有相应权限。

### 批量下载有部分失败

保留 `--report` 生成的 JSON 报告，再只重试失败项：

```powershell
eharchive retry .\batch-report.json --out .\downloads --report .\retry-report.json
```

可降低 `--concurrency` 或提高 `--delay`，默认自适应模式会在限流或超时时自动降速。

## 安全与边界

- Cookie 仅发送给受信任的 EH 图库域名，不会随 ZIP 直链转发。
- ZIP 下载使用 `.part` 文件，成功后才安全替换正式文件。
- 搜索、收藏、预览默认是只读操作；批量下载必须显式执行 `batch`。
- 请只下载和保存你有权访问与保留的内容。

## 实际使用要点

按目标选择命令：

| 目标 | 命令 | 网络行为 |
| --- | --- | --- |
| 下载一本归档 | `eharchive download ID/Token` | 读取图库并请求账号有权使用的归档 |
| 只搜索不下载 | `eharchive search "关键词"` | 只读取搜索结果 |
| 查看单本图库 | `eharchive preview ID/Token` | 读取元数据，并在 HTML 中引用远程缩略图 |
| 下载准备好的清单 | `eharchive batch galleries.txt` | 明确下载清单中的每一项 |
| 只重试失败项 | `eharchive retry report.json` | 根据上次批量报告重跑失败项 |
| 读取云端收藏 | `eharchive favorites list` | 只读账号请求 |

搜索、收藏和预览不会隐式开始下载。搜索导出的是 UTF-8 文本，每行一个 `ID/Token`，可以先检查或编辑，再交给 `batch`。

下载文件位于 `--out` 指定目录。已有归档默认跳过，使用 `--overwrite` 才会覆盖；中断的传输会保留 `.part` 文件并默认续传。批量任务即使有失败项也会写出报告，同时以非零退出码结束，之后可以用 `retry` 继续。

预览 HTML 是轻量索引：封面和最多 20 张缩略图仍引用站点地址，不是离线图库，也不会下载原图。

## 支持的引用格式和站点

图库引用可以是完整 URL，例如 `https://e-hentai.org/g/123/token/`，也可以是简写 `123/token`。只有数字 ID 会被拒绝，因为解析图库还需要 Token。完整 URL 仅接受 `e-hentai.org` 和 `exhentai.org`；Cookie 不会转发到归档 ZIP 域名。

`favorites` 和 `search` 支持 `--site e-hentai` 与 `--site exhentai`。只有账号和网络确实能够访问 ExH 时才使用 `exhentai`。

## 开发与发布

```powershell
npm install
npm test
npm run pack:check
```

PR 会自动运行测试和 npm 打包检查。发布通过 GitHub Release 触发 npm Trusted Publishing；Release 标签必须与 `package.json` 版本匹配。

## 许可证

GPL-3.0-or-later。本项目根据 GPL 上游 Android 客户端的归档下载交互进行独立 TypeScript 实现；详见 `NOTICE.md`。

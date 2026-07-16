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

## Cookie 设置

Cookie 不会出现在命令历史或命令输出中。推荐先把 Cookie 放到环境变量，再保存到本机配置：

```powershell
$env:EH_COOKIE = "ipb_member_id=...; ipb_pass_hash=..."
eharchive config set-cookie --cookie-env EH_COOKIE
eharchive config show
```

也可从剪贴板经标准输入传入，避免手动粘贴进命令行：

```powershell
Get-Clipboard | eharchive config set-cookie --stdin
```

默认配置文件位于 Windows 的 `%APPDATA%\eharchive\config.json`。它含有登录 Cookie，请勿上传、共享或提交到 Git；Unix 系统会限制为仅当前用户可读写。使用 `eharchive config clear` 可删除该配置。

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

- `--quality original|resampled`：原图或压缩版本。
- `--out <目录>`、`--name <文件名>`：输出位置和 ZIP 名称。
- `--overwrite`：完整 ZIP 已存在时重新下载，并在成功后安全替换。
- `--retries <次数>`：请求失败后的重试次数，默认 `3`。
- `--timeout <秒>`：每次 ZIP 请求的超时，默认 `60` 秒。
- `--no-resume`：不续传已有 `.part` 文件。

下载先写入 `.part`。出现网络中断时保留该文件，下次默认从断点续传；只有完整下载成功后才替换正式 ZIP。登录 Cookie 只发送给受信任的图库域名，不会随 ZIP 直链发出。

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
- `--report <文件>`：生成不含 Cookie 的 JSON 报告，记录下载、跳过与失败项目。
- 单项失败不会停止其余任务，命令会以非零状态码提示存在失败。

只重试报告中的失败项目：

```powershell
eharchive retry .\batch-report.json --out .\downloads --report .\retry-report.json
```

## 开发与发布

```powershell
npm install
npm test
npm run pack:check
```

PR 会自动运行测试和 npm 打包检查。发布通过 GitHub Release 触发 npm Trusted Publishing；Release 标签必须与 `package.json` 版本匹配。

## 许可证

GPL-3.0-or-later。本项目根据 GPL 上游 Android 客户端的归档下载交互进行独立 TypeScript 实现；详见 `NOTICE.md`。

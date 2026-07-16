# eh-archive-cli

一个用于下载你有权访问的图库归档 ZIP 的 Node.js 命令行工具。支持单本、批量队列、并发下载、Cookie 本机配置和安全覆盖更新。

> 本工具不会绕过登录、访问控制、配额或内容限制。请仅下载和保存你拥有相应权利的内容。

## 安装

需要 Node.js 22.14 或更高版本：

```powershell
npm install -g @lorewalkerpan/eh-archive-cli
eharchive --help
```

## 推荐：保存 Cookie 一次，后续直接下载

Cookie 不会出现在命令历史中。先把 Cookie 放入环境变量，再保存到本机配置：

```powershell
$env:EH_COOKIE = "ipb_member_id=...; ipb_pass_hash=..."
eharchive config set-cookie --cookie-env EH_COOKIE
eharchive config show
```

默认配置文件位于 Windows 的 `%APPDATA%\eharchive\config.json`；它含有登录 Cookie，请勿上传、共享或提交到 Git。可用 `eharchive config clear` 删除。

也可不保存 Cookie，而是在每次执行时使用环境变量或文件：

```powershell
eharchive download "https://example.invalid/g/123/token/" --cookie-env EH_COOKIE
eharchive download "https://example.invalid/g/123/token/" --cookie-file .\cookies.txt
```

## 下载单个图库

```powershell
eharchive download "https://example.invalid/g/123/token/" --quality original --out .\downloads
```

- `--quality original|resampled`：选择原图或压缩版本。
- `--out <目录>`：输出目录，默认 `downloads`。
- `--name <文件名>`：自定义 ZIP 文件名。
- `--overwrite`：同名 ZIP 已存在时重新下载并在成功后覆盖；默认跳过已有文件。

下载时先写入 `.part` 临时文件，只有完整下载成功后才会替换正式 ZIP，避免覆盖时留下损坏文件。

## 批量下载

新建一个 UTF-8 文本文件，例如 `galleries.txt`。每行一个图库链接，空行和 `#` 开头的注释会忽略：

```text
# 我的下载列表
https://example.invalid/g/123/token-a/
https://example.invalid/g/456/token-b/
```

执行：

```powershell
eharchive batch .\galleries.txt --quality original --out .\downloads --concurrency 2
```

- `--concurrency 1` 到 `8`：并行任务数，默认 `2`；建议从低并发开始。
- `--overwrite`：批量重新下载已有 ZIP。
- 任一任务失败不会停止其余任务；命令最后会输出下载、跳过和失败数量，并以非零状态码标识存在失败。

## 开发与发布

```powershell
npm install
npm test
npm run pack:check
```

发布通过 GitHub Release 触发 npm Trusted Publishing，无需在仓库或 CI 中保存 npm Token。

## 许可证

GPL-3.0-or-later。本项目根据 GPL 上游 Android 客户端的归档下载交互进行独立 TypeScript 实现；详见 `NOTICE.md`。

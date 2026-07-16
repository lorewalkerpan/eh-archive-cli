# eh-archive-cli

[中文](README.md) | English

A Node.js command-line tool for downloading gallery archive ZIP files that you are authorized to access. It supports single and batch downloads, safe resume, retries, local Cookie configuration, and overwrite protection.

> This tool does not bypass login, access controls, quotas, or content restrictions. Download only content you are authorized to save.

## Install

Node.js 22.14 or later is required.

```powershell
npm install -g @lorewalkerpan/eh-archive-cli
eharchive --help
```

## Configure a Cookie

Keep the Cookie out of shell history by using an environment variable:

```powershell
$env:EH_COOKIE = "ipb_member_id=...; ipb_pass_hash=..."
eharchive config set-cookie --cookie-env EH_COOKIE
```

On Windows, you can pipe a clipboard value instead:

```powershell
Get-Clipboard | eharchive config set-cookie --stdin
```

The saved local configuration contains the Cookie. Do not commit or share it; remove it with `eharchive config clear`. You can also use `--cookie-env` or `--cookie-file` for a temporary Cookie.

## Download

Use a full gallery URL or its compact `ID/Token` form:

```powershell
eharchive download "2724315/34536084b4" --out .\downloads
```

An ID alone is not enough because the gallery Token is required. Full URLs must be gallery URLs on `e-hentai.org` or `exhentai.org`.

Useful options:

- `--quality original|resampled`
- `--overwrite` safely replaces an existing ZIP only after a successful download.
- `--retries <count>` defaults to `3`; `--timeout <seconds>` defaults to `60`.
- Downloads retain `.part` files after an interruption and resume by default. Use `--no-resume` to restart.

Cookies are only sent to trusted gallery hosts and are not forwarded to ZIP download hosts.

## Batch download

Create a UTF-8 list with one URL or `ID/Token` per line; blank lines and lines beginning with `#` are ignored.

```powershell
eharchive batch .\galleries.txt --out .\downloads --concurrency 2 --delay 1 --report .\batch-report.json
```

`--delay` controls the minimum time between task starts. Adaptive concurrency is enabled by default: rate-limit responses such as `429`/`503` and timeouts reduce concurrency and apply a cooldown; stable successes gradually restore it. Use `--no-adaptive` to disable this behavior. The JSON report contains outcomes but never Cookies. Retry only the failures with:

```powershell
eharchive retry .\batch-report.json --out .\downloads --report .\retry-report.json
```

## Development and publishing

```powershell
npm install
npm test
npm run pack:check
```

Pull requests run CI automatically. GitHub Releases use npm Trusted Publishing and must have a tag matching the version in `package.json`.

## License

GPL-3.0-or-later. See `NOTICE.md`.

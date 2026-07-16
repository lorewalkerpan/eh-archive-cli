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

On the first command that requires a Cookie (such as `download` or `favorites list`), the CLI checks the local configuration. If none exists in an interactive terminal, it asks you to paste one: input is hidden, never added to shell history, and then saved for later commands.

You may paste browser-exported multiline `key: value` data; the CLI converts it to a normal Cookie header. Both `ipb_member_id` and `ipb_pass_hash` are required. A single `ipb_member_id` is incomplete and is rejected; `igneous: null` is ignored.

The default location is always `%APPDATA%\eharchive\config.json` on Windows. It is outside npm's global installation directory, so normal upgrades and reinstalls do not remove it. Check its location and state at any time:

```powershell
eharchive config show
```

You can also run `eharchive config set-cookie` and follow the hidden prompt. To import from an environment variable, file, or clipboard instead:

```powershell
$env:EH_COOKIE = "ipb_member_id=...; ipb_pass_hash=..."
eharchive config set-cookie --cookie-env EH_COOKIE
```

On Windows, you can pipe a clipboard value instead:

```powershell
Get-Clipboard | eharchive config set-cookie --stdin
```

The saved local configuration contains the Cookie. Do not commit or share it; remove it with `eharchive config clear`. Non-interactive environments such as pipes and CI never wait for secret input: save it first with `config set-cookie --stdin`, or use `--cookie-file` temporarily.

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

## Search preview

Search previews results without downloading them. Titles and tags are searched by default; public search previews can run without a Cookie.

```powershell
eharchive search "artist:example" --pages 2
eharchive search "keyword" --title-only --min-rating 3 --json
```

Use `--description`, `--torrents`, `--min-pages`, and `--max-pages` for additional filtering. Export results and then explicitly batch-download them:

```powershell
eharchive search "keyword" --pages 3 --export .\search-results.txt
eharchive batch .\search-results.txt --out .\downloads
```

## Gallery visual preview

Generate a local HTML page with the gallery cover and the first 20 default EH thumbnails. It references the site's compressed thumbnail URLs only; it does not download original pages or put the CLI Cookie into the HTML file.

```powershell
eharchive preview "2724315/34536084b4"
eharchive preview "2724315/34536084b4" --images 12 --out .\previews\my-gallery.html
```

The generated page is placed under `previews\` by default. Clicking a thumbnail opens its EH gallery-page link in the browser. Use `--json` when only the cover and thumbnail metadata is needed.

## Batch download

Create a UTF-8 list with one URL or `ID/Token` per line; blank lines and lines beginning with `#` are ignored.

```powershell
eharchive batch .\galleries.txt --out .\downloads --concurrency 2 --delay 1 --report .\batch-report.json
```

`--delay` controls the minimum time between task starts. Adaptive concurrency is enabled by default: rate-limit responses such as `429`/`503` and timeouts reduce concurrency and apply a cooldown; stable successes gradually restore it. Use `--no-adaptive` to disable this behavior. The JSON report contains outcomes but never Cookies. Retry only the failures with:

```powershell
eharchive retry .\batch-report.json --out .\downloads --report .\retry-report.json
```

## View and export cloud favorites

Use the configured Cookie to view the current account's cloud favorites. One page is fetched by default:

```powershell
eharchive favorites list
eharchive favorites list --category 0 --pages 3
eharchive favorites list --search "keyword" --json
```

`--category` accepts `0` through `9`; `--all` follows all pages up to a limit of 100. Use `--site exhentai` when the account has access to that site.

Export a batch-compatible `ID/Token` list and download it directly:

```powershell
eharchive favorites list --category 0 --all --export .\favorites-0.txt
eharchive batch .\favorites-0.txt --out .\downloads --concurrency 2
```

Favorites output and exported lists never contain the Cookie. This command is read-only and does not alter cloud favorites.

## Development and publishing

```powershell
npm install
npm test
npm run pack:check
```

Pull requests run CI automatically. GitHub Releases use npm Trusted Publishing and must have a tag matching the version in `package.json`.

## License

GPL-3.0-or-later. See `NOTICE.md`.

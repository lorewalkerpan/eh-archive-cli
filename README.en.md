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

### Upgrade

```powershell
npm update -g @lorewalkerpan/eh-archive-cli
eharchive --version
```

Upgrading does not remove the Cookie or proxy policy stored in `%APPDATA%\eharchive\config.json`.

## Quick start

Check the local configuration and download one gallery you are authorized to access. The first command that needs authentication starts the Cookie wizard automatically.

```powershell
eharchive config show
eharchive download "gallery-id/token" --out .\downloads
```

`ID/Token` is the pair from a gallery URL, such as `123/token` from `https://e-hentai.org/g/123/token/`. A numeric ID alone is not enough.

## Configure a Cookie

On the first command that requires a Cookie (such as `download` or `favorites list`), the CLI checks the local configuration. If none exists in an interactive terminal, it asks separately for `ipb_member_id`, `ipb_pass_hash`, and optionally `igneous`: every value is hidden, never added to shell history, and then saved for later commands.

Both `ipb_member_id` and `ipb_pass_hash` are required; `igneous` may be skipped. Environment variables, files, and `--stdin` still accept browser-exported multiline `key: value` data and convert it to a normal Cookie header while ignoring `igneous: null`.

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

The saved local configuration contains the Cookie. Do not commit or share it; `eharchive config clear` removes only the Cookie and preserves the saved proxy policy. Non-interactive environments such as pipes and CI never wait for secret input: save it first with `config set-cookie --stdin`, or use `--cookie-file` temporarily.

## System proxy

The CLI automatically uses `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NO_PROXY` from the system environment; no Node flags are required. You can also persist a policy locally:

```powershell
eharchive config set-proxy system                  # use system proxy (default)
eharchive config set-proxy direct                  # always connect directly
eharchive config set-proxy http://127.0.0.1:7890   # fixed HTTP(S) proxy
eharchive config show
```

To force a direct connection for one command, put the root option first:

```powershell
eharchive --no-proxy favorites list
```

## Logging

Simple logging is enabled by default: command start, completion, failures, and network errors are recorded. The log file is stored beside the configuration file at `%APPDATA%\eharchive\eharchive.log`. Cookie values are never written to logs.

```powershell
eharchive config set-log simple    # concise logs (default)
eharchive config set-log verbose   # detailed request statuses and retry events
eharchive config set-log none      # disable disk logging
eharchive config show              # show level and log path
```

Preview, search, favorites, single downloads, and batch downloads share the same logging policy. Detailed mode redacts Cookie fields; use `none` when request records should not remain on disk.

## Download

Use a full gallery URL or its compact `ID/Token` form:

```powershell
eharchive download "2724315/34536084b4" --out .\downloads
```

An ID alone is not enough because the gallery Token is required. Full URLs must be gallery URLs on `e-hentai.org` or `exhentai.org`.

Useful options:

- `--quality original|resampled|auto`: original, resampled, or try original first and use resampled only when the original archive offer is unavailable.
- Default ZIP names use `Title [gallery ID] [archive kind].zip`, such as `Example Gallery [2724315] [original].zip`, so both versions can coexist. Characters unsuitable for Windows filenames are cleaned automatically.
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

## Configuration and command reference

| Goal | Command |
| --- | --- |
| Show local configuration | `eharchive config show` |
| Set Cookie again | `eharchive config set-cookie` |
| Clear Cookie but keep proxy | `eharchive config clear` |
| Use system proxy | `eharchive config set-proxy system` |
| Persist direct connections | `eharchive config set-proxy direct` |
| Bypass proxy once | `eharchive --no-proxy <command>` |
| Set log level | `eharchive config set-log simple|verbose|none` |
| Export favorites for download | `eharchive favorites list --all --export .\favorites.txt` |
| Search, then download | `eharchive search "keyword" --export .\results.txt`, then `eharchive batch .\results.txt` |

The local file only stores `cookie` and `proxy`. The former is sensitive; the latter can be `system`, `direct`, or an HTTP(S) proxy URL. Do not copy or share this file.

## Troubleshooting

### `fetch failed` / `UND_ERR_CONNECT_TIMEOUT`

Run `eharchive config show` to check the proxy policy. For a local proxy, use `system` or save an explicit address with `eharchive config set-proxy http://127.0.0.1:7890`. If the network should connect directly, test with `eharchive --no-proxy favorites list`.

### Login redirects, favorites failures, or insufficient permission

Run `eharchive config set-cookie` again and provide `ipb_member_id` plus `ipb_pass_hash`. The CLI does not bypass login, quotas, access controls, or content restrictions; confirm that the account itself has access.

### Some batch items fail

Keep the JSON report and retry failures only:

```powershell
eharchive retry .\batch-report.json --out .\downloads --report .\retry-report.json
```

Lower `--concurrency` or increase `--delay` when needed. Adaptive mode is on by default and slows down after rate limits or timeouts.

## Safety and scope

- Cookies are sent only to trusted EH gallery hosts and never forwarded to direct ZIP hosts.
- ZIP downloads use `.part` files and replace the final output only after success.
- Search, favorites, and preview are read-only by default; batch downloads require an explicit `batch` command.
- Download and retain only content you are authorized to access.

## Practical workflow notes

Choose the command by the result you want:

| Need | Command | Network effect |
| --- | --- | --- |
| Download one archive | `eharchive download ID/Token` | Reads the gallery and requests its authorized archive |
| Search without downloading | `eharchive search "query"` | Read-only search request |
| Inspect one gallery | `eharchive preview ID/Token` | Reads gallery metadata and references remote thumbnails in HTML |
| Download a prepared list | `eharchive batch galleries.txt` | Explicitly downloads every listed item |
| Retry only failures | `eharchive retry report.json` | Re-runs failed entries from a previous batch |
| Read cloud favorites | `eharchive favorites list` | Read-only account request |

Search, favorites, and preview never turn into downloads implicitly. A search export is a plain UTF-8 file containing one `ID/Token` per line, so it can be reviewed or edited before running `batch`.

Downloads are written below the selected `--out` directory. Existing archives are skipped unless `--overwrite` is supplied; interrupted transfers remain as `.part` files and resume by default. A failed batch sets a non-zero exit code but still writes the report, allowing `retry` to continue later.

The preview HTML is a lightweight index: its cover and up to 20 thumbnails remain remote references. It is not an offline copy of the gallery and does not download original images.

## Supported references and sites

The accepted gallery reference is either a full URL such as `https://e-hentai.org/g/123/token/` or its compact `123/token` form. Numeric IDs without a token are rejected because the token is required to resolve the gallery. Gallery URLs are restricted to `e-hentai.org` and `exhentai.org`; cookies are never forwarded to archive ZIP hosts.

The `favorites` and `search` commands support `--site e-hentai` and `--site exhentai`. Use `exhentai` only when the account and network have access to it.

## Development and publishing

```powershell
npm install
npm test
npm run pack:check
```

Pull requests run CI automatically. GitHub Releases use npm Trusted Publishing and must have a tag matching the version in `package.json`.

## License

GPL-3.0-or-later. See `NOTICE.md`.

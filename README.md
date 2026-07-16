# eh-archive-cli

`eharchive` is a Node.js command-line tool that resolves and downloads an archive ZIP for a gallery you are authorized to download.

## Install

```powershell
npm install -g @lorewalkerpan/eh-archive-cli
```

## Download

Store your authorized Cookie in an environment variable rather than the command history:

```powershell
$env:EH_COOKIE = "ipb_member_id=...; ipb_pass_hash=..."
eharchive download "https://e-hentai.org/g/2724315/34536084b4/" --quality original --out .\downloads
```

For a local cookie file that is excluded from Git, use `--cookie-file .\cookies.txt`.

Options:

- `--quality original|resampled` selects the archive quality.
- `--out <directory>` sets the download directory.
- `--name <filename>` sets the ZIP filename.
- `--cookie-env <variable>` changes the environment variable name (default `EH_COOKIE`).

The tool keeps the Cookie in memory for the current process and does not write it to logs, configuration, or output metadata. It does not bypass login, access controls, quotas, or content restrictions.

## Development

```powershell
npm install
npm test
npm run pack:check
```

## Publishing

The package is prepared for npm Trusted Publishing from the `v*` GitHub release workflow. Configure the trusted publisher in npm for this repository and workflow before creating a release tag.

## License

GPL-3.0-or-later. This project is a clean TypeScript implementation of an archive-download interaction derived from the GPL-licensed upstream Android client. See `NOTICE.md`.

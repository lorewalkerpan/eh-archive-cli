#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Command } from "commander";
import { downloadArchive, resolveArchive, type ArchiveKind } from "./core.js";

const program = new Command();
program
  .name("eharchive")
  .description("Download authorized gallery archives as ZIP files")
  .version("0.1.0")
  .showHelpAfterError();

program.command("download <gallery-url>")
  .description("Resolve and download an archive for a gallery URL")
  .option("-q, --quality <quality>", "original or resampled", "original")
  .option("-o, --out <directory>", "output directory", "downloads")
  .option("-n, --name <filename>", "ZIP filename")
  .option("--cookie-env <variable>", "environment variable containing the authorized Cookie", "EH_COOKIE")
  .option("--cookie-file <path>", "UTF-8 file containing the authorized Cookie")
  .action(async (galleryUrl: string, options: { quality: ArchiveKind; out: string; name?: string; cookieEnv: string; cookieFile?: string }) => {
    if (options.quality !== "original" && options.quality !== "resampled") throw new Error("--quality must be original or resampled");
    const cookie = options.cookieFile
      ? (await readFile(options.cookieFile, "utf8")).trim()
      : process.env[options.cookieEnv]?.trim();
    if (!cookie) throw new Error(`No Cookie was supplied. Set ${options.cookieEnv} or use --cookie-file.`);

    process.stderr.write("Resolving archive link...\n");
    const directUrl = await resolveArchive(galleryUrl, options.quality, { cookie });
    const fallback = `${new URL(galleryUrl).pathname.split("/").filter(Boolean)[1] ?? "archive"}.zip`;
    const outputPath = resolve(options.out, options.name ?? fallback);
    let lastReport = 0;
    await downloadArchive(directUrl, outputPath, {
      cookie,
      onProgress(downloaded, total) {
        if (downloaded - lastReport < 1024 * 1024 && total !== downloaded) return;
        lastReport = downloaded;
        const progress = total ? ` / ${(total / 1024 / 1024).toFixed(1)} MiB` : "";
        process.stderr.write(`\rDownloaded ${(downloaded / 1024 / 1024).toFixed(1)} MiB${progress}`);
      }
    });
    process.stderr.write("\n");
    process.stdout.write(`${outputPath}\n`);
  });

program.parseAsync().catch((error: Error) => {
  process.stderr.write(`Error: ${error.message}\n`);
  process.exitCode = 1;
});

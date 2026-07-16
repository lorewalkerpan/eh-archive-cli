#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { Command } from "commander";
import { clearCookie, defaultConfigPath, loadConfig, saveCookie } from "./config.js";
import { downloadArchive, resolveArchive, type ArchiveKind } from "./core.js";

type DownloadCommandOptions = {
  quality: ArchiveKind;
  out: string;
  name?: string;
  cookieEnv: string;
  cookieFile?: string;
  overwrite?: boolean;
};

const program = new Command();
program
  .name("eharchive")
  .description("下载你有权访问的图库归档 ZIP")
  .version("0.2.0")
  .option("--config <path>", "本机 Cookie 配置文件路径", defaultConfigPath())
  .showHelpAfterError();

function qualityOption(command: Command): Command {
  return command
    .option("-q, --quality <quality>", "original 或 resampled", "original")
    .option("-o, --out <directory>", "下载目录", "downloads")
    .option("--cookie-env <variable>", "临时 Cookie 的环境变量名", "EH_COOKIE")
    .option("--cookie-file <path>", "临时 Cookie 的 UTF-8 文件")
    .option("--overwrite", "已存在同名 ZIP 时重新下载并覆盖");
}

async function getCookie(options: Pick<DownloadCommandOptions, "cookieEnv" | "cookieFile">): Promise<string> {
  if (options.cookieFile) return (await readFile(options.cookieFile, "utf8")).trim();
  const fromEnvironment = process.env[options.cookieEnv]?.trim();
  if (fromEnvironment) return fromEnvironment;
  const configured = await loadConfig(program.opts().config);
  if (configured.cookie) return configured.cookie;
  throw new Error("没有可用 Cookie。运行 `eharchive config set-cookie --cookie-env EH_COOKIE`，或使用 --cookie-file。");
}

function defaultFilename(galleryUrl: string): string {
  const parts = new URL(galleryUrl).pathname.split("/").filter(Boolean);
  return `${parts[1] ?? "archive"}.zip`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function downloadOne(galleryUrl: string, options: DownloadCommandOptions, progressPrefix = ""): Promise<"downloaded" | "skipped"> {
  if (options.quality !== "original" && options.quality !== "resampled") throw new Error("--quality 必须是 original 或 resampled");
  const outputPath = resolve(options.out, options.name ?? defaultFilename(galleryUrl));
  if (await fileExists(outputPath) && !options.overwrite) {
    process.stderr.write(`${progressPrefix}跳过已存在文件：${basename(outputPath)}（使用 --overwrite 可覆盖）\n`);
    return "skipped";
  }
  const cookie = await getCookie(options);
  process.stderr.write(`${progressPrefix}解析归档链接…\n`);
  const directUrl = await resolveArchive(galleryUrl, options.quality, { cookie });
  let lastReport = 0;
  const result = await downloadArchive(directUrl, outputPath, {
    cookie,
    overwrite: options.overwrite,
    onProgress(downloaded, total) {
      if (downloaded - lastReport < 1024 * 1024 && total !== downloaded) return;
      lastReport = downloaded;
      const suffix = total ? ` / ${(total / 1024 / 1024).toFixed(1)} MiB` : "";
      process.stderr.write(`${progressPrefix}已下载 ${(downloaded / 1024 / 1024).toFixed(1)} MiB${suffix}\n`);
    }
  });
  if (result === "downloaded") process.stdout.write(`${outputPath}\n`);
  return result;
}

qualityOption(program.command("download <gallery-url>").description("下载单个图库归档"))
  .option("-n, --name <filename>", "ZIP 文件名")
  .action(async (galleryUrl: string, options: DownloadCommandOptions) => {
    await downloadOne(galleryUrl, options);
  });

qualityOption(program.command("batch <list-file>").description("按文本文件中的图库链接批量下载；每行一个链接，# 开头为注释"))
  .option("-c, --concurrency <count>", "并发任务数", "2")
  .action(async (listFile: string, options: DownloadCommandOptions & { concurrency: string }) => {
    const urls = [...new Set((await readFile(listFile, "utf8")).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")))];
    const concurrency = Number(options.concurrency);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("--concurrency 必须是 1 到 8 的整数");
    if (!urls.length) throw new Error("链接文件中没有可下载的 URL。");
    let next = 0;
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
      while (true) {
        const index = next++;
        if (index >= urls.length) return;
        const prefix = `[${index + 1}/${urls.length}] `;
        try {
          const result = await downloadOne(urls[index], options, prefix);
          if (result === "downloaded") downloaded += 1;
          else skipped += 1;
        } catch (error: unknown) {
          failed += 1;
          process.stderr.write(`${prefix}失败：${error instanceof Error ? error.message : String(error)}\n`);
        }
      }
    }));
    process.stderr.write(`批量完成：下载 ${downloaded}，跳过 ${skipped}，失败 ${failed}。\n`);
    if (failed) process.exitCode = 1;
  });

const config = program.command("config").description("管理本机 Cookie 配置（Cookie 不会打印到终端）");
config.command("set-cookie")
  .description("从环境变量或本地文件保存 Cookie")
  .option("--cookie-env <variable>", "环境变量名", "EH_COOKIE")
  .option("--cookie-file <path>", "Cookie 的 UTF-8 文件")
  .action(async (options: { cookieEnv: string; cookieFile?: string }) => {
    const cookie = options.cookieFile ? (await readFile(options.cookieFile, "utf8")).trim() : process.env[options.cookieEnv]?.trim();
    if (!cookie) throw new Error(`未找到 Cookie。请先设置 ${options.cookieEnv}，或使用 --cookie-file。`);
    await saveCookie(program.opts().config, cookie);
    process.stdout.write(`Cookie 已保存到 ${program.opts().config}\n`);
  });
config.command("show").description("显示配置状态，不会显示 Cookie 内容").action(async () => {
  const configured = await loadConfig(program.opts().config);
  process.stdout.write(JSON.stringify({ path: program.opts().config, cookieConfigured: Boolean(configured.cookie) }, null, 2) + "\n");
});
config.command("clear").description("删除已保存的 Cookie").action(async () => {
  await clearCookie(program.opts().config);
  process.stdout.write("已删除本机 Cookie 配置。\n");
});

program.parseAsync().catch((error: Error) => {
  process.stderr.write(`错误：${error.message}\n`);
  process.exitCode = 1;
});

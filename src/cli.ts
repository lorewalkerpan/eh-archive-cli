#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { Command } from "commander";
import { clearCookie, defaultConfigPath, loadConfig, saveCookie } from "./config.js";
import { downloadArchive, normalizeGalleryUrl, resolveArchive, type ArchiveKind } from "./core.js";

type DownloadCommandOptions = {
  quality: ArchiveKind;
  out: string;
  name?: string;
  cookieEnv: string;
  cookieFile?: string;
  overwrite?: boolean;
  resume: boolean;
  retries: string;
  timeout: string;
};

type BatchCommandOptions = DownloadCommandOptions & {
  concurrency: string;
  delay: string;
  report?: string;
};

type BatchEntry = {
  reference: string;
  galleryUrl?: string;
  outputPath?: string;
  status: "downloaded" | "skipped" | "failed";
  error?: string;
};

type BatchReport = {
  format: "eharchive-batch-report-v1";
  createdAt: string;
  source: string;
  entries: BatchEntry[];
};

const program = new Command();
program
  .name("eharchive")
  .description("下载你有权访问的图库归档 ZIP")
  .version("0.3.0")
  .option("--config <path>", "本机 Cookie 配置文件路径", defaultConfigPath())
  .showHelpAfterError();

function qualityOption(command: Command): Command {
  return command
    .option("-q, --quality <quality>", "original 或 resampled", "original")
    .option("-o, --out <directory>", "下载目录", "downloads")
    .option("--cookie-env <variable>", "临时 Cookie 的环境变量名", "EH_COOKIE")
    .option("--cookie-file <path>", "临时 Cookie 的 UTF-8 文件")
    .option("--overwrite", "已存在同名 ZIP 时重新下载并覆盖")
    .option("--no-resume", "不续传已有 .part 文件")
    .option("--retries <count>", "请求失败后的重试次数", "3")
    .option("--timeout <seconds>", "每次 ZIP 请求的超时秒数", "60");
}

function nonNegativeInteger(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${option} 必须是非负整数`);
  return parsed;
}

function positiveSeconds(value: string, option: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${option} 必须是大于 0 的秒数`);
  return parsed;
}

async function getCookie(options: Pick<DownloadCommandOptions, "cookieEnv" | "cookieFile">): Promise<string> {
  if (options.cookieFile) {
    const cookie = (await readFile(options.cookieFile, "utf8")).trim();
    if (cookie) return cookie;
    throw new Error("Cookie 文件为空。");
  }
  const fromEnvironment = process.env[options.cookieEnv]?.trim();
  if (fromEnvironment) return fromEnvironment;
  const configured = await loadConfig(program.opts().config);
  if (configured.cookie) return configured.cookie;
  throw new Error("没有可用 Cookie。运行 `eharchive config set-cookie --cookie-env EH_COOKIE`，或使用 --cookie-file。");
}

async function readStandardInput(): Promise<string> {
  let value = "";
  for await (const chunk of process.stdin) value += chunk;
  return value.trim();
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

async function downloadOne(galleryReference: string, options: DownloadCommandOptions, progressPrefix = ""): Promise<{ status: "downloaded" | "skipped"; outputPath: string; galleryUrl: string }> {
  if (options.quality !== "original" && options.quality !== "resampled") throw new Error("--quality 必须是 original 或 resampled");
  const galleryUrl = normalizeGalleryUrl(galleryReference);
  const outputPath = resolve(options.out, options.name ?? defaultFilename(galleryUrl));
  if (await fileExists(outputPath) && !options.overwrite) {
    process.stderr.write(`${progressPrefix}跳过已存在文件：${basename(outputPath)}（使用 --overwrite 可覆盖）\n`);
    return { status: "skipped", outputPath, galleryUrl };
  }
  const cookie = await getCookie(options);
  process.stderr.write(`${progressPrefix}解析归档链接…\n`);
  const directUrl = await resolveArchive(galleryUrl, options.quality, { cookie });
  let lastReport = 0;
  const result = await downloadArchive(directUrl, outputPath, {
    cookie,
    overwrite: options.overwrite,
    resume: options.resume,
    retries: nonNegativeInteger(options.retries, "--retries"),
    timeoutMs: positiveSeconds(options.timeout, "--timeout") * 1000,
    onProgress(downloaded, total) {
      if (downloaded - lastReport < 1024 * 1024 && total !== downloaded) return;
      lastReport = downloaded;
      const suffix = total ? ` / ${(total / 1024 / 1024).toFixed(1)} MiB` : "";
      process.stderr.write(`${progressPrefix}已下载 ${(downloaded / 1024 / 1024).toFixed(1)} MiB${suffix}\n`);
    }
  });
  if (result === "downloaded") process.stdout.write(`${outputPath}\n`);
  return { status: result, outputPath, galleryUrl };
}

async function writeReport(path: string, report: BatchReport): Promise<void> {
  const reportPath = resolve(path);
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stderr.write(`批量报告已写入：${reportPath}\n`);
}

async function runBatch(references: string[], options: BatchCommandOptions, source: string): Promise<void> {
  const concurrency = nonNegativeInteger(options.concurrency, "--concurrency");
  if (concurrency < 1 || concurrency > 8) throw new Error("--concurrency 必须是 1 到 8 的整数");
  const delayMs = positiveSeconds(options.delay, "--delay") * 1000;
  if (!references.length) throw new Error("没有可下载的 URL。");

  const entries: BatchEntry[] = new Array(references.length);
  let next = 0;
  let nextStartAt = 0;
  async function waitForStart(): Promise<void> {
    const startAt = Math.max(Date.now(), nextStartAt);
    nextStartAt = startAt + delayMs;
    const remaining = startAt - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, references.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= references.length) return;
      const reference = references[index];
      const prefix = `[${index + 1}/${references.length}] `;
      try {
        await waitForStart();
        const result = await downloadOne(reference, options, prefix);
        entries[index] = { reference, galleryUrl: result.galleryUrl, outputPath: result.outputPath, status: result.status };
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        entries[index] = { reference, status: "failed", error: message };
        process.stderr.write(`${prefix}失败：${message}\n`);
      }
    }
  }));

  const downloaded = entries.filter((entry) => entry.status === "downloaded").length;
  const skipped = entries.filter((entry) => entry.status === "skipped").length;
  const failed = entries.filter((entry) => entry.status === "failed").length;
  if (options.report) await writeReport(options.report, {
    format: "eharchive-batch-report-v1",
    createdAt: new Date().toISOString(),
    source,
    entries
  });
  process.stderr.write(`批量完成：下载 ${downloaded}，跳过 ${skipped}，失败 ${failed}。\n`);
  if (failed) process.exitCode = 1;
}

qualityOption(program.command("download <gallery-url>").description("下载单个图库归档；可使用完整 URL 或 ID/Token"))
  .option("-n, --name <filename>", "ZIP 文件名")
  .action(async (galleryUrl: string, options: DownloadCommandOptions) => {
    await downloadOne(galleryUrl, options);
  });

qualityOption(program.command("batch <list-file>").description("按文本文件中的图库链接批量下载；每行一个链接或 ID/Token，# 开头为注释"))
  .option("-c, --concurrency <count>", "并发任务数", "2")
  .option("--delay <seconds>", "两次任务启动之间的最小间隔秒数", "1")
  .option("--report <path>", "写入 JSON 格式的批量报告")
  .action(async (listFile: string, options: BatchCommandOptions) => {
    const references = [...new Set((await readFile(listFile, "utf8")).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")))];
    await runBatch(references, options, listFile);
  });

qualityOption(program.command("retry <report-file>").description("仅重试批量报告中失败的项目"))
  .option("-c, --concurrency <count>", "并发任务数", "2")
  .option("--delay <seconds>", "两次任务启动之间的最小间隔秒数", "1")
  .option("--report <path>", "写入新的 JSON 格式批量报告")
  .action(async (reportFile: string, options: BatchCommandOptions) => {
    const report: unknown = JSON.parse(await readFile(reportFile, "utf8"));
    const entries = report && typeof report === "object" ? (report as { entries?: unknown }).entries : undefined;
    if (!Array.isArray(entries)) throw new Error("不是有效的 eharchive 批量报告。");
    const references = entries
      .filter((entry): entry is { reference: unknown; status: unknown } => Boolean(entry) && typeof entry === "object")
      .filter((entry): entry is { reference: string; status: "failed" } => entry.status === "failed" && typeof entry.reference === "string")
      .map((entry) => entry.reference);
    await runBatch(references, options, reportFile);
  });

const config = program.command("config").description("管理本机 Cookie 配置（Cookie 不会打印到终端）");
config.command("set-cookie")
  .description("从环境变量、本地文件或标准输入保存 Cookie")
  .option("--cookie-env <variable>", "环境变量名", "EH_COOKIE")
  .option("--cookie-file <path>", "Cookie 的 UTF-8 文件")
  .option("--stdin", "从标准输入读取 Cookie，适合通过管道传入")
  .action(async (options: { cookieEnv: string; cookieFile?: string; stdin?: boolean }) => {
    if (options.stdin && options.cookieFile) throw new Error("--stdin 和 --cookie-file 不能同时使用。");
    const cookie = options.stdin
      ? await readStandardInput()
      : options.cookieFile
        ? (await readFile(options.cookieFile, "utf8")).trim()
        : process.env[options.cookieEnv]?.trim();
    if (!cookie) throw new Error(`未找到 Cookie。请先设置 ${options.cookieEnv}，或使用 --cookie-file / --stdin。`);
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

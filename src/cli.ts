#!/usr/bin/env node
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { Command } from "commander";
import { AdaptiveLimiter, type AdaptiveEvent, type AdaptiveSnapshot } from "./adaptive.js";
import { clearCookie, defaultConfigPath, loadConfig, normalizeCookieInput, saveCookie, saveProxy } from "./config.js";
import { downloadArchive, getGalleryPreview, listFavorites, normalizeGalleryUrl, resolveArchive, searchGalleries, type ArchiveKind, type GalleryPreview } from "./core.js";
import { useProxySetting } from "./proxy.js";

type CookieCommandOptions = {
  cookieEnv: string;
  cookieFile?: string;
};

type CookieCandidate = {
  value: string;
  source: "file" | "environment" | "config";
};

type DownloadCommandOptions = CookieCommandOptions & {
  quality: ArchiveKind;
  out: string;
  name?: string;
  overwrite?: boolean;
  resume: boolean;
  retries: string;
  timeout: string;
};

type BatchCommandOptions = DownloadCommandOptions & {
  concurrency: string;
  delay: string;
  adaptive: boolean;
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
  adaptive: AdaptiveSnapshot;
  entries: BatchEntry[];
};

type PreviewCommandOptions = CookieCommandOptions & {
  images: string;
  out: string;
  json?: boolean;
};

const program = new Command();
program
  .name("eharchive")
  .description("下载你有权访问的图库归档 ZIP")
  .version("0.9.2")
  .option("--config <path>", "本机 Cookie 配置文件路径", defaultConfigPath())
  .option("--no-proxy", "不使用系统或环境代理，改为直接连接")
  .showHelpAfterError();

let networkConfigured = false;
const networkCommands = new Set(["download", "batch", "retry", "list", "search", "preview"]);
program.hook("preAction", async (_thisCommand, actionCommand) => {
  if (!networkCommands.has(actionCommand.name())) return;
  if (networkConfigured) return;
  networkConfigured = true;
  if (program.opts().proxy === false) return;
  const configured = await loadConfig(program.opts().config);
  useProxySetting(configured.proxy ?? "system");
});

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

async function findCookie(options: CookieCommandOptions): Promise<CookieCandidate | undefined> {
  if (options.cookieFile) {
    const cookie = (await readFile(options.cookieFile, "utf8")).trim();
    if (cookie) return { value: cookie, source: "file" };
    throw new Error("Cookie 文件为空。");
  }
  const fromEnvironment = process.env[options.cookieEnv]?.trim();
  if (fromEnvironment) return { value: fromEnvironment, source: "environment" };
  const configured = await loadConfig(program.opts().config);
  if (configured.cookie) return { value: configured.cookie, source: "config" };
  return undefined;
}

function normalizeCandidate(candidate: CookieCandidate): string {
  try {
    return normalizeCookieInput(candidate.value);
  } catch (error) {
    if (candidate.source === "config") return "";
    throw error;
  }
}

async function findOptionalCookie(options: CookieCommandOptions): Promise<string | undefined> {
  const candidate = await findCookie(options);
  return candidate ? normalizeCandidate(candidate) || undefined : undefined;
}

async function readHiddenInput(prompt: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY) {
    throw new Error("未检测到已保存的 Cookie，且当前不是可交互终端。请先运行 `eharchive config set-cookie --stdin`，或使用 --cookie-file。");
  }
  process.stderr.write(prompt);
  const input = process.stdin;
  const previousRawMode = input.isRaw;
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");
  return new Promise((resolvePromise, reject) => {
    let value = "";
    let submitTimer: NodeJS.Timeout | undefined;
    const finish = () => {
      if (submitTimer) clearTimeout(submitTimer);
      input.off("data", onData);
      input.setRawMode(previousRawMode);
      process.stderr.write("\n");
    };
    const scheduleSubmit = () => {
      if (submitTimer) clearTimeout(submitTimer);
      // Pasted multi-line data can arrive as one or several quick terminal chunks.
      // Waiting briefly after Enter preserves the complete paste while normal typing stays simple.
      submitTimer = setTimeout(() => {
        finish();
        resolvePromise(value.trim());
      }, 150);
    };
    const onData = (chunk: string) => {
      if (submitTimer) clearTimeout(submitTimer);
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          value += "\n";
          scheduleSubmit();
          continue;
        }
        if (character === "\u0003" || character === "\u0004") {
          finish();
          reject(new Error("已取消 Cookie 配置。"));
          return;
        }
        if (character === "\b" || character === "\u007f") {
          value = value.slice(0, -1);
          continue;
        }
        if (character !== "\u0000") value += character;
      }
    };
    input.on("data", onData);
  });
}

async function promptAndSaveCookie(): Promise<string> {
  const configPath = program.opts().config;
  process.stderr.write(`未检测到已保存的 Cookie。配置将保存到 ${configPath}；此位置独立于 npm 安装目录，升级不会删除它。\n`);
  process.stderr.write("请依次输入浏览器 Cookie 中对应字段的值；每项输入都不会回显，也不会写入命令历史。\n");
  const memberId = await readHiddenInput("ipb_member_id: ");
  const passHash = await readHiddenInput("ipb_pass_hash: ");
  const igneous = await readHiddenInput("igneous（可选，直接按 Enter 跳过）: ");
  const normalizedCookie = normalizeCookieInput([
    `ipb_member_id=${memberId}`,
    `ipb_pass_hash=${passHash}`,
    igneous ? `igneous=${igneous}` : ""
  ].filter(Boolean).join("; "));
  await saveCookie(configPath, normalizedCookie);
  process.stderr.write("Cookie 已安全保存；后续命令会自动使用该配置。\n");
  return normalizedCookie;
}

async function getCookie(options: CookieCommandOptions): Promise<string> {
  const candidate = await findCookie(options);
  if (candidate) {
    const cookie = normalizeCandidate(candidate);
    if (cookie) return cookie;
    process.stderr.write("已保存的 Cookie 不完整，将重新引导配置。\n");
  }
  return promptAndSaveCookie();
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

function favoritesOptions(command: Command): Command {
  return command
    .option("--cookie-env <variable>", "临时 Cookie 的环境变量名", "EH_COOKIE")
    .option("--cookie-file <path>", "临时 Cookie 的 UTF-8 文件")
    .option("-c, --category <0-9>", "收藏夹编号（0 到 9）")
    .option("--pages <count>", "读取的最多页数", "1")
    .option("--all", "读取全部页面（最多 100 页）")
    .option("--search <keyword>", "按名称、标签和笔记搜索")
    .option("--site <site>", "e-hentai 或 exhentai", "e-hentai")
    .option("--json", "以 JSON 输出")
    .option("--export <path>", "导出为可传给 batch 的 ID/Token 清单");
}

function searchOptions(command: Command): Command {
  return command
    .option("--cookie-env <variable>", "可选的 Cookie 环境变量名", "EH_COOKIE")
    .option("--cookie-file <path>", "可选的 Cookie UTF-8 文件")
    .option("--pages <count>", "预览的最多页数", "1")
    .option("--site <site>", "e-hentai 或 exhentai", "e-hentai")
    .option("--title-only", "只搜索标题，不搜索标签")
    .option("--description", "同时搜索描述")
    .option("--torrents", "同时搜索种子名称")
    .option("--min-rating <0-5>", "最低评分")
    .option("--min-pages <count>", "最少页数")
    .option("--max-pages <count>", "最多页数")
    .option("--json", "以 JSON 输出")
    .option("--export <path>", "导出为可传给 batch 的 ID/Token 清单");
}

function previewOptions(command: Command): Command {
  return command
    .option("--cookie-env <variable>", "Optional Cookie environment variable", "EH_COOKIE")
    .option("--cookie-file <path>", "Optional UTF-8 Cookie file")
    .option("--images <count>", "Number of default thumbnails to show (1-20)", "20")
    .option("-o, --out <path>", "Output HTML path", "previews")
    .option("--json", "Print preview metadata as JSON without writing HTML");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] ?? character);
}

function previewFilename(galleryUrl: string): string {
  const parts = new URL(galleryUrl).pathname.split("/").filter(Boolean);
  return `${parts[1] ?? "gallery"}.html`;
}

function previewHtml(preview: GalleryPreview): string {
  const cover = preview.coverUrl
    ? `<img class="cover" src="${escapeHtml(preview.coverUrl)}" alt="${escapeHtml(preview.title)} cover" loading="eager">`
    : "";
  const cards = preview.thumbnails.map((thumbnail) => `
    <a class="thumb" href="${escapeHtml(thumbnail.pageUrl)}" target="_blank" rel="noopener noreferrer">
      <img src="${escapeHtml(thumbnail.thumbnailUrl)}" alt="${escapeHtml(thumbnail.label)}" loading="lazy">
      <span>${thumbnail.page}</span>
    </a>`).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(preview.title)}</title>
<style>body{margin:0 auto;max-width:1200px;padding:24px;font:16px system-ui,sans-serif;background:#161616;color:#eee}header{display:flex;gap:20px;align-items:start;margin-bottom:24px}.cover{width:180px;max-height:260px;object-fit:cover;border-radius:8px;background:#292929}h1{font-size:1.35rem;margin:0 0 10px;line-height:1.35}p{color:#bbb;margin:0}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}.thumb{position:relative;display:block;aspect-ratio:3/2;background:#292929;border-radius:6px;overflow:hidden}.thumb img{width:100%;height:100%;object-fit:cover;display:block}.thumb span{position:absolute;right:6px;bottom:6px;padding:2px 6px;border-radius:4px;background:#000b;color:#fff;font-size:.8rem}@media(max-width:560px){body{padding:16px}header{gap:14px}.cover{width:120px;max-height:180px}}</style></head>
<body><header>${cover}<div><h1>${escapeHtml(preview.title)}</h1><p>Cover and the first ${preview.thumbnails.length} default gallery thumbnails. Images are referenced remotely; this file contains no Cookie.</p></div></header><main class="grid">${cards}</main></body></html>\n`;
}

function reportAdaptiveEvent(event: AdaptiveEvent): void {
  if (event.kind === "reduced") {
    process.stderr.write(`检测到限流或超时，自动降至并发 ${event.concurrency}，冷却 ${(event.cooldownMs / 1000).toFixed(1)} 秒。\n`);
  } else {
    process.stderr.write(`下载恢复稳定，自动升至并发 ${event.concurrency}。\n`);
  }
}

async function runBatch(references: string[], options: BatchCommandOptions, source: string): Promise<void> {
  const concurrency = nonNegativeInteger(options.concurrency, "--concurrency");
  if (concurrency < 1 || concurrency > 8) throw new Error("--concurrency 必须是 1 到 8 的整数");
  const delayMs = positiveSeconds(options.delay, "--delay") * 1000;
  if (!references.length) throw new Error("没有可下载的 URL。");

  const entries: BatchEntry[] = new Array(references.length);
  let next = 0;
  const limiter = new AdaptiveLimiter(concurrency, delayMs, options.adaptive);

  await Promise.all(Array.from({ length: Math.min(concurrency, references.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= references.length) return;
      const reference = references[index];
      const prefix = `[${index + 1}/${references.length}] `;
      await limiter.acquire();
      try {
        const result = await downloadOne(reference, options, prefix);
        entries[index] = { reference, galleryUrl: result.galleryUrl, outputPath: result.outputPath, status: result.status };
        const event = limiter.succeeded();
        if (event) reportAdaptiveEvent(event);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        entries[index] = { reference, status: "failed", error: message };
        process.stderr.write(`${prefix}失败：${message}\n`);
        const event = limiter.failed(message);
        if (event) reportAdaptiveEvent(event);
      } finally {
        limiter.release();
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
    adaptive: limiter.snapshot(),
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
  .option("--no-adaptive", "关闭遇到限流或超时时自动降速")
  .option("--report <path>", "写入 JSON 格式的批量报告")
  .action(async (listFile: string, options: BatchCommandOptions) => {
    const references = [...new Set((await readFile(listFile, "utf8")).split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")))];
    await runBatch(references, options, listFile);
  });

qualityOption(program.command("retry <report-file>").description("仅重试批量报告中失败的项目"))
  .option("-c, --concurrency <count>", "并发任务数", "2")
  .option("--delay <seconds>", "两次任务启动之间的最小间隔秒数", "1")
  .option("--no-adaptive", "关闭遇到限流或超时时自动降速")
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

const favorites = program.command("favorites").description("查看当前账号的云端收藏");
favoritesOptions(favorites.command("list").description("查看当前账号的云端收藏；可导出为批量下载清单"))
  .action(async (options: CookieCommandOptions & { category?: string; pages: string; all?: boolean; search?: string; site: string; json?: boolean; export?: string }) => {
    const category = options.category === undefined ? undefined : nonNegativeInteger(options.category, "--category");
    if (category !== undefined && category > 9) throw new Error("--category 必须是 0 到 9 的整数");
    const pages = options.all ? 100 : nonNegativeInteger(options.pages, "--pages");
    if (pages < 1 || pages > 100) throw new Error("--pages 必须是 1 到 100 的整数");
    const cookie = await getCookie(options);
    const result = await listFavorites({
      cookie,
      category,
      pages,
      search: options.search,
      site: options.site as "e-hentai" | "exhentai"
    });
    if (options.export) {
      const outputPath = resolve(options.export);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, result.items.map((item) => `${item.id}/${item.token}`).join("\n") + (result.items.length ? "\n" : ""), "utf8");
      process.stderr.write(`已导出 ${result.items.length} 项到：${outputPath}\n`);
    }
    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return;
    }
    if (result.categories.length) {
      process.stdout.write(`收藏夹：${result.categories.map((item) => `${item.slot}:${item.name} (${item.count})`).join("；")}\n`);
    }
    for (const item of result.items) process.stdout.write(`${item.id}/${item.token}\t${item.title}\n`);
    process.stderr.write(`已读取 ${result.pagesFetched} 页、${result.items.length} 项${result.nextPage ? "；还有下一页，可提高 --pages 或使用 --all" : ""}。\n`);
  });

searchOptions(program.command("search <query>").description("搜索图库并预览结果；不会自动下载"))
  .action(async (query: string, options: CookieCommandOptions & { pages: string; site: string; titleOnly?: boolean; description?: boolean; torrents?: boolean; minRating?: string; minPages?: string; maxPages?: string; json?: boolean; export?: string }) => {
    const optionalNumber = (value: string | undefined, option: string): number | undefined => value === undefined ? undefined : nonNegativeInteger(value, option);
    const result = await searchGalleries({
      query,
      cookie: await findOptionalCookie(options),
      pages: nonNegativeInteger(options.pages, "--pages"),
      site: options.site as "e-hentai" | "exhentai",
      title: !options.titleOnly,
      tags: !options.titleOnly,
      description: options.description,
      torrents: options.torrents,
      minRating: optionalNumber(options.minRating, "--min-rating"),
      minPages: optionalNumber(options.minPages, "--min-pages"),
      maxPages: optionalNumber(options.maxPages, "--max-pages")
    });
    if (options.export) {
      const outputPath = resolve(options.export);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, result.items.map((item) => `${item.id}/${item.token}`).join("\n") + (result.items.length ? "\n" : ""), "utf8");
      process.stderr.write(`已导出 ${result.items.length} 项到：${outputPath}\n`);
    }
    if (options.json) {
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return;
    }
    for (const item of result.items) process.stdout.write(`${item.id}/${item.token}\t${item.title}\n`);
    process.stderr.write(`已预览 ${result.pagesFetched} 页、${result.items.length} 项。\n`);
  });

const config = program.command("config").description("管理本机 Cookie 配置（Cookie 不会打印到终端）");
previewOptions(program.command("preview <gallery-url>").description("Create a local HTML preview with the cover and first 20 default thumbnails"))
  .action(async (galleryUrl: string, options: PreviewCommandOptions) => {
    const images = nonNegativeInteger(options.images, "--images");
    if (images < 1 || images > 20) throw new Error("--images must be an integer from 1 to 20.");
    const preview = await getGalleryPreview(galleryUrl, { cookie: await findOptionalCookie(options) }, images);
    if (options.json) {
      process.stdout.write(JSON.stringify(preview, null, 2) + "\n");
      return;
    }
    const requestedPath = resolve(options.out);
    const outputPath = requestedPath.toLowerCase().endsWith(".html") ? requestedPath : resolve(requestedPath, previewFilename(preview.galleryUrl));
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, previewHtml(preview), "utf8");
    process.stdout.write(`${outputPath}\n`);
  });

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
    if (!cookie) {
      await promptAndSaveCookie();
      return;
    }
    await saveCookie(program.opts().config, cookie);
    process.stdout.write(`Cookie 已保存到 ${program.opts().config}\n`);
  });
config.command("set-proxy <mode-or-url>")
  .description("持久化代理：system、direct 或 HTTP(S) 代理地址")
  .action(async (modeOrUrl: string) => {
    const proxy = await saveProxy(program.opts().config, modeOrUrl);
    process.stdout.write(`代理已保存为 ${proxy}\n`);
  });
config.command("show").description("显示配置状态，不会显示 Cookie 内容").action(async () => {
  const configured = await loadConfig(program.opts().config);
  const cookieValid = configured.cookie ? Boolean(normalizeCandidate({ value: configured.cookie, source: "config" })) : false;
  process.stdout.write(JSON.stringify({ path: program.opts().config, cookieConfigured: cookieValid, proxy: configured.proxy ?? "system" }, null, 2) + "\n");
});
config.command("clear").description("删除已保存的 Cookie").action(async () => {
  await clearCookie(program.opts().config);
  process.stdout.write("已删除本机 Cookie 配置。\n");
});

program.parseAsync().catch((error: Error) => {
  process.stderr.write(`错误：${error.message}\n`);
  process.exitCode = 1;
});

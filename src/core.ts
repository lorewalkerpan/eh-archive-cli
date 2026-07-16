import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export type ArchiveKind = "original" | "resampled";

export interface ResolveOptions {
  cookie?: string;
  userAgent?: string;
}

export interface DownloadOptions extends ResolveOptions {
  onProgress?: (downloaded: number, total?: number) => void;
  overwrite?: boolean;
  resume?: boolean;
  retries?: number;
  timeoutMs?: number;
}

const defaultUserAgent = "eh-archive-cli (+https://github.com/lorewalkerpan/eh-archive-cli)";
const galleryHosts = new Set(["e-hentai.org", "exhentai.org"]);

function decodeHtml(value: string): string {
  return value.replace(/&amp;/gi, "&").replace(/&#x27;/gi, "'").replace(/&quot;/gi, '"');
}

function absoluteUrl(value: string, base: string): string {
  const url = new URL(decodeHtml(value), base);
  if (url.protocol !== "https:") throw new Error("Only HTTPS archive URLs are supported");
  return url.toString();
}

function isGalleryHost(url: URL): boolean {
  return galleryHosts.has(url.hostname.toLowerCase());
}

function assertGalleryUrl(url: URL): void {
  if (!isGalleryHost(url)) throw new Error("Gallery URLs must use e-hentai.org or exhentai.org.");
  if (!/^\/g\/\d+\/[a-z0-9]+\/?$/i.test(url.pathname)) {
    throw new Error("Gallery URL must have the form https://e-hentai.org/g/ID/Token/.");
  }
}

/** Converts the compact `gallery-id/token` form into a normal gallery URL. */
export function normalizeGalleryUrl(value: string): string {
  const input = value.trim();
  const compact = /^(\d+)\/([a-z0-9]+)\/?$/i.exec(input);
  if (compact) return `https://e-hentai.org/g/${compact[1]}/${compact[2]}/`;
  if (/^\d+$/.test(input)) {
    throw new Error("A gallery ID also needs its Token. Use ID/Token, for example 2724315/34536084b4.");
  }
  const url = new URL(absoluteUrl(input, input));
  assertGalleryUrl(url);
  return url.toString();
}

function requestHeaders(options: ResolveOptions, requestUrl: string, referer?: string): Headers {
  const headers = new Headers({ "user-agent": options.userAgent ?? defaultUserAgent });
  // Cookies are only sent to the trusted gallery hosts. Signed ZIP URLs do not need them.
  if (options.cookie && isGalleryHost(new URL(requestUrl))) headers.set("cookie", options.cookie);
  if (referer) headers.set("referer", referer);
  return headers;
}

async function getText(url: string, options: ResolveOptions, referer?: string): Promise<{ html: string; url: string }> {
  const response = await fetch(url, { headers: requestHeaders(options, url, referer), redirect: "follow" });
  if (!response.ok) throw new Error(`Request failed (${response.status}) for ${new URL(url).pathname}`);
  const finalUrl = response.url;
  const path = new URL(finalUrl).pathname.toLowerCase();
  if (path.endsWith("bounce_login.php") || path.endsWith("login.php")) {
    throw new Error("The site redirected to login. Set an authorized Cookie via --cookie-env or --cookie-file.");
  }
  return { html: await response.text(), url: finalUrl };
}

export function parseArchivePageUrl(html: string, baseUrl: string): string | undefined {
  const direct = /<a[^>]*onclick=["']return\s+popUp\(['"]([^'"]+)['"][^>]*>\s*Archive\s+Download\s*<\/a>/i.exec(html);
  if (direct) return absoluteUrl(direct[1], baseUrl);
  const fallback = /popUp\(['"]([^'"]*archiver\.php[^'"]*)['"]/i.exec(html);
  return fallback ? absoluteUrl(fallback[1], baseUrl) : undefined;
}

export function parseArchiveOffer(html: string, baseUrl: string, kind: ArchiveKind): string | undefined {
  const forms = html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi);
  for (const form of forms) {
    const [, attributes, contents] = form;
    const dltype = /<input\b[^>]*\bname=["']dltype["'][^>]*\bvalue=["']([^'"]+)["']/i.exec(contents)?.[1];
    if ((kind === "original" && dltype !== "org") || (kind === "resampled" && dltype !== "res")) continue;
    const action = /\baction=["']([^'"]+)["']/i.exec(attributes)?.[1];
    if (action) return absoluteUrl(action, baseUrl);
  }
  return undefined;
}

export function parseContinuationUrl(html: string, baseUrl: string): string | undefined {
  const match = /document\.location\s*=\s*["']([^"']+)["']/i.exec(html);
  return match ? absoluteUrl(match[1], baseUrl) : undefined;
}

export function parseDirectUrl(html: string, baseUrl: string): string | undefined {
  const anchors = html.matchAll(/<a\b[^>]*\bhref=["']([^'"]+)["'][^>]*>([\s\S]*?)<\/a>/gi);
  for (const anchor of anchors) {
    if (/start\s+downloading/i.test(anchor[2].replace(/<[^>]+>/g, " "))) return absoluteUrl(anchor[1], baseUrl);
  }
  return undefined;
}

export async function resolveArchive(galleryUrl: string, kind: ArchiveKind, options: ResolveOptions = {}): Promise<string> {
  const normalizedGalleryUrl = normalizeGalleryUrl(galleryUrl);
  const gallery = await getText(normalizedGalleryUrl, options, normalizedGalleryUrl);
  const archivePage = parseArchivePageUrl(gallery.html, gallery.url);
  if (!archivePage) throw new Error("No Archive Download entry was found on the gallery page.");

  const archive = await getText(archivePage, options, gallery.url);
  const offerUrl = parseArchiveOffer(archive.html, archive.url, kind);
  if (!offerUrl) throw new Error(`No ${kind} archive offer was found. Your account may lack permission or credits.`);

  const origin = new URL(offerUrl).origin;
  const post = await fetch(offerUrl, {
    method: "POST",
    headers: new Headers({
      ...Object.fromEntries(requestHeaders(options, offerUrl, archivePage)),
      origin,
      "content-type": "application/x-www-form-urlencoded"
    }),
    body: new URLSearchParams({
      dltype: kind === "original" ? "org" : "res",
      dlcheck: kind === "original" ? "Download Original Archive" : "Download Resample Archive"
    }),
    redirect: "follow"
  });
  if (!post.ok) throw new Error(`Archive request failed (${post.status}).`);
  const continuation = parseContinuationUrl(await post.text(), post.url);
  if (!continuation) throw new Error("The archive service did not return a continuation URL.");

  const completed = await getText(continuation, options, offerUrl);
  const directUrl = parseDirectUrl(completed.html, completed.url);
  if (!directUrl) throw new Error("The archive service did not return a direct ZIP URL.");
  return directUrl;
}

export type DownloadResult = "downloaded" | "skipped";

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function totalFromResponse(response: Response, offset: number): number | undefined {
  const contentRange = response.headers.get("content-range");
  const rangedTotal = /\/([0-9]+)$/.exec(contentRange ?? "")?.[1];
  if (rangedTotal) return Number(rangedTotal);
  const contentLength = response.headers.get("content-length");
  return contentLength && /^\d+$/.test(contentLength) ? offset + Number(contentLength) : undefined;
}

async function fetchDownloadWithRetry(url: string, headers: Headers, retries: number, timeoutMs: number): Promise<{ response: Response; clearTimeout: () => void }> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { headers, redirect: "follow", signal: controller.signal });
      if (!isRetryableStatus(response.status) || attempt === retries) {
        return { response, clearTimeout: () => clearTimeout(timer) };
      }
      clearTimeout(timer);
      await response.body?.cancel();
      await delay(500 * 2 ** attempt);
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (attempt === retries) break;
      await delay(500 * 2 ** attempt);
    }
  }
  throw new Error(`ZIP download request failed after ${retries + 1} attempt(s): ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function downloadArchive(directUrl: string, outputPath: string, options: DownloadOptions = {}): Promise<DownloadResult> {
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.part`;
  if (await exists(outputPath) && !options.overwrite) return "skipped";

  const retries = options.retries ?? 3;
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isInteger(retries) || retries < 0) throw new Error("Retry count must be a non-negative integer.");
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000) throw new Error("Timeout must be at least 1000 milliseconds.");

  if (options.resume === false) await rm(temporaryPath, { force: true });
  let offset = options.resume === false ? 0 : (await exists(temporaryPath) ? (await stat(temporaryPath)).size : 0);
  const headers = requestHeaders(options, directUrl);
  if (offset > 0) headers.set("range", `bytes=${offset}-`);
  let request = await fetchDownloadWithRetry(directUrl, headers, retries, timeoutMs);

  // Some hosts ignore or reject Range. Start a clean file instead of appending a duplicate ZIP.
  if (offset > 0 && (request.response.status === 200 || request.response.status === 416)) {
    request.clearTimeout();
    await rm(temporaryPath, { force: true });
    offset = 0;
    request = await fetchDownloadWithRetry(directUrl, requestHeaders(options, directUrl), retries, timeoutMs);
  }
  if (!request.response.ok || !request.response.body) {
    request.clearTimeout();
    throw new Error(`ZIP download failed (${request.response.status}).`);
  }

  const total = totalFromResponse(request.response, offset);
  let downloaded = offset;
  const source = Readable.fromWeb(request.response.body as never);
  source.on("data", (chunk: Buffer) => {
    downloaded += chunk.length;
    options.onProgress?.(downloaded, total);
  });
  try {
    await pipeline(source, createWriteStream(temporaryPath, { flags: offset > 0 ? "a" : "w" }));
    request.clearTimeout();
    if (await exists(outputPath)) await rm(outputPath, { force: true });
    await rename(temporaryPath, outputPath);
    return "downloaded";
  } catch (error) {
    request.clearTimeout();
    throw error;
  }
}

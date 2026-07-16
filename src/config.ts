import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface StoredConfig {
  cookie?: string;
  proxy?: string;
}

/** Converts browser/devtools Cookie text into a single HTTP Cookie header value. */
export function normalizeCookieInput(input: string): string {
  let value = input.trim();
  if (!value) throw new Error("Cookie is empty.");

  if (value.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed && typeof parsed === "object" && typeof (parsed as { cookie?: unknown }).cookie === "string") {
        return normalizeCookieInput((parsed as { cookie: string }).cookie);
      }
    } catch {
      // Treat non-JSON input as plain Cookie text below.
    }
  }

  const pairs = new Map<string, string>();
  for (let segment of value.split(/[;\r\n]+/)) {
    segment = segment.trim().replace(/^cookie\s*:\s*/i, "");
    if (!segment) continue;
    const match = /^([!#$%&'*+\-.^_`|~0-9A-Za-z]+)\s*(?:=|:)\s*(.*?)\s*$/.exec(segment);
    if (!match) continue;
    const [, name, rawValue] = match;
    const cookieValue = rawValue.trim().replace(/^['"]|['"]$/g, "");
    if (!cookieValue || /^null$/i.test(cookieValue)) continue;
    pairs.set(name, cookieValue);
  }

  if (!pairs.has("ipb_member_id") || !pairs.has("ipb_pass_hash")) {
    throw new Error("Cookie must include both ipb_member_id and ipb_pass_hash. Paste the complete Cookie, not a single field.");
  }
  return [...pairs.entries()].map(([name, cookieValue]) => `${name}=${cookieValue}`).join("; ");
}

export function defaultConfigPath(): string {
  const base = process.env.APPDATA || process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "eharchive", "config.json");
}

export async function loadConfig(path: string): Promise<StoredConfig> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object") return {};
    const cookie = (parsed as { cookie?: unknown }).cookie;
    const proxy = (parsed as { proxy?: unknown }).proxy;
    return {
      ...(typeof cookie === "string" && cookie.trim() ? { cookie: cookie.trim() } : {}),
      ...(typeof proxy === "string" && proxy.trim() ? { proxy: proxy.trim() } : {})
    };
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "ENOENT") return {};
    throw new Error(`Cannot read config file: ${path}`);
  }
}

export function normalizeProxySetting(value: string): string {
  const setting = value.trim();
  if (setting === "system" || setting === "direct") return setting;
  let url: URL;
  try {
    url = new URL(setting);
  } catch {
    throw new Error("Proxy must be system, direct, or an HTTP(S) proxy URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Proxy URL must use http:// or https://.");
  }
  return url.toString();
}

async function writeConfig(path: string, config: StoredConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.part`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
  // On POSIX this limits the file to its owner. Windows keeps the user's AppData ACL.
  await chmod(path, 0o600);
}

export async function saveCookie(path: string, cookie: string): Promise<void> {
  const normalizedCookie = normalizeCookieInput(cookie);
  await writeConfig(path, { ...(await loadConfig(path)), cookie: normalizedCookie });
}

export async function saveProxy(path: string, proxy: string): Promise<string> {
  const normalizedProxy = normalizeProxySetting(proxy);
  await writeConfig(path, { ...(await loadConfig(path)), proxy: normalizedProxy });
  return normalizedProxy;
}

export async function clearCookie(path: string): Promise<void> {
  const config = await loadConfig(path);
  if (config.proxy) {
    await writeConfig(path, { proxy: config.proxy });
    return;
  }
  await rm(path, { force: true });
}

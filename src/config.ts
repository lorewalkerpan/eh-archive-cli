import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface StoredConfig {
  cookie?: string;
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
    return typeof cookie === "string" && cookie.trim() ? { cookie: cookie.trim() } : {};
  } catch (error: unknown) {
    if ((error as { code?: string }).code === "ENOENT") return {};
    throw new Error(`Cannot read config file: ${path}`);
  }
}

export async function saveCookie(path: string, cookie: string): Promise<void> {
  const normalizedCookie = normalizeCookieInput(cookie);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.part`;
  await writeFile(temporary, `${JSON.stringify({ cookie: normalizedCookie }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
  // On POSIX this limits the file to its owner. Windows keeps the user's AppData ACL.
  await chmod(path, 0o600);
}

export async function clearCookie(path: string): Promise<void> {
  await rm(path, { force: true });
}

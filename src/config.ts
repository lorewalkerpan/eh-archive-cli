import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface StoredConfig {
  cookie?: string;
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
  if (!cookie.trim()) throw new Error("Cookie is empty.");
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.part`;
  await writeFile(temporary, `${JSON.stringify({ cookie: cookie.trim() }, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

export async function clearCookie(path: string): Promise<void> {
  await rm(path, { force: true });
}

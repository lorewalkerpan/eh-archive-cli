import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export type LogLevel = "simple" | "verbose" | "none";

let currentLevel: LogLevel = "simple";
let currentPath = "";

export function defaultLogPath(configPath: string): string {
  return join(dirname(configPath), "eharchive.log");
}

export function normalizeLogLevel(value: string): LogLevel {
  const level = value.trim().toLowerCase();
  if (level === "simple" || level === "verbose" || level === "none") return level;
  throw new Error("Log level must be simple, verbose, or none.");
}

export function configureLogging(configPath: string, level: LogLevel = "simple"): void {
  currentLevel = level;
  currentPath = defaultLogPath(configPath);
  if (currentLevel !== "none") mkdirSync(dirname(currentPath), { recursive: true });
}

function redact(value: string): string {
  return value.replace(/(ipb_member_id|ipb_pass_hash|igneous|cookie)=([^;\s]+)/gi, "$1=<redacted>");
}

function write(level: "INFO" | "DEBUG" | "ERROR", message: string): void {
  if (currentLevel === "none" || (level === "DEBUG" && currentLevel !== "verbose") || !currentPath) return;
  try {
    appendFileSync(currentPath, `${new Date().toISOString()} [${level}] ${redact(message)}\n`, "utf8");
  } catch {
    // Logging must never make the requested command fail.
  }
}

export function logInfo(message: string): void {
  write("INFO", message);
}

export function logDebug(message: string): void {
  write("DEBUG", message);
}

export function logError(message: string): void {
  write("ERROR", message);
}

export function safeUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}

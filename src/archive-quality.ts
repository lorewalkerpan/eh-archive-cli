import type { ArchiveKind } from "./core.js";

export type ArchiveQuality = ArchiveKind | "auto";

export function parseArchiveQuality(value: string): ArchiveQuality {
  if (value === "original" || value === "resampled" || value === "auto") return value;
  throw new Error("--quality 必须是 original、resampled 或 auto");
}

export function archiveAttempts(quality: ArchiveQuality): ArchiveKind[] {
  return quality === "auto" ? ["original", "resampled"] : [quality];
}

export function sanitizeArchiveTitle(title: string): string {
  const cleaned = title
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return (cleaned || "Untitled gallery").slice(0, 180);
}

export function defaultArchiveFilename(galleryUrl: string, kind: ArchiveKind, title: string): string {
  const parts = new URL(galleryUrl).pathname.split("/").filter(Boolean);
  return `${sanitizeArchiveTitle(title)} [${parts[1] ?? "archive"}] [${kind}].zip`;
}

export function canFallBackToResampled(error: unknown): boolean {
  return error instanceof Error && /^No original archive offer was found\./.test(error.message);
}

import type { ArchiveKind } from "./core.js";

export type ArchiveQuality = ArchiveKind | "auto";

export function parseArchiveQuality(value: string): ArchiveQuality {
  if (value === "original" || value === "resampled" || value === "auto") return value;
  throw new Error("--quality 必须是 original、resampled 或 auto");
}

export function archiveAttempts(quality: ArchiveQuality): ArchiveKind[] {
  return quality === "auto" ? ["original", "resampled"] : [quality];
}

export function defaultArchiveFilename(galleryUrl: string, kind: ArchiveKind): string {
  const parts = new URL(galleryUrl).pathname.split("/").filter(Boolean);
  return `${parts[1] ?? "archive"} [${kind}].zip`;
}

export function canFallBackToResampled(error: unknown): boolean {
  return error instanceof Error && /^No original archive offer was found\./.test(error.message);
}

import assert from "node:assert/strict";
import test from "node:test";
import { archiveAttempts, canFallBackToResampled, defaultArchiveFilename, parseArchiveQuality } from "../src/archive-quality.js";

test("recognizes archive quality choices and auto fallback order", () => {
  assert.equal(parseArchiveQuality("original"), "original");
  assert.equal(parseArchiveQuality("resampled"), "resampled");
  assert.equal(parseArchiveQuality("auto"), "auto");
  assert.throws(() => parseArchiveQuality("small"), /original、resampled 或 auto/);
  assert.deepEqual(archiveAttempts("original"), ["original"]);
  assert.deepEqual(archiveAttempts("resampled"), ["resampled"]);
  assert.deepEqual(archiveAttempts("auto"), ["original", "resampled"]);
});

test("uses bracketed quality in default archive names", () => {
  assert.equal(defaultArchiveFilename("https://e-hentai.org/g/2724315/34536084b4/", "original"), "2724315 [original].zip");
  assert.equal(defaultArchiveFilename("https://exhentai.org/g/8/token/", "resampled"), "8 [resampled].zip");
});

test("only falls back when the original archive offer is unavailable", () => {
  assert.equal(canFallBackToResampled(new Error("No original archive offer was found. Your account may lack permission or credits.")), true);
  assert.equal(canFallBackToResampled(new Error("fetch failed")), false);
  assert.equal(canFallBackToResampled(new Error("Archive request failed (403).")), false);
});

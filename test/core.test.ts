import assert from "node:assert/strict";
import test from "node:test";
import { parseArchiveOffer, parseArchivePageUrl, parseContinuationUrl, parseDirectUrl } from "../src/core.js";

test("parses the archive popup URL", () => {
  const html = `<a onclick="return popUp('https://example.test/archiver.php?gid=1&amp;token=x',480,320)">Archive Download</a>`;
  assert.equal(parseArchivePageUrl(html, "https://example.test/g/1/x"), "https://example.test/archiver.php?gid=1&token=x");
});

test("parses original and resampled form actions", () => {
  const html = `<form action="/archiver.php?gid=1&amp;token=x"><input type="hidden" name="dltype" value="org"><input type="submit" name="dlcheck" value="Download Original Archive"></form><form action="/archiver.php?gid=1&amp;token=x"><input type="hidden" name="dltype" value="res"></form>`;
  assert.equal(parseArchiveOffer(html, "https://example.test/archiver.php", "original"), "https://example.test/archiver.php?gid=1&token=x");
  assert.equal(parseArchiveOffer(html, "https://example.test/archiver.php", "resampled"), "https://example.test/archiver.php?gid=1&token=x");
});

test("parses continuation and direct ZIP URLs", () => {
  assert.equal(parseContinuationUrl(`<script>document.location = "/continue/1"</script>`, "https://example.test/archiver.php"), "https://example.test/continue/1");
  assert.equal(parseDirectUrl(`<a href="/archive.zip">Click Here To Start Downloading</a>`, "https://example.test/continue/1"), "https://example.test/archive.zip");
});

import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { downloadArchive, normalizeGalleryUrl, parseArchiveOffer, parseArchivePageUrl, parseContinuationUrl, parseDirectUrl, parseFavoritesPage } from "../src/core.js";

test("accepts a compact gallery ID and Token", () => {
  assert.equal(normalizeGalleryUrl("2724315/34536084b4"), "https://e-hentai.org/g/2724315/34536084b4/");
  assert.throws(() => normalizeGalleryUrl("2724315"), /also needs its Token/);
  assert.throws(() => normalizeGalleryUrl("https://example.test/g/1/token/"), /must use e-hentai.org or exhentai.org/);
});

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

test("parses favorite categories, gallery references, and pagination", () => {
  const html = `
    <div class="fp" onclick="document.location='https://e-hentai.org/favorites.php?favcat=0'">
      <div>12</div><div class="i" title="Favorites 0"></div><div>Reading list</div>
    </div>
    <a href="/g/123/exampletoken/"><div class="gl4e glname"><div class="glink">Example &amp; Gallery</div></div></a>
    <a id="dnext" href="/favorites.php?favcat=0&amp;next=123-456">Next</a>`;
  const result = parseFavoritesPage(html, "https://e-hentai.org/favorites.php?favcat=0");
  assert.deepEqual(result.categories, [{ slot: 0, count: 12, name: "Reading list" }]);
  assert.deepEqual(result.items, [{
    id: "123",
    token: "exampletoken",
    url: "https://e-hentai.org/g/123/exampletoken/",
    title: "Example & Gallery"
  }]);
  assert.equal(result.nextPage, "https://e-hentai.org/favorites.php?favcat=0&next=123-456");
});

test("retries and resumes a ZIP download without forwarding the Cookie", async () => {
  let requests = 0;
  let cookieHeader: string | undefined;
  const server = createServer((request, response) => {
    requests += 1;
    cookieHeader = request.headers.cookie;
    assert.equal(request.headers.range, "bytes=6-");
    if (requests === 1) {
      response.writeHead(503).end();
      return;
    }
    response.writeHead(206, {
      "content-length": "5",
      "content-range": "bytes 6-10/11"
    }).end("world");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");

  const directory = await mkdtemp(join(tmpdir(), "eharchive-download-"));
  const output = join(directory, "archive.zip");
  await writeFile(`${output}.part`, "hello ");
  try {
    const result = await downloadArchive(`http://127.0.0.1:${address.port}/archive.zip`, output, {
      cookie: "member_id=secret",
      retries: 1,
      timeoutMs: 1_000
    });
    assert.equal(result, "downloaded");
    assert.equal(await readFile(output, "utf8"), "hello world");
    assert.equal(requests, 2);
    assert.equal(cookieHeader, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
    server.close();
  }
});

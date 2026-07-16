import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

function runCli(arguments_: string[]): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve("dist/src/cli.js"), ...arguments_], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stderr }));
  });
}

test("writes a report and retries only failed batch entries", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eharchive-cli-"));
  const list = join(directory, "list.txt");
  const report = join(directory, "report.json");
  const retryReport = join(directory, "retry-report.json");
  await writeFile(list, "https://example.test/g/1/token/\n");
  try {
    const batch = await runCli(["batch", list, "--delay", "0.01", "--report", report]);
    assert.equal(batch.code, 1);
    assert.match(batch.stderr, /失败/);
    const saved = JSON.parse(await readFile(report, "utf8")) as { entries: Array<{ reference: string; status: string; error?: string }> };
    assert.equal(saved.entries.length, 1);
    assert.equal(saved.entries[0].reference, "https://example.test/g/1/token/");
    assert.equal(saved.entries[0].status, "failed");
    assert.match(saved.entries[0].error ?? "", /must use e-hentai.org or exhentai.org/);

    const retry = await runCli(["retry", report, "--delay", "0.01", "--report", retryReport]);
    assert.equal(retry.code, 1);
    const retried = JSON.parse(await readFile(retryReport, "utf8")) as { entries: Array<{ reference: string; status: string }> };
    assert.deepEqual(retried.entries.map(({ reference, status }) => ({ reference, status })), [{ reference: "https://example.test/g/1/token/", status: "failed" }]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

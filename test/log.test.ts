import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configureLogging, defaultLogPath, logDebug, logInfo } from "../src/log.js";

test("writes simple and verbose logs without exposing Cookie values", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eharchive-log-"));
  const configPath = join(directory, "config.json");
  try {
    configureLogging(configPath, "simple");
    logInfo("command started cookie=ipb_pass_hash=secret");
    logDebug("request detail");
    let output = await readFile(defaultLogPath(configPath), "utf8");
    assert.match(output, /command started/);
    assert.doesNotMatch(output, /secret/);
    assert.doesNotMatch(output, /request detail/);

    configureLogging(configPath, "verbose");
    logDebug("request detail");
    output = await readFile(defaultLogPath(configPath), "utf8");
    assert.match(output, /request detail/);

    configureLogging(configPath, "none");
    logInfo("not written");
    assert.doesNotMatch(await readFile(defaultLogPath(configPath), "utf8"), /not written/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

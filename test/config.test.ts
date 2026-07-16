import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clearCookie, loadConfig, saveCookie } from "../src/config.js";

test("saves, loads, and clears a local cookie configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eharchive-config-"));
  const configPath = join(directory, "config.json");
  try {
    await saveCookie(configPath, "member_id=1; pass_hash=example");
    assert.deepEqual(await loadConfig(configPath), { cookie: "member_id=1; pass_hash=example" });

    await clearCookie(configPath);
    assert.deepEqual(await loadConfig(configPath), {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

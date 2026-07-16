import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clearCookie, loadConfig, normalizeCookieInput, normalizeProxySetting, saveCookie, saveProxy } from "../src/config.js";

test("saves, loads, and clears a local cookie configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eharchive-config-"));
  const configPath = join(directory, "config.json");
  try {
    await saveCookie(configPath, "ipb_member_id: 1\nipb_pass_hash: example\nigneous: null");
    assert.deepEqual(await loadConfig(configPath), { cookie: "ipb_member_id=1; ipb_pass_hash=example" });

    await clearCookie(configPath);
    assert.deepEqual(await loadConfig(configPath), {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("persists a proxy setting when Cookie data is cleared", async () => {
  const directory = await mkdtemp(join(tmpdir(), "eharchive-proxy-config-"));
  const configPath = join(directory, "config.json");
  try {
    await saveProxy(configPath, "http://127.0.0.1:7890");
    await saveCookie(configPath, "ipb_member_id=1; ipb_pass_hash=example");
    await clearCookie(configPath);
    assert.deepEqual(await loadConfig(configPath), { proxy: "http://127.0.0.1:7890/" });
    assert.equal(normalizeProxySetting("direct"), "direct");
    assert.throws(() => normalizeProxySetting("socks5://127.0.0.1:7890"), /http/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("normalizes JSON and rejects incomplete Cookie input", () => {
  assert.equal(
    normalizeCookieInput('{"cookie":"ipb_member_id: 1\\nipb_pass_hash: example\\nigneous: value"}'),
    "ipb_member_id=1; ipb_pass_hash=example; igneous=value"
  );
  assert.throws(() => normalizeCookieInput("ipb_member_id: 1"), /ipb_pass_hash/);
});

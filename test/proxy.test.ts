import assert from "node:assert/strict";
import test from "node:test";
import { resolveProxySettings, useProxySetting } from "../src/proxy.js";

test("uses ALL_PROXY when protocol-specific proxies are absent", () => {
  assert.deepEqual(resolveProxySettings({ ALL_PROXY: "http://127.0.0.1:7890", NO_PROXY: "localhost" }), {
    httpProxy: "http://127.0.0.1:7890",
    httpsProxy: "http://127.0.0.1:7890",
    noProxy: "localhost"
  });
});

test("prefers lower-case protocol proxy settings", () => {
  assert.deepEqual(resolveProxySettings({ HTTP_PROXY: "http://upper", http_proxy: "http://lower", HTTPS_PROXY: "http://secure" }), {
    httpProxy: "http://lower",
    httpsProxy: "http://secure",
    noProxy: undefined
  });
});

test("does not configure a dispatcher without a proxy", () => {
  assert.equal(resolveProxySettings({ NO_PROXY: "localhost" }), undefined);
});

test("direct persisted mode does not install a proxy dispatcher", () => {
  assert.equal(useProxySetting("direct", { HTTPS_PROXY: "http://127.0.0.1:7890" }), false);
});

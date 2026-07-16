import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

export type ProxySettings = {
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
};

type Environment = Record<string, string | undefined>;

function value(environment: Environment, lowerCaseName: string, upperCaseName: string): string | undefined {
  return environment[lowerCaseName]?.trim() || environment[upperCaseName]?.trim() || undefined;
}

/** Resolves common proxy variables, with ALL_PROXY as a fallback for both protocols. */
export function resolveProxySettings(environment: Environment = process.env): ProxySettings | undefined {
  const allProxy = value(environment, "all_proxy", "ALL_PROXY");
  const httpProxy = value(environment, "http_proxy", "HTTP_PROXY") ?? allProxy;
  const httpsProxy = value(environment, "https_proxy", "HTTPS_PROXY") ?? allProxy;
  const noProxy = value(environment, "no_proxy", "NO_PROXY");
  return httpProxy || httpsProxy ? { httpProxy, httpsProxy, noProxy } : undefined;
}

/** Configures Node's global fetch dispatcher before any network request is made. */
export function useEnvironmentProxy(environment: Environment = process.env): boolean {
  const settings = resolveProxySettings(environment);
  if (!settings) return false;
  setGlobalDispatcher(new EnvHttpProxyAgent(settings));
  return true;
}

/** Applies a persisted proxy mode: system, direct, or one HTTP(S) proxy URL. */
export function useProxySetting(setting: string, environment: Environment = process.env): boolean {
  if (setting === "direct") return false;
  if (setting === "system") return useEnvironmentProxy(environment);
  const noProxy = value(environment, "no_proxy", "NO_PROXY");
  setGlobalDispatcher(new EnvHttpProxyAgent({ httpProxy: setting, httpsProxy: setting, noProxy }));
  return true;
}

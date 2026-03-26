import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { normalizeSecretInput } from "openclaw/plugin-sdk/provider-auth";
import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";

export const DEFAULT_MEMOMIND_ENDPOINT = "http://localhost:8100";

type PluginEntryConfig =
  | {
      endpoint?: string;
      apiKey?: unknown;
    }
  | undefined;

function resolvePluginConfig(cfg?: OpenClawConfig): PluginEntryConfig {
  const pluginConfig = cfg?.plugins?.entries?.["memory-memomind"]?.config as PluginEntryConfig;
  if (pluginConfig && typeof pluginConfig === "object" && !Array.isArray(pluginConfig)) {
    return pluginConfig;
  }
  return undefined;
}

export function resolveMemomindEndpoint(cfg?: OpenClawConfig): string {
  const pluginConfig = resolvePluginConfig(cfg);
  const configured =
    (typeof pluginConfig?.endpoint === "string" ? pluginConfig.endpoint.trim() : "") ||
    normalizeSecretInput(process.env.MEMOMIND_ENDPOINT) ||
    "";
  return configured || DEFAULT_MEMOMIND_ENDPOINT;
}

export function resolveMemomindApiKey(cfg?: OpenClawConfig): string | undefined {
  const pluginConfig = resolvePluginConfig(cfg);
  return (
    normalizeSecretInput(
      normalizeResolvedSecretInputString({
        value: pluginConfig?.apiKey,
        path: "plugins.entries.memory-memomind.config.apiKey",
      }),
    ) ||
    normalizeSecretInput(process.env.MEMOMIND_API_KEY) ||
    undefined
  );
}

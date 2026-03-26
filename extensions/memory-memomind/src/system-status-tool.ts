import { Type } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk/agent-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import { MemomindClient } from "./client.js";

const SystemStatusToolSchema = Type.Object({}, { additionalProperties: false });

export function createSystemStatusTool(api: OpenClawPluginApi) {
  return {
    name: "system_status",
    label: "System Status (MemoMind)",
    description:
      "Get MemoMind system health and statistics. " +
      "Returns vault file count, workspace stats, index status, and service health. " +
      "Useful for checking if MemoMind is running and what data is available.",
    parameters: SystemStatusToolSchema,
    execute: async () => {
      const client = new MemomindClient(api.config);

      const [health, stats] = await Promise.all([
        client.healthCheck().catch(() => null),
        client.getSystemStats().catch(() => null),
      ]);

      if (!health && !stats) {
        return jsonResult({
          connected: false,
          message: "Cannot reach MemoMind service. Ensure it is running.",
        });
      }

      return jsonResult({
        connected: true,
        service: health?.service,
        version: health?.version,
        status: health?.status,
        vault: stats?.vault
          ? {
              file_count: stats.vault.file_count,
              categories: stats.vault.categories,
            }
          : undefined,
        workspace: stats?.workspace
          ? {
              path_count: stats.workspace.path_count,
              file_count: stats.workspace.file_count,
            }
          : undefined,
        index: health?.index,
      });
    },
  };
}

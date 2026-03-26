import { Type } from "@sinclair/typebox";
import { jsonResult, readStringParam } from "openclaw/plugin-sdk/agent-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import { MemomindClient } from "./client.js";

const MemoryIdentityToolSchema = Type.Object(
  {
    field: Type.Optional(
      Type.String({
        description:
          'Optional specific identity field to query (e.g., "name", "birthday", "allergies", "phone"). ' +
          "If omitted, returns general identity information.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createMemoryIdentityTool(api: OpenClawPluginApi) {
  return {
    name: "memory_identity",
    label: "Memory Identity (MemoMind)",
    description:
      "Query the user's personal identity information from MemoMind. " +
      "Use this to look up personal details like name, birthday, preferences, health info, etc.",
    parameters: MemoryIdentityToolSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const field = readStringParam(rawParams, "field");

      const query = field ? `我的${field}` : "我的个人基本信息";

      const client = new MemomindClient(api.config);
      const response = await client.searchUnified(query, { maxResults: 5 });

      // Filter results to identity-related info types
      const identityTypes = new Set(["IDENTITY", "HEALTH", "PREFERENCE", "EDUCATION", "CAREER"]);
      const identityResults = response.unified_results.filter(
        (r) => r.info_type && identityTypes.has(r.info_type),
      );

      // Fall back to all results if no identity-specific ones found
      const results = identityResults.length > 0 ? identityResults : response.unified_results;

      return jsonResult({
        results: results.map((r) => ({
          title: r.vault_file?.split("/").pop()?.replace(/\.md$/, "") ?? r.index_id,
          content: r.content,
          info_type: r.info_type,
          tags: r.tags,
        })),
        field_queried: field || "general",
      });
    },
  };
}

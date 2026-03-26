import { Type } from "@sinclair/typebox";
import { jsonResult, readStringParam } from "openclaw/plugin-sdk/agent-runtime";
import { optionalStringEnum } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import { MemomindClient } from "./client.js";

const MemoryIngestToolSchema = Type.Object(
  {
    content: Type.String({
      description:
        "Text content to save to the user's personal memory. " +
        "Can be facts, notes, preferences, or any personal information.",
    }),
    category: Type.Optional(
      Type.String({
        description:
          'Optional category hint for filing (e.g., "health", "work", "identity", "finance").',
      }),
    ),
    info_type: optionalStringEnum(
      [
        "IDENTITY",
        "FINANCE",
        "HEALTH",
        "TASK",
        "JOURNAL",
        "KNOWLEDGE",
        "PROJECT",
        "CONTACT",
        "PREFERENCE",
        "NOTE",
      ] as const,
      {
        description: "Information type classification for the ingested content.",
      },
    ),
    title: Type.Optional(
      Type.String({
        description: "Optional title for the memory entry. Auto-generated if omitted.",
      }),
    ),
    realm: optionalStringEnum(["work", "life", "personal", "private", "secret"] as const, {
      description: 'Privacy realm for the content (default: "personal").',
    }),
  },
  { additionalProperties: false },
);

export function createMemoryIngestTool(api: OpenClawPluginApi) {
  return {
    name: "memory_ingest",
    label: "Memory Ingest (MemoMind)",
    description:
      "Save information to the user's personal memory in MemoMind. " +
      "Use this when the user shares personal facts, preferences, or notes they want remembered. " +
      "Supports classification by info type and privacy realm.",
    parameters: MemoryIngestToolSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const content = readStringParam(rawParams, "content", { required: true });
      const category = readStringParam(rawParams, "category");
      const infoType = readStringParam(rawParams, "info_type");
      const title = readStringParam(rawParams, "title");
      const realm = readStringParam(rawParams, "realm");

      const client = new MemomindClient(api.config);
      const response = await client.ingestText(content, {
        category: category || undefined,
        infoType: infoType || undefined,
        title: title || undefined,
        realm: realm || undefined,
      });

      return jsonResult({
        success: response.success,
        vault_file: response.vault_file,
        message: response.message,
      });
    },
  };
}

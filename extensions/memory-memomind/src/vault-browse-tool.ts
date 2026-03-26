import { Type } from "@sinclair/typebox";
import { jsonResult, readStringParam } from "openclaw/plugin-sdk/agent-runtime";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import { MemomindClient } from "./client.js";

const VaultBrowseToolSchema = Type.Object(
  {
    category: Type.Optional(
      Type.String({
        description:
          "Filter vault files by category. " +
          'Common categories: "Identity", "Health", "Finance", "Tasks", "Preferences", "Knowledge", "Projects", "Contacts", "Notes", "Journal".',
      }),
    ),
  },
  { additionalProperties: false },
);

export function createVaultBrowseTool(api: OpenClawPluginApi) {
  return {
    name: "vault_browse",
    label: "Vault Browse (MemoMind)",
    description:
      "Browse the user's MemoMind vault files. " +
      "Lists stored memory files with their titles, categories, and snippets. " +
      "Useful for getting an overview of what the user has stored or finding specific records.",
    parameters: VaultBrowseToolSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const category = readStringParam(rawParams, "category");

      const client = new MemomindClient(api.config);
      const response = await client.getVaultFiles(category || undefined);

      return jsonResult({
        files: response.files.map((f) => ({
          title: f.title,
          path: f.path,
          category: f.category,
          confidence: f.confidence,
          updated_at: f.updatedAt,
          snippet: f.snippet,
        })),
        count: response.files.length,
        category_filter: category || "all",
      });
    },
  };
}

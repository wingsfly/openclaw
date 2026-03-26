import { Type } from "@sinclair/typebox";
import {
  jsonResult,
  readNumberParam,
  readStringParam,
  readStringArrayParam,
} from "openclaw/plugin-sdk/agent-runtime";
import { optionalStringEnum } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import { MemomindClient } from "./client.js";

const MemorySearchToolSchema = Type.Object(
  {
    query: Type.String({ description: "Natural language query to search personal memory." }),
    max_results: Type.Optional(
      Type.Number({
        description: "Maximum number of results to return (default: 5).",
        minimum: 1,
        maximum: 50,
      }),
    ),
    realm: optionalStringEnum(["work", "life", "personal", "private", "secret"] as const, {
      description: "Filter results by privacy realm. Omit to search all accessible realms.",
    }),
    search_targets: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Data layers to search across (default: all). Possible values: "vault", "workspace", "appdata".',
      }),
    ),
    mode: optionalStringEnum(["natural", "keyword", "semantic"] as const, {
      description:
        'Search mode (default: "natural"). Use "keyword" for exact matches, "semantic" for meaning-based.',
    }),
  },
  { additionalProperties: false },
);

export function createMemorySearchTool(api: OpenClawPluginApi) {
  return {
    name: "memory_search",
    label: "Memory Search (MemoMind)",
    description:
      "Search the user's personal memory and knowledge base stored in MemoMind. " +
      "Returns relevant notes, facts, and personal information matching the query. " +
      "Supports filtering by privacy realm and data layer.",
    parameters: MemorySearchToolSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const query = readStringParam(rawParams, "query", { required: true });
      const maxResults = readNumberParam(rawParams, "max_results", { integer: true }) ?? 5;
      const realm = readStringParam(rawParams, "realm");
      const searchTargets = readStringArrayParam(rawParams, "search_targets");
      const mode = readStringParam(rawParams, "mode");

      const client = new MemomindClient(api.config);
      const response = await client.searchUnified(query, {
        maxResults,
        realm: realm || undefined,
        searchTargets: searchTargets?.length ? searchTargets : undefined,
        mode: mode || undefined,
      });

      const results = response.unified_results.map((r) => ({
        title: r.vault_file?.split("/").pop()?.replace(/\.md$/, "") ?? r.index_id,
        content: r.content,
        score: r.score,
        data_layer: r.data_layer,
        info_type: r.info_type,
        tags: r.tags,
        vault_file: r.vault_file,
      }));

      return jsonResult({
        results,
        total_count: response.total_count,
        parsed_intent: response.parsed_intent,
        context_block: response.context_block?.formatted_text,
      });
    },
  };
}

import { Type } from "@sinclair/typebox";
import {
  jsonResult,
  readStringParam,
  readStringArrayParam,
} from "openclaw/plugin-sdk/agent-runtime";
import { stringEnum } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import { MemomindClient } from "./client.js";

const MemoryManageToolSchema = Type.Object(
  {
    action: stringEnum(["update", "archive", "merge", "relate"] as const, {
      description:
        "Memory management action to perform. " +
        '"update": modify an existing memory field. ' +
        '"archive": mark a memory as historical. ' +
        '"merge": consolidate multiple fragmented memories into one. ' +
        '"relate": establish a relationship link between two memories.',
    }),
    // update params
    file_path: Type.Optional(
      Type.String({ description: "Vault file path of the memory to update or archive." }),
    ),
    field: Type.Optional(
      Type.String({ description: 'Field name to update (for "update" action).' }),
    ),
    new_value: Type.Optional(
      Type.String({ description: 'New value for the field (for "update" action).' }),
    ),
    reason: Type.Optional(Type.String({ description: "Reason for the update or archive action." })),
    // merge params
    source_files: Type.Optional(
      Type.Array(Type.String(), {
        description: 'List of vault file paths to merge (for "merge" action).',
      }),
    ),
    title: Type.Optional(
      Type.String({ description: 'Title for the merged memory (for "merge" action).' }),
    ),
    merged_content: Type.Optional(
      Type.String({ description: 'Combined content for the merged memory (for "merge" action).' }),
    ),
    // relate params
    file_a: Type.Optional(
      Type.String({ description: 'First file in the relationship (for "relate" action).' }),
    ),
    file_b: Type.Optional(
      Type.String({ description: 'Second file in the relationship (for "relate" action).' }),
    ),
    relation_type: Type.Optional(
      Type.String({
        description:
          'Type of relationship between the two files (for "relate" action), e.g., "related_to", "depends_on", "contradicts".',
      }),
    ),
  },
  { additionalProperties: false },
);

export function createMemoryManageTool(api: OpenClawPluginApi) {
  return {
    name: "memory_manage",
    label: "Memory Manage (MemoMind)",
    description:
      "Actively manage the user's memories in MemoMind. Supports four actions: " +
      "update (modify a memory field), archive (mark as historical), " +
      "merge (consolidate fragmented memories), and relate (link two memories). " +
      "Use when the user corrects information, memories become outdated, or related topics should be connected.",
    parameters: MemoryManageToolSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const action = readStringParam(rawParams, "action", { required: true });

      const toolName = `memory_${action}`;
      const params: Record<string, unknown> = {};

      switch (action) {
        case "update":
          params.file_path = readStringParam(rawParams, "file_path", { required: true });
          params.field = readStringParam(rawParams, "field", { required: true });
          params.new_value = readStringParam(rawParams, "new_value", { required: true });
          params.reason = readStringParam(rawParams, "reason");
          break;
        case "archive":
          params.file_path = readStringParam(rawParams, "file_path", { required: true });
          params.reason = readStringParam(rawParams, "reason");
          break;
        case "merge":
          params.source_files = readStringArrayParam(rawParams, "source_files");
          params.title = readStringParam(rawParams, "title");
          params.merged_content = readStringParam(rawParams, "merged_content");
          break;
        case "relate":
          params.file_a = readStringParam(rawParams, "file_a", { required: true });
          params.file_b = readStringParam(rawParams, "file_b", { required: true });
          params.relation_type = readStringParam(rawParams, "relation_type") ?? "related_to";
          break;
        default:
          return jsonResult({ success: false, message: `Unknown action: ${action}` });
      }

      const client = new MemomindClient(api.config);
      const result = await client.executeMemoryTool(toolName, params);

      return jsonResult({
        success: result.success,
        action: result.action,
        message: result.message,
        affected_files: result.affected_files,
      });
    },
  };
}

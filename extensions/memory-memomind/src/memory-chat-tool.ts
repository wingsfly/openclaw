import { Type } from "@sinclair/typebox";
import { jsonResult, readStringParam } from "openclaw/plugin-sdk/agent-runtime";
import { optionalStringEnum } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import { MemomindClient } from "./client.js";

const MemoryChatToolSchema = Type.Object(
  {
    message: Type.String({
      description: "Message to send to MemoMind's conversational memory interface.",
    }),
    mode: optionalStringEnum(["auto", "retrieval", "ingest"] as const, {
      description:
        'Chat mode (default: "auto"). ' +
        '"retrieval": focus on searching existing memories. ' +
        '"ingest": focus on extracting and storing new information. ' +
        '"auto": let MemoMind decide based on message intent.',
    }),
    session_id: Type.Optional(
      Type.String({
        description:
          "Session ID to continue an existing conversation. Omit to start a new session.",
      }),
    ),
  },
  { additionalProperties: false },
);

export function createMemoryChatTool(api: OpenClawPluginApi) {
  return {
    name: "memory_chat",
    label: "Memory Chat (MemoMind)",
    description:
      "Chat with MemoMind's conversational memory interface. " +
      "MemoMind automatically extracts personal information from the conversation, " +
      "searches relevant memories for context, and can store new facts. " +
      "Returns the reply along with any extracted info and search results.",
    parameters: MemoryChatToolSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const message = readStringParam(rawParams, "message", { required: true });
      const mode = readStringParam(rawParams, "mode");
      const sessionId = readStringParam(rawParams, "session_id");

      const client = new MemomindClient(api.config);
      const response = await client.chat(message, {
        mode: mode || undefined,
        sessionId: sessionId || undefined,
      });

      return jsonResult({
        reply: response.reply,
        mode: response.mode,
        session_id: response.session_id,
        extracted_info: response.extracted_info,
        search_results: response.search_results.map((r) => ({
          title: r.title,
          snippet: r.snippet,
          score: r.score,
          info_type: r.info_type,
        })),
        pending_writes:
          response.pending_writes.length > 0
            ? response.pending_writes.map((w) => ({
                id: w.id,
                field: w.field,
                value: w.value,
                confidence: w.confidence,
              }))
            : undefined,
      });
    },
  };
}

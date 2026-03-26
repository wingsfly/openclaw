import { definePluginEntry, type AnyAgentTool } from "openclaw/plugin-sdk/core";
import type { MemoryPromptSectionBuilder } from "openclaw/plugin-sdk/memory-core";
import { createMemoryChatTool } from "./src/memory-chat-tool.js";
import { createMemoryIdentityTool } from "./src/memory-identity-tool.js";
import { createMemoryIngestTool } from "./src/memory-ingest-tool.js";
import { createMemoryManageTool } from "./src/memory-manage-tool.js";
import { createMemorySearchTool } from "./src/memory-search-tool.js";
import { createReminderTool } from "./src/reminder-tool.js";
import { createSystemStatusTool } from "./src/system-status-tool.js";
import { createVaultBrowseTool } from "./src/vault-browse-tool.js";

const buildPromptSection: MemoryPromptSectionBuilder = ({ availableTools }) => {
  const hasSearch = availableTools.has("memory_search");
  const hasIngest = availableTools.has("memory_ingest");
  const hasChat = availableTools.has("memory_chat");
  const hasIdentity = availableTools.has("memory_identity");
  const hasReminder = availableTools.has("reminder_manage");

  if (!hasSearch && !hasIngest && !hasChat) {
    return [];
  }

  const lines = [
    "## Memory — MemoMind",
    "You have a personal memory backend (MemoMind). Use MemoMind tools for ALL memory operations instead of writing to local files.",
    "",
  ];

  if (hasSearch || hasIdentity) {
    lines.push(
      "**Recall:** Before answering about personal info, preferences, prior decisions, dates, people, or tasks: " +
        (hasIdentity
          ? "run memory_identity for personal details, or memory_search for general queries."
          : "run memory_search.") +
        " If low confidence after search, say you checked.",
    );
  }

  if (hasIngest) {
    lines.push(
      "**Store:** When the user shares personal facts, preferences, or asks you to remember something: use memory_ingest with appropriate info_type (IDENTITY, FINANCE, HEALTH, TASK, PREFERENCE, etc.) and realm. Do NOT write to MEMORY.md or memory/ files.",
    );
  }

  if (hasChat) {
    lines.push(
      "**Chat:** Use memory_chat for conversational memory interaction — it automatically extracts and stores personal information from the conversation.",
    );
  }

  if (hasReminder) {
    lines.push(
      "**Reminders:** Use reminder_manage (create) for time-based reminders with ISO datetime trigger_at. Do NOT use cron or local file notes for personal reminders.",
    );
  }

  lines.push("");
  return lines;
};

export default definePluginEntry({
  id: "memory-memomind",
  name: "Memory (MemoMind)",
  description:
    "Personal memory management via MemoMind backend — search, ingest, chat, " +
    "manage memories, browse vault, reminders, and system status",
  kind: "memory",
  register(api) {
    api.registerMemoryPromptSection(buildPromptSection);

    api.registerTool(createMemorySearchTool(api) as AnyAgentTool);
    api.registerTool(createMemoryIngestTool(api) as AnyAgentTool);
    api.registerTool(createMemoryIdentityTool(api) as AnyAgentTool);
    api.registerTool(createMemoryManageTool(api) as AnyAgentTool);
    api.registerTool(createMemoryChatTool(api) as AnyAgentTool);
    api.registerTool(createReminderTool(api) as AnyAgentTool);
    api.registerTool(createVaultBrowseTool(api) as AnyAgentTool);
    api.registerTool(createSystemStatusTool(api) as AnyAgentTool);
  },
});

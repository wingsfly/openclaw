import { Type } from "@sinclair/typebox";
import {
  jsonResult,
  readStringParam,
  readStringArrayParam,
} from "openclaw/plugin-sdk/agent-runtime";
import { optionalStringEnum, stringEnum } from "openclaw/plugin-sdk/core";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-runtime";
import { MemomindClient } from "./client.js";

const ReminderToolSchema = Type.Object(
  {
    action: stringEnum(["create", "list"] as const, {
      description: '"create": create a new reminder. "list": list pending reminders.',
    }),
    // create params
    title: Type.Optional(
      Type.String({ description: 'Reminder title/description (required for "create").' }),
    ),
    trigger_at: Type.Optional(
      Type.String({
        description:
          'ISO 8601 datetime when the reminder should trigger (required for "create"). Example: "2026-04-01T09:00:00".',
      }),
    ),
    channels: Type.Optional(
      Type.Array(Type.String(), {
        description:
          'Delivery channels (default: ["desktop"]). Possible values: "desktop", "email", "telegram", "slack".',
      }),
    ),
    recurrence: optionalStringEnum(["daily", "weekly", "monthly"] as const, {
      description: "Optional recurrence pattern for the reminder.",
    }),
  },
  { additionalProperties: false },
);

export function createReminderTool(api: OpenClawPluginApi) {
  return {
    name: "reminder_manage",
    label: "Reminder (MemoMind)",
    description:
      "Create and list personal reminders via MemoMind. " +
      "Supports one-time and recurring reminders with multi-channel delivery.",
    parameters: ReminderToolSchema,
    execute: async (_toolCallId: string, rawParams: Record<string, unknown>) => {
      const action = readStringParam(rawParams, "action", { required: true });
      const client = new MemomindClient(api.config);

      if (action === "list") {
        const reminders = await client.listReminders();
        return jsonResult({
          reminders: reminders.map((r) => ({
            id: r.id,
            title: r.title,
            trigger_at: r.trigger_at,
            status: r.status,
            recurrence: r.recurrence,
            channels: r.channels,
          })),
          count: reminders.length,
        });
      }

      // create
      const title = readStringParam(rawParams, "title", { required: true });
      const triggerAt = readStringParam(rawParams, "trigger_at", { required: true });
      const channels = readStringArrayParam(rawParams, "channels");
      const recurrence = readStringParam(rawParams, "recurrence");

      const reminder = await client.createReminder(title, triggerAt, {
        channels: channels?.length ? channels : undefined,
        recurrence: recurrence || undefined,
      });

      return jsonResult({
        id: reminder.id,
        title: reminder.title,
        trigger_at: reminder.trigger_at,
        status: reminder.status,
        recurrence: reminder.recurrence,
        channels: reminder.channels,
      });
    },
  };
}

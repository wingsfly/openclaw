import { readFile } from "node:fs/promises";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { resolveMemomindApiKey, resolveMemomindEndpoint } from "./config.js";

// ── Search types ──

export interface MemomindSearchResult {
  index_id: string;
  content: string;
  score: number;
  data_layer: string;
  vault_file?: string;
  info_type?: string;
  tags?: string[];
}

export interface MemomindContextBlock {
  formatted_text: string;
  token_count: number;
}

export interface MemomindSearchResponse {
  unified_results: MemomindSearchResult[];
  parsed_intent?: Record<string, unknown>;
  context_block?: MemomindContextBlock;
  total_count: number;
  needs_confirmation?: MemomindSearchResult[];
}

// ── Ingest types ──

export interface MemomindIngestResponse {
  success: boolean;
  vault_file?: string;
  message: string;
}

// ── Chat types ──

export interface ChatMessageItem {
  role: string;
  content: string;
}

export interface ChatSearchResult {
  title: string;
  snippet: string;
  score: number;
  vault_file?: string;
  data_layer?: string;
  info_type?: string;
  tags?: string[];
}

export interface ExtractedInfoItem {
  field: string;
  value: string;
  info_type?: string;
  confidence: number;
}

export interface WriteActionItem {
  file: string;
  mode: string;
  status: string;
  message?: string;
}

export interface PendingWriteItem {
  id: string;
  field: string;
  value: string;
  info_type: string;
  confidence: number;
  suggested_file: string;
  suggested_mode: string;
}

export interface MemomindChatResponse {
  reply: string;
  mode: string;
  session_id?: string;
  search_results: ChatSearchResult[];
  extracted_info: ExtractedInfoItem[];
  write_actions: WriteActionItem[];
  pending_writes: PendingWriteItem[];
}

// ── Memory tool types ──

export interface MemoryToolResult {
  success: boolean;
  action: string;
  message: string;
  affected_files: string[];
}

// ── Reminder types ──

export interface ReminderItem {
  id: string;
  title: string;
  trigger_at: string;
  memory_id?: string;
  channels: string[];
  recurrence?: string;
  status: string;
  created_at: string;
  acknowledged_at?: string;
}

// ── Vault types ──

export interface VaultFileItem {
  id: string;
  title: string;
  path: string;
  layer: string;
  category: string;
  confidence: number;
  updatedAt: string;
  size: number;
  snippet: string;
  status?: Record<string, unknown>;
}

// ── System types ──

export interface MemomindHealthResponse {
  status: string;
  service: string;
  version: string;
  index?: Record<string, unknown>;
}

export interface MemomindStatsResponse {
  vault: {
    file_count: number;
    categories: string[];
    last_modified?: string;
  };
  workspace: {
    path_count: number;
    file_count: number;
    scopes: string[];
  };
  appdata: {
    entry_count: number;
    types: number;
  };
  resource: {
    type_count: number;
    total_size: number;
  };
  connected: boolean;
  index?: Record<string, unknown>;
}

/**
 * HTTP client for MemoMind service.
 */
export class MemomindClient {
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;

  constructor(cfg?: OpenClawConfig) {
    this.endpoint = resolveMemomindEndpoint(cfg);
    this.apiKey = resolveMemomindApiKey(cfg);
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      "X-MemoMind-Platform": "openclaw",
    };
    if (this.apiKey) {
      h["Authorization"] = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.endpoint}${path}`;
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`MemoMind API error ${response.status}: ${text}`);
    }
    return (await response.json()) as T;
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.endpoint}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== "") url.searchParams.set(k, v);
      }
    }
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: this.headers(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`MemoMind API error ${response.status}: ${text}`);
    }
    return (await response.json()) as T;
  }

  private async delete<T>(path: string): Promise<T> {
    const url = `${this.endpoint}${path}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: this.headers(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`MemoMind API error ${response.status}: ${text}`);
    }
    return (await response.json()) as T;
  }

  // ── Search ──

  async searchUnified(
    query: string,
    options?: {
      maxResults?: number;
      mode?: string;
      realm?: string;
      searchTargets?: string[];
    },
  ): Promise<MemomindSearchResponse> {
    return this.post<MemomindSearchResponse>("/search/unified", {
      query,
      mode: options?.mode ?? "natural",
      max_results: options?.maxResults ?? 10,
      ...(options?.realm ? { realm: options.realm } : {}),
      ...(options?.searchTargets ? { search_targets: options.searchTargets } : {}),
    });
  }

  // ── Ingest ──

  async ingestText(
    content: string,
    options?: {
      category?: string;
      infoType?: string;
      title?: string;
      realm?: string;
      tags?: string[];
    },
  ): Promise<MemomindIngestResponse> {
    return this.post<MemomindIngestResponse>("/ingest/text", {
      content,
      source: "openclaw",
      ...(options?.category ? { category: options.category } : {}),
      ...(options?.infoType ? { info_type: options.infoType } : {}),
      ...(options?.title ? { title: options.title } : {}),
      ...(options?.tags ? { tags: options.tags } : { tags: ["openclaw"] }),
      realm: options?.realm ?? "personal",
    });
  }

  async ingestWithAttachments(
    content: string,
    options?: {
      category?: string;
      infoType?: string;
      title?: string;
      realm?: string;
      tags?: string[];
      attachments?: string[];
    },
  ): Promise<MemomindIngestResponse> {
    if (!options?.attachments?.length) {
      return this.ingestText(content, options);
    }

    const url = `${this.endpoint}/ingest/text-with-attachments`;
    const formData = new FormData();
    formData.append("content", content);
    formData.append(
      "metadata",
      JSON.stringify({
        source: "openclaw",
        ...(options.infoType ? { info_type: options.infoType } : {}),
        ...(options.title ? { title: options.title } : {}),
        ...(options.realm ? { realm: options.realm } : {}),
        ...(options.category ? { category: options.category } : {}),
        ...(options.tags ? { tags: options.tags } : { tags: ["openclaw"] }),
      }),
    );

    for (const filePath of options.attachments) {
      try {
        const data = await readFile(filePath);
        const fileName = path.basename(filePath);
        const blob = new Blob([data]);
        formData.append("files", blob, fileName);
      } catch {
        // Skip files that can't be read
      }
    }

    const headers: Record<string, string> = {
      "X-MemoMind-Platform": "openclaw",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }
    // Note: Do NOT set Content-Type for FormData - fetch sets it automatically with boundary

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: formData,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`MemoMind API error ${response.status}: ${text}`);
    }
    return (await response.json()) as MemomindIngestResponse;
  }

  // ── Chat ──

  async chat(
    message: string,
    options?: {
      mode?: string;
      sessionId?: string;
      history?: ChatMessageItem[];
    },
  ): Promise<MemomindChatResponse> {
    return this.post<MemomindChatResponse>("/chat", {
      message,
      mode: options?.mode ?? "auto",
      ...(options?.sessionId ? { session_id: options.sessionId } : {}),
      ...(options?.history ? { history: options.history } : {}),
    });
  }

  // ── Memory Tools ──

  async executeMemoryTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<MemoryToolResult> {
    return this.post<MemoryToolResult>(`/memory/tools/${toolName}`, params);
  }

  // ── Reminders ──

  async listReminders(): Promise<ReminderItem[]> {
    return this.get<ReminderItem[]>("/reminders/pending");
  }

  async createReminder(
    title: string,
    triggerAt: string,
    options?: {
      channels?: string[];
      recurrence?: string;
    },
  ): Promise<ReminderItem> {
    return this.post<ReminderItem>("/reminders", {
      title,
      trigger_at: triggerAt,
      channels: options?.channels ?? ["desktop"],
      ...(options?.recurrence ? { recurrence: options.recurrence } : {}),
    });
  }

  // ── Vault ──

  async getVaultFiles(category?: string): Promise<{ files: VaultFileItem[]; category?: string }> {
    const params: Record<string, string> = {};
    if (category) params["category"] = category;
    return this.get("/vault/files", params);
  }

  // ── System ──

  async healthCheck(): Promise<MemomindHealthResponse> {
    return this.get<MemomindHealthResponse>("/health");
  }

  async getSystemStats(): Promise<MemomindStatsResponse> {
    return this.get<MemomindStatsResponse>("/system/stats");
  }
}

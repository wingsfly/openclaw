import path from "node:path";
import type { ImageContent } from "@mariozechner/pi-ai";
import { assertNoWindowsNetworkPath, safeFileURLToPath } from "../../../infra/local-file-access.js";
import { loadWebMedia } from "../../../media/web-media.js";
import { resolveUserPath } from "../../../utils.js";
import type { ImageSanitizationLimits } from "../../image-sanitization.js";
import {
  createSandboxBridgeReadFile,
  resolveSandboxedBridgeMediaPath,
} from "../../sandbox-media-paths.js";
import { assertSandboxPath } from "../../sandbox-paths.js";
import type { SandboxFsBridge } from "../../sandbox/fs-bridge.js";
import { sanitizeImageBlocks } from "../../tool-images.js";
import { log } from "../logger.js";

/**
 * Common image file extensions for detection.
 */
const IMAGE_EXTENSION_NAMES = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "tiff",
  "tif",
  "heic",
  "heif",
] as const;
const IMAGE_EXTENSIONS = new Set(IMAGE_EXTENSION_NAMES.map((ext) => `.${ext}`));
const IMAGE_EXTENSION_PATTERN = IMAGE_EXTENSION_NAMES.join("|");
const MEDIA_ATTACHED_PATH_REGEX_SOURCE =
  "^\\s*(.+?\\.(?:" + IMAGE_EXTENSION_PATTERN + "))\\s*(?:\\(|$|\\|)";
const MESSAGE_IMAGE_REGEX_SOURCE =
  "\\[Image:\\s*source:\\s*([^\\]]+\\.(?:" + IMAGE_EXTENSION_PATTERN + "))\\]";
const FILE_URL_REGEX_SOURCE = "file://[^\\s<>\"'`\\]]+\\.(?:" + IMAGE_EXTENSION_PATTERN + ")";
const PATH_REGEX_SOURCE =
  "(?:^|\\s|[\"'`(])((\\.\\.?/|[~/])[^\\s\"'`()\\[\\]]*\\.(?:" + IMAGE_EXTENSION_PATTERN + "))";

/**
 * Result of detecting an image reference in text.
 */
export interface DetectedImageRef {
  /** The raw matched string from the prompt */
  raw: string;
  /** The type of reference */
  type: "path";
  /** The resolved/normalized path */
  resolved: string;
}

/**
 * Checks if a file extension indicates an image file.
 */
function isImageExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext);
}

function normalizeRefForDedupe(raw: string): string {
  return process.platform === "win32" ? raw.toLowerCase() : raw;
}

async function sanitizeImagesWithLog(
  images: ImageContent[],
  label: string,
  imageSanitization?: ImageSanitizationLimits,
): Promise<ImageContent[]> {
  const { images: sanitized, dropped } = await sanitizeImageBlocks(
    images,
    label,
    imageSanitization,
  );
  if (dropped > 0) {
    log.warn(`Native image: dropped ${dropped} image(s) after sanitization (${label}).`);
  }
  return sanitized;
}

/**
 * Detects image references in a user prompt.
 *
 * Patterns detected:
 * - Absolute paths: /path/to/image.png
 * - Relative paths: ./image.png, ../images/photo.jpg
 * - Home paths: ~/Pictures/screenshot.png
 * - file:// URLs: file:///path/to/image.png
 * - Message attachments: [Image: source: /path/to/image.jpg]
 *
 * @param prompt The user prompt text to scan
 * @returns Array of detected image references
 */
export function detectImageReferences(prompt: string): DetectedImageRef[] {
  const refs: DetectedImageRef[] = [];
  const seen = new Set<string>();

  // Helper to add a path ref
  const addPathRef = (raw: string) => {
    const trimmed = raw.trim();
    const dedupeKey = normalizeRefForDedupe(trimmed);
    if (!trimmed || seen.has(dedupeKey)) {
      return;
    }
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      return;
    }
    if (!isImageExtension(trimmed)) {
      return;
    }
    try {
      assertNoWindowsNetworkPath(trimmed, "Image path");
    } catch {
      return;
    }
    seen.add(dedupeKey);
    const resolved = trimmed.startsWith("~") ? resolveUserPath(trimmed) : trimmed;
    refs.push({ raw: trimmed, type: "path", resolved });
  };

  // Pattern for [media attached: path (type) | url] or [media attached N/M: path (type) | url] format
  // Each bracket = ONE file. The | separates path from URL, not multiple files.
  // Multi-file format uses separate brackets on separate lines.
  const mediaAttachedPattern = /\[media attached(?:\s+\d+\/\d+)?:\s*([^\]]+)\]/gi;
  const mediaAttachedPathPattern = new RegExp(MEDIA_ATTACHED_PATH_REGEX_SOURCE, "i");
  const messageImagePattern = new RegExp(MESSAGE_IMAGE_REGEX_SOURCE, "gi");
  const fileUrlPattern = new RegExp(FILE_URL_REGEX_SOURCE, "gi");
  const pathPattern = new RegExp(PATH_REGEX_SOURCE, "gi");
  let match: RegExpExecArray | null;
  while ((match = mediaAttachedPattern.exec(prompt)) !== null) {
    const content = match[1];

    // Skip "[media attached: N files]" header lines
    if (/^\d+\s+files?$/i.test(content.trim())) {
      continue;
    }

    // Extract path before the (mime/type) or | delimiter
    // Format is: path (type) | url  OR  just: path (type)
    // Path may contain spaces (e.g., "ChatGPT Image Apr 21.png")
    // Use non-greedy .+? to stop at first image extension
    const pathMatch = content.match(mediaAttachedPathPattern);
    if (pathMatch?.[1]) {
      addPathRef(pathMatch[1].trim());
    }
  }

  // Pattern for [Image: source: /path/...] format from messaging systems
  while ((match = messageImagePattern.exec(prompt)) !== null) {
    const raw = match[1]?.trim();
    if (raw) {
      addPathRef(raw);
    }
  }

  // Remote HTTP(S) URLs are intentionally ignored. Native image injection is local-only.

  // Pattern for file:// URLs - treat as paths since loadWebMedia handles them
  while ((match = fileUrlPattern.exec(prompt)) !== null) {
    const raw = match[0];
    const dedupeKey = normalizeRefForDedupe(raw);
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    // Use fileURLToPath for proper handling (e.g., file://localhost/path)
    try {
      const resolved = safeFileURLToPath(raw);
      refs.push({ raw, type: "path", resolved });
    } catch {
      // Skip malformed file:// URLs
    }
  }

  // Pattern for file paths (absolute, relative, or home)
  // Matches:
  // - /absolute/path/to/file.ext (including paths with special chars like Messages/Attachments)
  // - ./relative/path.ext
  // - ../parent/path.ext
  // - ~/home/path.ext
  while ((match = pathPattern.exec(prompt)) !== null) {
    // Use capture group 1 (the path without delimiter prefix); skip if undefined
    if (match[1]) {
      addPathRef(match[1]);
    }
  }

  return refs;
}

/**
 * Loads an image from a file path and returns it as ImageContent.
 *
 * @param ref The detected image reference
 * @param workspaceDir The current workspace directory for resolving relative paths
 * @param options Optional settings for sandbox and size limits
 * @returns The loaded image content, or null if loading failed
 */
export async function loadImageFromRef(
  ref: DetectedImageRef,
  workspaceDir: string,
  options?: {
    maxBytes?: number;
    workspaceOnly?: boolean;
    sandbox?: { root: string; bridge: SandboxFsBridge };
  },
): Promise<ImageContent | null> {
  try {
    let targetPath = ref.resolved;

    // Resolve paths relative to sandbox or workspace as needed
    if (options?.sandbox) {
      try {
        const resolved = await resolveSandboxedBridgeMediaPath({
          sandbox: {
            root: options.sandbox.root,
            bridge: options.sandbox.bridge,
            workspaceOnly: options.workspaceOnly,
          },
          mediaPath: targetPath,
        });
        targetPath = resolved.resolved;
      } catch (err) {
        log.debug(
          `Native image: sandbox validation failed for ${ref.resolved}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    } else if (!path.isAbsolute(targetPath)) {
      targetPath = path.resolve(workspaceDir, targetPath);
    }
    if (options?.workspaceOnly && !options?.sandbox) {
      const root = options?.sandbox?.root ?? workspaceDir;
      await assertSandboxPath({
        filePath: targetPath,
        cwd: root,
        root,
      });
    }

    // loadWebMedia handles local file paths (including file:// URLs)
    const media = options?.sandbox
      ? await loadWebMedia(targetPath, {
          maxBytes: options.maxBytes,
          sandboxValidated: true,
          readFile: createSandboxBridgeReadFile({ sandbox: options.sandbox }),
        })
      : await loadWebMedia(targetPath, options?.maxBytes);

    if (media.kind !== "image") {
      log.debug(`Native image: not an image file: ${targetPath} (got ${media.kind})`);
      return null;
    }

    // EXIF orientation is already normalized by loadWebMedia -> resizeToJpeg
    // Default to JPEG since optimization converts images to JPEG format
    const mimeType = media.contentType ?? "image/jpeg";
    const data = media.buffer.toString("base64");

    return { type: "image", data, mimeType };
  } catch (err) {
    // Log the actual error for debugging (size limits, network failures, etc.)
    log.debug(
      `Native image: failed to load ${ref.resolved}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/**
 * Checks if a model supports image input based on its input capabilities.
 *
 * @param model The model object with input capability array
 * @returns True if the model supports image input
 */
export function modelSupportsImages(model: { input?: string[] }): boolean {
  return model.input?.includes("image") ?? false;
}

/**
 * Detects and loads images referenced in a prompt for models with vision capability.
 *
 * This function scans the prompt for image references (file paths and URLs),
 * loads them, and returns them as ImageContent array ready to be passed to
 * the model's prompt method.
 *
 * @param params Configuration for image detection and loading
 * @returns Object with loaded images for current prompt only
 */
export async function detectAndLoadPromptImages(params: {
  prompt: string;
  workspaceDir: string;
  model: { input?: string[] };
  existingImages?: ImageContent[];
  maxBytes?: number;
  maxDimensionPx?: number;
  workspaceOnly?: boolean;
  sandbox?: { root: string; bridge: SandboxFsBridge };
}): Promise<{
  /** Images for the current prompt (existingImages + detected in current prompt) */
  images: ImageContent[];
  detectedRefs: DetectedImageRef[];
  loadedCount: number;
  skippedCount: number;
}> {
  // If model doesn't support images, return empty results
  if (!modelSupportsImages(params.model)) {
    return {
      images: [],
      detectedRefs: [],
      loadedCount: 0,
      skippedCount: 0,
    };
  }

  // Detect images from current prompt
  const allRefs = detectImageReferences(params.prompt);

  if (allRefs.length === 0) {
    return {
      images: params.existingImages ?? [],
      detectedRefs: [],
      loadedCount: 0,
      skippedCount: 0,
    };
  }

  log.debug(`Native image: detected ${allRefs.length} image refs in prompt`);

  const promptImages: ImageContent[] = [...(params.existingImages ?? [])];

  let loadedCount = 0;
  let skippedCount = 0;

  for (const ref of allRefs) {
    const image = await loadImageFromRef(ref, params.workspaceDir, {
      maxBytes: params.maxBytes,
      workspaceOnly: params.workspaceOnly,
      sandbox: params.sandbox,
    });
    if (image) {
      promptImages.push(image);
      loadedCount++;
      log.debug(`Native image: loaded ${ref.type} ${ref.resolved}`);
    } else {
      skippedCount++;
    }
  }

  const imageSanitization: ImageSanitizationLimits = {
    maxDimensionPx: params.maxDimensionPx,
  };
  const sanitizedPromptImages = await sanitizeImagesWithLog(
    promptImages,
    "prompt:images",
    imageSanitization,
  );

  return {
    images: sanitizedPromptImages,
    detectedRefs: allRefs,
    loadedCount,
    skippedCount,
  };
}

/**
 * Persists base64 ImageContent entries to the OpenClaw media/inbound directory
 * so that tools (e.g., memory_ingest) can reference them as file paths.
 *
 * @returns Array of saved absolute file paths.
 */
export async function persistImagesToMedia(images: ImageContent[]): Promise<string[]> {
  if (!images.length) {
    return [];
  }
  try {
    const { randomUUID } = await import("node:crypto");
    const fs = await import("node:fs/promises");
    const { ensureMediaDir } = await import("../../../media/store.js");
    const mediaDir = await ensureMediaDir();
    const inboundDir = path.join(mediaDir, "inbound");
    await fs.mkdir(inboundDir, { recursive: true });

    const paths: string[] = [];
    for (const img of images) {
      const ext = (img.mimeType ?? "image/jpeg").split("/")[1] ?? "jpg";
      const fileName = `${randomUUID()}.${ext}`;
      const filePath = path.join(inboundDir, fileName);
      const buffer = Buffer.from(img.data, "base64");
      await fs.writeFile(filePath, buffer);
      paths.push(filePath);
      log.info(`Persisted image to ${filePath} (${buffer.length} bytes)`);
    }
    return paths;
  } catch (err) {
    log.warn(`Failed to persist images to media: ${String(err)}`);
    return [];
  }
}

/**
 * Resolves the image model configuration from OpenClaw config.
 * Returns { provider, model, baseUrl, apiKey } or null.
 */
async function resolveVisionModelFromConfig(
  config: import("../../../config/config.js").OpenClawConfig | undefined,
): Promise<{
  provider: string;
  model: string;
  baseUrl: string;
  apiKey?: string;
} | null> {
  if (!config) {
    return null;
  }

  // Read agents.defaults.imageModel.primary (e.g., "omlx/Qwen3.5-35B-A3B-8bit")
  const imageModelCfg = config.agents?.defaults?.imageModel;
  let primaryRef: string | undefined;
  if (typeof imageModelCfg === "string") {
    primaryRef = imageModelCfg;
  } else if (typeof imageModelCfg === "object" && imageModelCfg !== null) {
    primaryRef = (imageModelCfg as { primary?: string }).primary;
  }
  if (!primaryRef?.trim()) {
    return null;
  }

  const slashIdx = primaryRef.indexOf("/");
  if (slashIdx < 0) {
    return null;
  }
  const providerName = primaryRef.slice(0, slashIdx);
  const modelId = primaryRef.slice(slashIdx + 1);

  // Look up provider config for baseUrl and apiKey
  const providerCfg = config.models?.providers?.[providerName];
  if (!providerCfg || typeof providerCfg.baseUrl !== "string") {
    return null;
  }

  return {
    provider: providerName,
    model: modelId,
    baseUrl: providerCfg.baseUrl.replace(/\/+$/, ""),
    apiKey: typeof providerCfg.apiKey === "string" ? providerCfg.apiKey : undefined,
  };
}

/**
 * Describes images using a vision-capable fallback model when the primary model
 * does not support native image input.
 *
 * Directly calls the configured vision model via OpenAI-compatible API,
 * bypassing Pi's model registry to support custom providers.
 *
 * @returns Description text, or null if no vision model is available or on failure.
 */
export async function describeImagesForFallback(params: {
  images: ImageContent[];
  config: import("../../../config/config.js").OpenClawConfig | undefined;
  agentDir: string;
}): Promise<string | null> {
  if (!params.images.length) {
    return null;
  }

  try {
    const visionModel = await resolveVisionModelFromConfig(params.config);
    if (!visionModel) {
      log.debug("Vision fallback skipped: no image model configured");
      return null;
    }

    const imageContents = params.images.map((img) => ({
      type: "image_url" as const,
      image_url: {
        url: `data:${img.mimeType ?? "image/jpeg"};base64,${img.data}`,
      },
    }));

    const body = {
      model: visionModel.model,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "请详细描述这张图片的所有内容，包括文字、布局和关键信息。如果图片中包含对话，请逐条列出对话内容。如果包含待办事项或任务列表，请逐条列出。",
            },
            ...imageContents,
          ],
        },
      ],
      max_tokens: 4096,
      stream: false,
      // Disable thinking/reasoning for faster, direct responses
      chat_template_kwargs: { enable_thinking: false },
    };

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (visionModel.apiKey) {
      headers["Authorization"] = `Bearer ${visionModel.apiKey}`;
    }

    const url = `${visionModel.baseUrl}/chat/completions`;
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(`Vision API ${resp.status}: ${errText.slice(0, 200)}`);
    }

    const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    let text = json.choices?.[0]?.message?.content?.trim() ?? "";
    // Strip thinking tags (e.g., Qwen3.5 may wrap reasoning in <think>...</think>)
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!text) {
      throw new Error("Vision API returned empty response");
    }

    log.info(
      `Vision fallback: described ${params.images.length} image(s) via ${visionModel.provider}/${visionModel.model}`,
    );
    return text;
  } catch (err) {
    log.warn(`Vision fallback failed, proceeding without image description: ${String(err)}`);
    return null;
  }
}

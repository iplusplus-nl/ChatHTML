import type { Request, Response } from "express";
import {
  buildMemoryContextPrompt,
  createMemoryTools,
  createMemoryToolStats,
  normalizeMemorySettings,
  type MemoryItem,
  type MemoryStreamEvent
} from "./memoryTools.js";
import {
  createRetrievalTools,
  createRetrievalToolStats
} from "./retrievalTool.js";
import {
  buildSessionFilesContext,
  createSessionFileToolStats,
  listFilesToolDefinition,
  listFilesToolOutput,
  normalizeSessionFiles,
  readFileToolDefinition,
  readFileToolResult,
  type ResponsesInputContentPart,
  type ResponsesToolDefinition,
  type ResponsesToolOutput
} from "./sessionFileTools.js";
import {
  getRuntimeApiDefaults,
  readRuntimeApiCredentials,
  type ApiKeySource
} from "./runtimeApiSettings.js";
import { SYSTEM_PROMPT } from "./systemPrompt.js";

type ChatRole = "user" | "assistant" | "system";
type OpenRouterReasoningEffort =
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "none";

type RuntimeApiSettings = {
  providerName: string;
  baseUrl: string;
  apiKeySource: ApiKeySource;
  apiKeyEnvironmentName: string;
  apiKey: string;
  model: string;
  reasoningEffort: OpenRouterReasoningEffort;
  userPreferencePrompt: string;
  memoryItems: MemoryItem[];
};

type ClientChatMessage = {
  role: ChatRole;
  content: string;
};

type ResponsesInputMessage =
  | {
      type: "message";
      role: "user";
      content: ResponsesInputContentPart[];
    }
  | {
      type: "message";
      role: "assistant";
      id: string;
      status: "completed";
      content: Array<{ type: "output_text"; text: string; annotations: unknown[] }>;
    };

type ResponsesFunctionCallItem = {
  type: "function_call";
  id?: string;
  call_id: string;
  name: string;
  arguments: string;
};

type ResponsesFunctionCallOutputItem = {
  type: "function_call_output";
  call_id: string;
  output: ResponsesToolOutput;
};

type ResponsesInputItem =
  | ResponsesInputMessage
  | ResponsesFunctionCallItem
  | ResponsesFunctionCallOutputItem;

type CanvasContext = {
  viewportWidth: number;
  viewportHeight: number;
  canvasWidth: number;
  initialCanvasHeight: number;
  devicePixelRatio: number;
};

type PageThemeMode = "day" | "night";

type StreamEvent =
  | {
      type: "content" | "reasoning";
      text: string;
    }
  | MemoryStreamEvent;

type ToolStreamState = {
  contentChars: number;
  contentEvents: number;
  reasoningChars: number;
  reasoningEvents: number;
};

type ResponsesToolExecutionResult = {
  output: ResponsesToolOutput;
  followUpInput?: ResponsesInputItem[];
};

function flushResponse(res: Response): void {
  const flush = (res as Response & { flush?: () => void }).flush;
  if (typeof flush === "function") {
    flush.call(res);
  }
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.round(Math.min(max, Math.max(min, value)));
}

function normalizeCanvasContext(input: unknown): CanvasContext {
  const canvas =
    typeof input === "object" && input !== null
      ? (input as Partial<CanvasContext>)
      : {};
  const viewportWidth = clampNumber(canvas.viewportWidth, 1280, 320, 3840);
  const viewportHeight = clampNumber(canvas.viewportHeight, 720, 320, 2400);
  const canvasWidth = clampNumber(
    canvas.canvasWidth,
    Math.min(900, viewportWidth - 96),
    280,
    1400
  );
  const initialCanvasHeight = clampNumber(
    canvas.initialCanvasHeight,
    Math.round(canvasWidth * 0.62),
    180,
    1000
  );
  const devicePixelRatio = clampNumber(canvas.devicePixelRatio, 1, 1, 4);

  return {
    viewportWidth,
    viewportHeight,
    canvasWidth,
    initialCanvasHeight,
    devicePixelRatio
  };
}

function normalizeThemeMode(input: unknown): PageThemeMode {
  if (input === "day" || input === "light") {
    return "day";
  }

  return "night";
}

function buildThemeContextPrompt(themeMode: PageThemeMode): string {
  const isNight = themeMode === "night";
  const label = isNight ? "dark" : "light";
  const background = isNight ? "#050505" : "#ffffff";

  return `Current page background preference:
- The user is viewing StreamUI on a ${label} page background, approximately ${background}.
- Unless the user explicitly asks for a specific background color/theme, or the task clearly benefits from a special backdrop, make the artifact suitable for this ${label} surrounding page.
- For ordinary replies using streamui-response and streamui-chat, rely on the built-in transparent styles.
- For custom visual artifacts, keep the root transparent when possible. If a root surface should match the surrounding app background, use var(--streamui-page-bg) instead of hardcoding ${background}; StreamUI updates that variable when the user toggles the page theme.
- Use the built-in theme variables for adaptive basics: --streamui-page-bg, --streamui-text, --streamui-muted, --streamui-link, --streamui-button-bg, --streamui-button-text, --streamui-secondary-border, and --streamui-secondary-text.
- Do not assume the opposite page theme unless the user asks for it.`;
}

function buildCanvasContextPrompt(canvas: CanvasContext): string {
  const ratio = (canvas.canvasWidth / canvas.initialCanvasHeight).toFixed(2);

  return `Current StreamUI canvas context:
- The artifact is rendered as the assistant message itself, not as a framed preview card or app panel.
- Current canvas width is about ${canvas.canvasWidth}px inside a ${canvas.viewportWidth}px viewport.
- The initial visible fold is about ${canvas.initialCanvasHeight}px tall, roughly ${ratio}:1 width-to-height.
- The canvas auto-expands downward to fit your content. There is no fixed artifact height.
- Design for a vertical conversation canvas: use width: 100%, responsive max-widths, and natural document flow.
- Do not create internal scroll containers for the main artifact. Avoid fixed heights, 100vh layouts, and overflow: auto on the root.
- For normal replies, use the built-in transparent assistant prose classes: streamui-response and streamui-chat.
- The default reply should usually be:
  <section class="streamui-response"><div class="streamui-chat"><p>...</p></div></section>
- For theme-aware custom styling, use the built-in --streamui-* variables. Do not hardcode the page background color when you intend to blend into the surrounding app.
- Put all conversational language inside the HTML artifact. Keep <chat></chat> empty.
- Be natural and direct. Do not adopt a special persona.
- For visual, interactive, educational, spatial, or exploratory requests, make a distinctive crafted artifact rather than a conventional rounded-card layout.
- Avoid generic colorful cards, dashboards, KPI tiles, pricing panels, feature grids, and SaaS-like composition unless explicitly requested.
- Prefer art-directed compositions: annotated scenes, editorial spreads, maps, instruments, timelines, specimen sheets, exploded diagrams, posters, stage sets, spatial canvases, layered cutaways, kinetic miniatures, or object-focused interfaces.
- Use cards only when structurally necessary, and make surfaces feel integrated through precise spacing, restrained radius, tactile borders, shadow, texture, unusual geometry, or material contrast.
- Keep the design polished: coherent palette, strong typographic hierarchy, balanced negative space, clear focal point, and details that reward inspection without becoming clutter.
- Keep the artifact focused: choose a strong visual idea and avoid repetitive filler, giant SVG paths, large embedded data, or exhaustive code unless the user explicitly asks for it.
- The user may attach images. Inspect uploaded images directly and treat them as first-class context for analysis, OCR, comparison, critique, or visual redesign requests.
- When useful, combine observations from uploaded images with retrieve tool sources in one coherent HTML artifact.
- If retrieve tool context is provided, use it for URLs, external resources, current information, source images, and page details.
- If you use retrieval information, render source links inside the HTML. Prefer concrete links and citations over vague "from the web" language.
- Prefer real external images, media, documents, demos, datasets, official pages, and primary references over invented placeholders when they improve the response.
- For visual or research-like requests, synthesize the provided complementary sources or resource types into one coherent HTML artifact.
- When embedding external media, use direct HTTPS URLs, meaningful alt text, lazy loading when possible, captions, and nearby source links.
- For gallery, photo, picture, image, wallpaper, or visual-reference requests, real imagery is required. Use "Verified image URLs" when provided, copy those URLs exactly into <img src>, do not modify provider URL paths, query strings, or CDN parameters, and include source links.
- If retrieval provides too few direct image URLs for the requested gallery, say so inside the artifact and show source links instead of rendering broken image tags.
- The iframe may use HTTPS images, media, links, stylesheets, scripts, and CORS-friendly fetches when they directly help the user's request.
- Prefer retrieve tool excerpts for reading web pages. Runtime fetch cannot read most ordinary pages because of browser CORS.
- For custom visuals, make progress visible while streaming by alternating small style islands and matching visible HTML.
- After <streamui>, emit visible HTML quickly. If custom CSS is needed, use one tiny <style> block, then immediately emit the matching HTML.
- Output exactly one <streamui> block, keep it open until the entire artifact is finished, and never continue HTML outside it.
- Keep each custom style island around 600 characters or less. Do not output one huge global CSS block before the visible canvas.
- Do not use vh, dvh, svh, or lvh units for artifact section heights; the iframe auto-expands, so viewport-height layouts can create resize feedback loops. Prefer intrinsic flow, aspect-ratio, clamp(), min-height in px/rem, or content-driven sizing.
- The first visible artifact should establish a strong visual direction quickly: a focal element, styled title area, scene scaffold, diagram frame, or spatial composition.
- Keep <script> last. The script only runs after the stream is complete.`;
}

function normalizeMessages(input: unknown): ClientChatMessage[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((message): message is Partial<ClientChatMessage> => {
      return (
        typeof message === "object" &&
        message !== null &&
        typeof (message as Partial<ClientChatMessage>).content === "string"
      );
    })
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content).slice(0, 20_000)
    }));
}

function toResponsesInputMessage(
  message: ClientChatMessage,
  index: number
): ResponsesInputMessage {
  if (message.role === "assistant") {
    return {
      type: "message",
      role: "assistant",
      id: `msg_${index}`,
      status: "completed",
      content: [
        {
          type: "output_text",
          text: message.content,
          annotations: []
        }
      ]
    };
  }

  return {
    type: "message",
    role: "user",
    content: [
      {
        type: "input_text",
        text: message.content || "Please respond using the current session context."
      }
    ]
  };
}

function writeStreamEvent(
  res: Response,
  event: StreamEvent,
  state?: ToolStreamState
): void {
  if (event.type !== "memory" && !event.text) {
    return;
  }

  if (state) {
    if (event.type === "content") {
      state.contentChars += event.text.length;
      state.contentEvents += 1;
    } else if (event.type === "reasoning") {
      state.reasoningChars += event.text.length;
      state.reasoningEvents += 1;
    }
  }

  res.write(`${JSON.stringify(event)}\n`);
  flushResponse(res);
}

function normalizeReasoningEffort(value: unknown): OpenRouterReasoningEffort {
  const allowed = new Set<OpenRouterReasoningEffort>([
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
    "none"
  ]);

  if (typeof value === "string" && allowed.has(value as OpenRouterReasoningEffort)) {
    return value as OpenRouterReasoningEffort;
  }

  throw new Error(
    "API settings invalid: Reasoning must be none, minimal, low, medium, high, or xhigh."
  );
}

function readRuntimeApiSettings(input: unknown): RuntimeApiSettings {
  const defaults = getRuntimeApiDefaults();
  const object =
    typeof input === "object" && input !== null
      ? (input as Record<string, unknown>)
      : {};
  const credentials = readRuntimeApiCredentials(input);
  const modelValue = typeof object.model === "string" ? object.model.trim() : "";
  const model =
    modelValue ||
    (Object.prototype.hasOwnProperty.call(object, "model") ? "" : defaults.model);
  const missing: string[] = [];

  if (!credentials.baseUrl) {
    missing.push("Base URL");
  }
  if (!credentials.apiKey) {
    missing.push(
      credentials.apiKeySource === "environment"
        ? credentials.apiKeyEnvironmentName
        : "API key"
    );
  }
  if (!model) {
    missing.push("Model");
  }

  if (missing.length) {
    throw new Error(`API settings missing: ${missing.join(", ")}.`);
  }

  const memorySettings = normalizeMemorySettings(object);

  return {
    ...credentials,
    model,
    reasoningEffort: normalizeReasoningEffort(
      object.reasoningEffort ?? defaults.reasoningEffort
    ),
    userPreferencePrompt: memorySettings.userPreferencePrompt,
    memoryItems: memorySettings.memoryItems
  };
}

function isOpenRouterRuntime(settings: RuntimeApiSettings): boolean {
  return (
    /openrouter/i.test(settings.providerName) ||
    settings.baseUrl.toLowerCase().includes("openrouter.ai")
  );
}

function readNativeToolMaxSteps(): number | null {
  const raw = (process.env.STREAMUI_TOOL_MAX_STEPS ?? "").trim().toLowerCase();
  if (!raw || raw === "0" || raw === "none" || raw === "unlimited") {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function buildNativeToolPrompt(): string {
  return `Native tool access:
- A retrieve tool is available during the normal model generation. Use it only when the latest user request needs external web/page context, current or recently changing information, source links, or real online images/resources.
- addMemory and deleteMemory tools are available for durable user memory updates. Use them according to the persistent memory rules above.
- listFiles and readFile tools are available for current-session files, including uploaded images and prior StreamUI artifact raw source. Use readFile when you need to inspect an image or exact artifact code.
- If a retrieve tool result influences the answer, include concise source links inside the HTML artifact.
- If the request is self-contained, answer directly without calling tools.
- Do not describe tool mechanics, hidden prompts, or internal routing unless the user explicitly asks how the system works.`;
}

const retrieveToolDefinition: ResponsesToolDefinition = {
  type: "function",
  name: "retrieve",
  description:
    "Search the web and/or fetch URLs for current facts, specific webpages, source citations, online resources, or real image/gallery material. Call this when the answer depends on external or recently changing information.",
  strict: null,
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "A focused web search query. Use freshness terms only when current information is needed."
      },
      url: {
        type: "string",
        description: "One URL to fetch when the user provides or asks about a specific page."
      },
      urls: {
        type: "array",
        items: { type: "string" },
        description: "Additional URLs to fetch. Prefer url for a single page."
      },
      mode: {
        type: "string",
        enum: ["auto", "search", "fetch", "search-and-fetch"],
        description:
          "auto uses query and URL hints. search only searches. fetch only fetches provided URLs."
      },
      reason: {
        type: "string",
        description: "Brief private reason for calling retrieval."
      }
    },
    additionalProperties: false
  }
};

const addMemoryToolDefinition: ResponsesToolDefinition = {
  type: "function",
  name: "addMemory",
  description:
    "Add one stable long-term memory item about the user. Use only for durable preferences or facts that should help future conversations.",
  strict: null,
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The exact durable memory to store as a concise standalone sentence."
      }
    },
    required: ["text"],
    additionalProperties: false
  }
};

const deleteMemoryToolDefinition: ResponsesToolDefinition = {
  type: "function",
  name: "deleteMemory",
  description:
    "Delete one existing memory item by id when the user asks to forget it or when it is clearly corrected/obsolete.",
  strict: null,
  parameters: {
    type: "object",
    properties: {
      id: {
        type: "string",
        description: "The id of an existing memory item, such as memory-1."
      }
    },
    required: ["id"],
    additionalProperties: false
  }
};

function getResponsesEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/responses`;
}

function getResponsesReasoning(
  reasoningEffort: OpenRouterReasoningEffort,
  useOpenRouterReasoning: boolean
) {
  if (!useOpenRouterReasoning || reasoningEffort === "none") {
    return undefined;
  }

  return {
    effort: reasoningEffort === "xhigh" ? "high" : reasoningEffort
  };
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

async function stringifyToolOutput(
  output: string | AsyncIterable<string>
): Promise<string> {
  if (typeof output === "string") {
    return output;
  }

  let text = "";
  for await (const chunk of output) {
    text += chunk;
  }
  return text;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeResponsesFunctionCall(input: unknown): ResponsesFunctionCallItem | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const item = input as Partial<ResponsesFunctionCallItem>;
  if (
    item.type !== "function_call" ||
    typeof item.call_id !== "string" ||
    typeof item.name !== "string"
  ) {
    return null;
  }

  return {
    type: "function_call",
    id: typeof item.id === "string" ? item.id : undefined,
    call_id: item.call_id,
    name: item.name,
    arguments: typeof item.arguments === "string" ? item.arguments : "{}"
  };
}

function mergeFunctionCall(
  map: Map<string, ResponsesFunctionCallItem>,
  call: ResponsesFunctionCallItem | null
): void {
  if (!call) {
    return;
  }

  const existing = map.get(call.call_id);
  map.set(call.call_id, {
    ...existing,
    ...call,
    arguments: call.arguments || existing?.arguments || "{}"
  });
}

function appendFunctionCallsFromOutput(
  output: unknown,
  map: Map<string, ResponsesFunctionCallItem>
): void {
  if (!Array.isArray(output)) {
    return;
  }

  for (const item of output) {
    mergeFunctionCall(map, normalizeResponsesFunctionCall(item));
  }
}

async function streamResponsesOnce({
  endpoint,
  apiSettings,
  input,
  instructions,
  tools,
  res,
  state,
  useOpenRouterReasoning
}: {
  endpoint: string;
  apiSettings: RuntimeApiSettings;
  input: ResponsesInputItem[];
  instructions: string;
  tools: ResponsesToolDefinition[];
  res: Response;
  state: ToolStreamState;
  useOpenRouterReasoning: boolean;
}): Promise<ResponsesFunctionCallItem[]> {
  const body: Record<string, unknown> = {
    model: apiSettings.model,
    input,
    instructions,
    tools,
    tool_choice: "auto",
    stream: true,
    max_output_tokens: 9000
  };
  const reasoning = getResponsesReasoning(
    apiSettings.reasoningEffort,
    useOpenRouterReasoning
  );
  if (reasoning) {
    body.reasoning = reasoning;
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiSettings.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:5173",
      "X-Title": "StreamUI Runtime Demo"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || `Responses API request failed with ${response.status}.`);
  }

  const decoder = new TextDecoder();
  const calls = new Map<string, ResponsesFunctionCallItem>();
  const callsByOutputIndex = new Map<number, ResponsesFunctionCallItem>();
  const callsByItemId = new Map<string, ResponsesFunctionCallItem>();
  let buffer = "";

  const handleEvent = (event: unknown) => {
    if (!event || typeof event !== "object") {
      return;
    }

    const data = event as Record<string, unknown>;
    const type = data.type;
    if (
      (type === "response.content_part.delta" ||
        type === "response.output_text.delta") &&
      typeof data.delta === "string"
    ) {
      writeStreamEvent(res, { type: "content", text: data.delta }, state);
      return;
    }

    if (type === "response.reasoning.delta" && typeof data.delta === "string") {
      writeStreamEvent(res, { type: "reasoning", text: data.delta }, state);
      return;
    }

    if (type === "response.output_item.added") {
      const call = normalizeResponsesFunctionCall(data.item);
      if (call) {
        const outputIndex =
          typeof data.output_index === "number" ? data.output_index : undefined;
        if (typeof outputIndex === "number") {
          callsByOutputIndex.set(outputIndex, call);
        }
        if (call.id) {
          callsByItemId.set(call.id, call);
        }
      }
      return;
    }

    if (type === "response.function_call_arguments.done") {
      const outputIndex =
        typeof data.output_index === "number" ? data.output_index : undefined;
      const itemId = typeof data.item_id === "string" ? data.item_id : "";
      const target =
        (typeof outputIndex === "number"
          ? callsByOutputIndex.get(outputIndex)
          : undefined) ?? callsByItemId.get(itemId);
      if (target && typeof data.arguments === "string") {
        target.arguments = data.arguments;
      }
      return;
    }

    if (type === "response.output_item.done") {
      mergeFunctionCall(calls, normalizeResponsesFunctionCall(data.item));
      return;
    }

    if (type === "response.done" && data.response && typeof data.response === "object") {
      appendFunctionCallsFromOutput(
        (data.response as { output?: unknown }).output,
        calls
      );
    }
  };

  const flushLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      return;
    }
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") {
      return;
    }
    handleEvent(safeJsonParse(payload));
  };

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    lines.forEach(flushLine);
  }

  const tail = decoder.decode();
  if (tail) {
    buffer += tail;
  }
  if (buffer.trim()) {
    buffer.split(/\r?\n/).forEach(flushLine);
  }

  return Array.from(calls.values());
}

export async function handleOpenRouterChat(
  req: Request,
  res: Response
): Promise<void> {
  const body = req.body as {
    messages?: unknown;
    files?: unknown;
    canvas?: unknown;
    themeMode?: unknown;
    apiSettings?: unknown;
    searchSettings?: unknown;
  };
  const requestId = Math.random().toString(36).slice(2, 9);
  const startedAt = Date.now();

  try {
    const apiSettings = readRuntimeApiSettings(body.apiSettings);
    const model = apiSettings.model;
    const messages = normalizeMessages(body.messages);
    const files = normalizeSessionFiles(body.files);
    const canvasContext = normalizeCanvasContext(body.canvas);
    const themeMode = normalizeThemeMode(body.themeMode);
    const useOpenRouterReasoning = isOpenRouterRuntime(apiSettings);
    console.info(
      `[chat:${requestId}] start provider=${apiSettings.providerName} base_url=${apiSettings.baseUrl} model=${model} messages=${messages.length} theme=${themeMode} reasoning=${apiSettings.reasoningEffort} key_source=${apiSettings.apiKeySource} key_env=${apiSettings.apiKeyEnvironmentName}`
    );

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.socket?.setNoDelay(true);
    res.flushHeaders();

    const toolStreamState: ToolStreamState = {
      contentChars: 0,
      contentEvents: 0,
      reasoningChars: 0,
      reasoningEvents: 0
    };

    const retrievalStats = createRetrievalToolStats();
    const memoryStats = createMemoryToolStats();
    const fileStats = createSessionFileToolStats();
    const toolMaxSteps = readNativeToolMaxSteps();
    let nativeSteps = 0;
    let nativeToolCalls = 0;
    let nativeToolErrors = 0;
    const retrievalTools = createRetrievalTools({
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content
      })),
      searchSettings: body.searchSettings,
      stats: retrievalStats,
      onStatus: (text) => {
        writeStreamEvent(res, { type: "reasoning", text }, toolStreamState);
      }
    });
    const memoryTools = createMemoryTools({
      memoryItems: apiSettings.memoryItems,
      stats: memoryStats,
      onEvent: (event) => {
        writeStreamEvent(res, event, toolStreamState);
      },
      onStatus: (text) => {
        writeStreamEvent(res, { type: "reasoning", text }, toolStreamState);
      }
    });
    const tools = {
      ...retrievalTools,
      ...memoryTools
    };
    const toolDefinitions = [
      retrieveToolDefinition,
      addMemoryToolDefinition,
      deleteMemoryToolDefinition,
      listFilesToolDefinition,
      readFileToolDefinition
    ];
    const executeResponsesTool = async (
      call: ResponsesFunctionCallItem
    ): Promise<ResponsesToolExecutionResult> => {
      const args = safeJsonParse(call.arguments);
      nativeToolCalls += 1;

      try {
        if (call.name === "retrieve") {
          const execute = tools.retrieve.execute;
          if (!execute) {
            throw new Error("retrieve tool is unavailable.");
          }
          return {
            output: await stringifyToolOutput(
              await execute(args as never, {
                toolCallId: call.call_id,
                messages: []
              })
            )
          };
        }
        if (call.name === "addMemory") {
          const execute = tools.addMemory.execute;
          if (!execute) {
            throw new Error("addMemory tool is unavailable.");
          }
          return {
            output: await stringifyToolOutput(
              await execute(args as never, {
                toolCallId: call.call_id,
                messages: []
              })
            )
          };
        }
        if (call.name === "deleteMemory") {
          const execute = tools.deleteMemory.execute;
          if (!execute) {
            throw new Error("deleteMemory tool is unavailable.");
          }
          return {
            output: await stringifyToolOutput(
              await execute(args as never, {
                toolCallId: call.call_id,
                messages: []
              })
            )
          };
        }
        if (call.name === "listFiles") {
          writeStreamEvent(
            res,
            { type: "reasoning", text: "Reading session file list..." },
            toolStreamState
          );
          return {
            output: listFilesToolOutput(files, fileStats)
          };
        }
        if (call.name === "readFile") {
          writeStreamEvent(
            res,
            { type: "reasoning", text: "Reading session file..." },
            toolStreamState
          );
          const result = await readFileToolResult(files, args, fileStats);
          return {
            output: result.output,
            followUpInput: result.followUpContent
              ? [
                  {
                    type: "message",
                    role: "user",
                    content: result.followUpContent
                  }
                ]
              : undefined
          };
        }

        throw new Error(`Unknown tool ${call.name}.`);
      } catch (error) {
        nativeToolErrors += 1;
        const message = getErrorMessage(error);
        writeStreamEvent(
          res,
          { type: "reasoning", text: `Tool error: ${message}` },
          toolStreamState
        );
        return {
          output: JSON.stringify({
            error: message
          })
        };
      }
    };

    writeStreamEvent(
      res,
      { type: "reasoning", text: "Generating..." },
      toolStreamState
    );

    const instructions = [
        SYSTEM_PROMPT,
        buildMemoryContextPrompt({
          userPreferencePrompt: apiSettings.userPreferencePrompt,
          memoryItems: apiSettings.memoryItems
        }),
        buildSessionFilesContext(files),
        buildThemeContextPrompt(themeMode),
        buildCanvasContextPrompt(canvasContext),
        buildNativeToolPrompt()
      ]
        .filter(Boolean)
        .join("\n\n");
    const responseInput: ResponsesInputItem[] = messages.map(
      toResponsesInputMessage
    );
    const endpoint = getResponsesEndpoint(apiSettings.baseUrl);

    for (
      let step = 0;
      toolMaxSteps === null || step < toolMaxSteps;
      step += 1
    ) {
      nativeSteps += 1;
      const functionCalls = await streamResponsesOnce({
        endpoint,
        apiSettings,
        input: responseInput,
        instructions,
        tools: toolDefinitions,
        res,
        state: toolStreamState,
        useOpenRouterReasoning
      });

      if (!functionCalls.length) {
        break;
      }

      for (const call of functionCalls) {
        responseInput.push(call);
        const toolResult = await executeResponsesTool(call);
        responseInput.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: toolResult.output
        });
        if (toolResult.followUpInput) {
          responseInput.push(...toolResult.followUpInput);
        }
      }
    }

    res.end();
    const retrievalSources = retrievalStats.contexts.reduce(
      (total, context) => total + context.sources.length,
      0
    );
    const retrievalImages = retrievalStats.contexts.reduce(
      (total, context) => total + context.verifiedImages.length,
      0
    );
    console.info(
      `[chat:${requestId}] complete duration_ms=${Date.now() - startedAt} native_steps=${nativeSteps} tool_max_steps=${toolMaxSteps ?? "unlimited"} tool_calls=${nativeToolCalls} retrieval_calls=${retrievalStats.calls} retrieval_errors=${retrievalStats.errors + nativeToolErrors} retrieval_sources=${retrievalSources} retrieval_verified_images=${retrievalImages} memory_adds=${memoryStats.adds} memory_deletes=${memoryStats.deletes} memory_errors=${memoryStats.errors} file_lists=${fileStats.lists} file_reads=${fileStats.reads} file_errors=${fileStats.errors} content_chars=${toolStreamState.contentChars} content_events=${toolStreamState.contentEvents} reasoning_chars=${toolStreamState.reasoningChars} reasoning_events=${toolStreamState.reasoningEvents}`
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown chat proxy error.";
    console.error(`[chat:${requestId}] error ${message}`);

    if (!res.headersSent) {
      res.status(500).type("text/plain").send(message);
      return;
    }

    writeStreamEvent(res, {
      type: "content",
      text: `\n\n[proxy error] ${message}`
    });
    res.end();
  }
}

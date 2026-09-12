/**
 * IFM chat client — OpenAI-compatible completions at api.ifm.ai.
 * Used as the app's optional LLM (replaces Gemini / OpenAI).
 */
export type IfmChatRole = "system" | "user" | "assistant";

export type IfmChatMessage = {
  role: IfmChatRole;
  content: string;
};

export interface IfmChatCompletionOptions {
  model?: string;
  messages: IfmChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface IfmClientOptions {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

const DEFAULT_MODEL = "IFM/K2-Horizon-375B-A23B";
const DEFAULT_BASE_URL = "https://api.ifm.ai/v1";
const DEFAULT_TIMEOUT_MS = 45_000;

export class IfmConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IfmConfigurationError";
  }
}

export class IfmClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: IfmClientOptions = {}) {
    const apiKey = (options.apiKey ?? process.env.IFM_API_KEY)?.trim();
    if (!apiKey) throw new IfmConfigurationError("IFM_API_KEY is not configured");
    this.apiKey = apiKey;
    this.model = options.model?.trim() || process.env.IFM_MODEL?.trim() || DEFAULT_MODEL;
    this.baseUrl = (options.baseUrl?.trim() || process.env.IFM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Returns the assistant message text from a chat completion. */
  async complete(options: IfmChatCompletionOptions): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: options.model?.trim() || this.model,
          messages: options.messages,
          ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
          ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(detail.slice(0, 240) || `IFM request failed (${response.status})`);
      }

      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("IFM returned an empty completion");
      return content;
    } finally {
      clearTimeout(timer);
    }
  }
}

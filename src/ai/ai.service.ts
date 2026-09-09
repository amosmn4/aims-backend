import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

export type AiProvider = "openai" | "gemini";

export interface AiHistoryTurn {
  role: "user" | "assistant";
  content: string;
}

export interface AiCompletionRequest {
  system: string;
  history?: AiHistoryTurn[];
  prompt: string;
  /** Ask the provider to return a bare JSON string (no markdown fence). */
  jsonMode?: boolean;
  maxOutputTokens?: number;
}

export interface AiCompletionResult {
  text: string;
  provider: AiProvider;
}

const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

// Dependency-free OpenAI (primary) + Gemini (fallback) client via fetch. Both providers optional.
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly openaiKey: string | null;
  private readonly openaiModel: string;
  private readonly geminiKey: string | null;
  private readonly geminiModel: string;

  constructor(config: ConfigService) {
    this.openaiKey = config.get<string>("OPENAI_API_KEY") ?? null;
    this.openaiModel = config.get<string>("OPENAI_MODEL") || DEFAULT_OPENAI_MODEL;
    this.geminiKey = config.get<string>("GEMINI_API_KEY") ?? null;
    this.geminiModel = config.get<string>("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;
  }

  isConfigured(): boolean {
    return !!this.openaiKey || !!this.geminiKey;
  }

  providerStatus(): { openai: boolean; gemini: boolean } {
    return { openai: !!this.openaiKey, gemini: !!this.geminiKey };
  }

  // Tries OpenAI first, falls back to Gemini on failure, logging why. Throws if all fail.
  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    if (!this.isConfigured()) {
      throw new Error("No AI provider is configured — set OPENAI_API_KEY or GEMINI_API_KEY.");
    }
    if (this.openaiKey) {
      try {
        const text = await this.callOpenAi(req);
        return { text, provider: "openai" };
      } catch (err) {
        this.logger.warn(
          `OpenAI request failed${this.geminiKey ? ", falling back to Gemini" : ""}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        if (!this.geminiKey) throw err;
      }
    }
    const text = await this.callGemini(req);
    return { text, provider: "gemini" };
  }

  private async callOpenAi(req: AiCompletionRequest): Promise<string> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.openaiKey}`,
      },
      body: JSON.stringify({
        model: this.openaiModel,
        messages: [
          { role: "system", content: req.system },
          ...(req.history ?? []).map((h) => ({ role: h.role, content: h.content })),
          { role: "user", content: req.prompt },
        ],
        ...(req.jsonMode ? { response_format: { type: "json_object" } } : {}),
        ...(req.maxOutputTokens ? { max_tokens: req.maxOutputTokens } : {}),
        temperature: 0.3,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("OpenAI returned an empty response");
    return text;
  }

  private async callGemini(req: AiCompletionRequest): Promise<string> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.geminiModel}:generateContent?key=${this.geminiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [
          ...(req.history ?? []).map((h) => ({
            role: h.role === "assistant" ? "model" : "user",
            parts: [{ text: h.content }],
          })),
          { role: "user", parts: [{ text: req.prompt }] },
        ],
        generationConfig: {
          temperature: 0.3,
          ...(req.jsonMode ? { responseMimeType: "application/json" } : {}),
          ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Gemini ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    if (!text) throw new Error("Gemini returned an empty response");
    return text;
  }
}

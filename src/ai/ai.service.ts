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

export interface AiExtractionRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  file?: { name: string; mimeType: string; data: Buffer };
}

export class AiExtractionLimitError extends Error {}

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

  async extract(req: AiExtractionRequest): Promise<unknown> {
    if (!this.openaiKey) throw new Error("Configure OpenAI to extract records from files.");
    const content: Record<string, unknown>[] = [{ type: "input_text", text: req.prompt }];
    if (req.file) {
      const data = `data:${req.file.mimeType};base64,${req.file.data.toString("base64")}`;
      content.push(
        req.file.mimeType.startsWith("image/")
          ? { type: "input_image", image_url: data, detail: "high" }
          : { type: "input_file", filename: req.file.name, file_data: data },
      );
    }
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.openaiKey}` },
      body: JSON.stringify({
        model: this.openaiModel,
        instructions: req.system,
        input: [{ role: "user", content }],
        text: {
          format: { type: "json_schema", name: "water_import", strict: true, schema: req.schema },
        },
        max_output_tokens: 12000,
        temperature: 0,
        store: false,
      }),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      throw new Error(
        `OpenAI extraction ${response.status}: ${body?.error?.code || "request_failed"}. ${body?.error?.message?.replace(this.openaiKey, "[redacted]").slice(0, 200) || "Try again later."}`,
      );
    }
    const data = (await response.json()) as {
      status?: string;
      incomplete_details?: { reason?: string };
      output?: { content?: { type: string; text?: string }[] }[];
    };
    if (data.status === "incomplete")
      throw new AiExtractionLimitError(
        `Extraction was incomplete: ${data.incomplete_details?.reason || "output limit"}. Split the source into smaller parts.`,
      );
    if (data.status !== "completed")
      throw new Error("File extraction did not complete. No records were imported.");
    const text = data.output
      ?.flatMap((item) => item.content ?? [])
      .filter((item) => item.type === "output_text")
      .map((item) => item.text ?? "")
      .join("");
    if (!text) throw new Error("The AI could not read this source. No records were imported.");
    return JSON.parse(text);
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

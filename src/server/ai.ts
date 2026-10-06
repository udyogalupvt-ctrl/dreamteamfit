/**
 * The AI provider for the CFO's weekly summary: Gemini, OpenAI or Claude over plain fetch (no
 * SDKs). Keys live only in request headers and are never logged or saved. One function,
 * callAi(), which never throws: a slow, broken or unreachable provider is a plain
 * { ok: false, code, status } with a short code ("timeout", "http 429", "bad reply").
 *
 *   CFO_AI_PROVIDER  gemini | openai | claude | off (unset = gemini; off when its key is missing)
 *   CFO_AI_MODEL     optional model override
 *   GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY
 *
 * Test only (honoured only when FIRESTORE_EMULATOR_HOST is set): CFO_AI_BASE_URL replaces the
 * provider's host so the tests can point at a fake AI.
 */

export type AiProvider = "gemini" | "openai" | "claude";

export interface AiConfig {
  provider: AiProvider;
  model: string;
  key: string;
  baseUrl: string;
}

export type AiResult =
  | { ok: true; text: string; provider: AiProvider; model: string }
  | { ok: false; code: string; status: number };

const env = (k: string) => (process.env[k] ?? "").trim();
/** Test-only switches work only against the local emulator, never on the live project. */
export const onEmulator = () => Boolean(env("FIRESTORE_EMULATOR_HOST"));

const HOSTS: Record<AiProvider, string> = {
  gemini: "https://generativelanguage.googleapis.com",
  openai: "https://api.openai.com",
  claude: "https://api.anthropic.com",
};
const DEFAULT_MODELS: Record<AiProvider, string> = {
  gemini: "gemini-2.5-flash",
  openai: "gpt-4.1-mini",
  // Anthropic's small, fast model (claude-api skill, 2026-10). It also accepts a temperature.
  claude: "claude-haiku-4-5",
};
const KEY_VARS: Record<AiProvider, string> = {
  gemini: "GEMINI_API_KEY",
  openai: "OPENAI_API_KEY",
  claude: "ANTHROPIC_API_KEY",
};

/** The configured provider, or null when the AI is off (not chosen, unknown, or no key). */
export function aiConfig(): AiConfig | null {
  const chosen = (env("CFO_AI_PROVIDER") || "gemini").toLowerCase();
  if (chosen !== "gemini" && chosen !== "openai" && chosen !== "claude") return null;
  const key = env(KEY_VARS[chosen]);
  if (!key) return null;
  const base = onEmulator() ? env("CFO_AI_BASE_URL") : "";
  return {
    provider: chosen,
    model: env("CFO_AI_MODEL") || DEFAULT_MODELS[chosen],
    key,
    baseUrl: (base || HOSTS[chosen]).replace(/\/+$/, ""),
  };
}

/** For /api/health: which AI settings are present ("set" / "missing", never a value). */
export function aiHealth(): Record<string, string> {
  const out: Record<string, string> = {
    aiProvider: env("CFO_AI_PROVIDER") ? "set" : "missing",
    aiModel: env("CFO_AI_MODEL") ? "set" : "missing",
  };
  for (const p of ["gemini", "openai", "claude"] as const)
    out[`aiKey_${p}`] = env(KEY_VARS[p]) ? "set" : "missing";
  out["aiReady"] = aiConfig() ? "yes" : "no";
  return out;
}

/** A short code with any key text removed (a provider error must never carry the key out). */
const safeCode = (code: string, key: string) => {
  const clean = key ? code.split(key).join("") : code;
  return clean.replace(/\s+/g, " ").trim().slice(0, 40);
};

const textOf = (parts: unknown, pick: (p: Record<string, unknown>) => unknown) =>
  Array.isArray(parts)
    ? parts
        .map((p) => (p && typeof p === "object" ? pick(p as Record<string, unknown>) : ""))
        .filter((t): t is string => typeof t === "string")
        .join("")
    : "";

/** Room for a 150-word summary in Telugu or Hindi too (those take more tokens per word). */
const MAX_TOKENS = 1024;

/** The request for each provider (wire formats as documented by the providers). */
function buildRequest(cfg: AiConfig, system: string, user: string) {
  if (cfg.provider === "gemini")
    return {
      url: `${cfg.baseUrl}/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`,
      headers: { "x-goog-api-key": cfg.key },
      body: {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        // Gemini 2.5 "thinks" by default and those tokens count against maxOutputTokens, which
        // leaves an empty or cut-off reply: a short summary needs no thinking.
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: MAX_TOKENS,
          thinkingConfig: { thinkingBudget: 0 },
        },
      },
    };
  if (cfg.provider === "openai")
    return {
      url: `${cfg.baseUrl}/v1/chat/completions`,
      headers: { Authorization: `Bearer ${cfg.key}` },
      body: {
        model: cfg.model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.2,
        max_tokens: MAX_TOKENS,
      },
    };
  return {
    url: `${cfg.baseUrl}/v1/messages`,
    headers: { "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
    body: {
      model: cfg.model,
      max_tokens: MAX_TOKENS,
      system,
      messages: [{ role: "user", content: user }],
    },
  };
}

/** true when the provider stopped because it ran out of room: the text is cut off. */
function cutOff(provider: AiProvider, data: unknown): boolean {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const first = (key: string) =>
    (Array.isArray(d[key]) ? (d[key][0] as Record<string, unknown> | undefined) : undefined) ?? {};
  if (provider === "gemini") return first("candidates")["finishReason"] === "MAX_TOKENS";
  if (provider === "openai") return first("choices")["finish_reason"] === "length";
  return d["stop_reason"] === "max_tokens";
}

/** Pulls the reply text out of a provider's answer; "" when the shape is not as documented. */
function replyText(provider: AiProvider, data: unknown): string {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  if (provider === "gemini") {
    const first = Array.isArray(d["candidates"]) ? (d["candidates"][0] as unknown) : null;
    const content = (first as Record<string, unknown> | null)?.["content"] as
      Record<string, unknown> | undefined;
    return textOf(content?.["parts"], (p) => p["text"]);
  }
  if (provider === "openai") {
    const first = Array.isArray(d["choices"]) ? (d["choices"][0] as unknown) : null;
    const message = (first as Record<string, unknown> | null)?.["message"] as
      Record<string, unknown> | undefined;
    return typeof message?.["content"] === "string" ? message["content"] : "";
  }
  return textOf(d["content"], (p) => (p["type"] === "text" ? p["text"] : ""));
}

/**
 * One call. Never throws, never logs the request, the reply or the key. `timeoutMs` is the whole
 * call (the caller keeps it inside the request's deadline).
 */
export async function callAi(
  cfg: AiConfig,
  system: string,
  user: string,
  timeoutMs: number,
): Promise<AiResult> {
  try {
    const req = buildRequest(cfg, system, user);
    const response = await fetch(req.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...req.headers },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(Math.max(1000, timeoutMs)),
    });
    if (!response.ok) {
      // Drain the body so the connection is freed; its content is never kept.
      await response.text().catch(() => "");
      return {
        ok: false,
        code: safeCode(`http ${response.status}`, cfg.key),
        status: response.status,
      };
    }
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      return { ok: false, code: "bad reply", status: response.status };
    }
    // A cut-off summary must never replace the last complete one.
    if (cutOff(cfg.provider, data)) return { ok: false, code: "cut off", status: response.status };
    const text = replyText(cfg.provider, data).trim();
    if (!text) return { ok: false, code: "bad reply", status: response.status };
    return { ok: true, text, provider: cfg.provider, model: cfg.model };
  } catch (e) {
    const name = String((e as Error)?.name ?? "");
    return {
      ok: false,
      code: name.includes("Timeout") || name.includes("Abort") ? "timeout" : "network",
      status: 0,
    };
  }
}

/* ------------------------------------------------------------ is the AI really connected? */

export interface AiCheck {
  ok: boolean;
  /** Plain words for the owner when it is not working (never the key). */
  problem: string;
}

let checked: { sig: string; at: number; result: AiCheck } | null = null;

/**
 * Asks the provider about the configured model (a free metadata call, no text is written): a
 * refused key or an unknown model name shows up here, before anyone presses Start. Remembered for
 * 10 minutes (1 minute after a failure) on a warm server.
 */
export async function checkAi(cfg: AiConfig, timeoutMs = 8000): Promise<AiCheck> {
  const sig = `${cfg.provider}|${cfg.model}|${cfg.baseUrl}|${cfg.key.length}|${cfg.key.slice(-4)}`;
  const fresh =
    checked &&
    checked.sig === sig &&
    Date.now() - checked.at < (checked.result.ok ? 600_000 : 60_000);
  if (fresh) return checked!.result;

  const model = encodeURIComponent(cfg.model);
  const req =
    cfg.provider === "gemini"
      ? { url: `${cfg.baseUrl}/v1beta/models/${model}`, headers: { "x-goog-api-key": cfg.key } }
      : cfg.provider === "openai"
        ? {
            url: `${cfg.baseUrl}/v1/models/${model}`,
            headers: { Authorization: `Bearer ${cfg.key}` },
          }
        : {
            url: `${cfg.baseUrl}/v1/models/${model}`,
            headers: { "x-api-key": cfg.key, "anthropic-version": "2023-06-01" },
          };
  let result: AiCheck;
  try {
    const response = await fetch(req.url, {
      headers: req.headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Read only enough to drain the connection; nothing from the reply is kept.
    await response.text().catch(() => "");
    if (response.ok) result = { ok: true, problem: "" };
    else if (response.status === 404)
      result = { ok: false, problem: `the AI model name "${cfg.model}" was not found` };
    else if ([400, 401, 403].includes(response.status))
      result = { ok: false, problem: "the AI key was refused (check the key on the server)" };
    else if (response.status === 429)
      result = { ok: false, problem: "the AI service is busy or over its free limit right now" };
    else
      result = { ok: false, problem: `the AI service answered with an error (${response.status})` };
  } catch {
    result = { ok: false, problem: "the AI service could not be reached" };
  }
  checked = { sig, at: Date.now(), result };
  return result;
}

import { db } from "./db";

export type ORMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
};

export async function getSetting(key: string, fallback = "") {
  const s = await db.setting.findUnique({ where: { key } });
  return s?.value ?? fallback;
}
export async function setSetting(key: string, value: string) {
  return db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/** The key may live in the environment or in Settings, so it can be changed without a redeploy. */
export async function aiConfig() {
  const key = (await getSetting("ai.apiKey")) || process.env.OPENROUTER_API_KEY || "";
  const model = (await getSetting("ai.model")) || process.env.OPENROUTER_MODEL || "anthropic/claude-sonnet-4.5";
  return { key, model, configured: !!key };
}

/** Single OpenRouter chat completion. The model is a setting, so it is swappable. */
export async function chatCompletion(opts: {
  messages: ORMessage[]; tools?: unknown[]; model: string; apiKey: string; temperature?: number;
}) {
  const base = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Borneo Clean",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      ...(opts.tools?.length ? { tools: opts.tools, tool_choice: "auto" } : {}),
      temperature: opts.temperature ?? 0.2,
    }),
  });
  // Read as text first: OpenRouter pads long requests with whitespace keep-alives,
  // and returns errors as a 200 with an { error } body rather than a bad status.
  const raw = await res.text();
  let json: any;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`OpenRouter returned a non-JSON response (HTTP ${res.status}): ${raw.trim().slice(0, 300) || "<empty body>"}`);
  }
  if (!res.ok || json.error) {
    const e = json.error;
    const msg = typeof e === "string" ? e : e?.message ?? raw.slice(0, 300);
    const code = e?.code ? ` [${e.code}]` : "";
    // Surface provider-side detail too; it is usually the part that explains the failure.
    const meta = e?.metadata ? ` ${JSON.stringify(e.metadata).slice(0, 300)}` : "";
    throw new Error(`OpenRouter ${res.status}${code}: ${msg}${meta}`);
  }
  const choice = json.choices?.[0];
  if (!choice) {
    throw new Error(`OpenRouter returned no choices. Body: ${JSON.stringify(json).slice(0, 400)}`);
  }
  return choice.message as ORMessage;
}

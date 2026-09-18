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
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = await res.json();
  const choice = json.choices?.[0];
  if (!choice) throw new Error("No response from the model");
  return choice.message as ORMessage;
}

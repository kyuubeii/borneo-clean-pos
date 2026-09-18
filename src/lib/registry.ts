import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { Role, SessionUser } from "./auth";
import { audit } from "./audit";

export type ActionCtx = { user: SessionUser; source: "ui" | "assistant" | "system" };

export type Action<I extends z.ZodTypeAny = z.ZodTypeAny> = {
  /** Stable machine name, also the AI tool name. */
  name: string;
  /** Written for the AI: say what it does and when to reach for it. */
  description: string;
  category: string;
  input: I;
  roles: Role[];
  /** Destructive / financial / hard-to-reverse — the assistant confirms before running. */
  requiresConfirm?: boolean;
  /** Read-only actions are never gated and are cheap to call. */
  readOnly?: boolean;
  handler: (input: z.infer<I>, ctx: ActionCtx) => Promise<unknown>;
};

const registry = new Map<string, Action<any>>();

export function defineAction<I extends z.ZodTypeAny>(a: Action<I>): Action<I> {
  // Overwrite on re-registration so dev hot-reload does not throw.
  registry.set(a.name, a);
  return a;
}

export function getAction(name: string) { return registry.get(name); }
export function allActions() { return [...registry.values()]; }

/** Actions this user may invoke — the assistant only ever sees these. */
export function actionsFor(user: SessionUser) {
  return allActions().filter((a) => a.roles.includes(user.role));
}

export class ActionError extends Error {
  constructor(message: string, public code = "ACTION_ERROR") { super(message); }
}

export type ActionResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; code: string }
  | { ok: false; needsConfirm: true; action: string; input: unknown; summary: string; error: string; code: string };

/**
 * The single path every mutation takes, from the UI or the assistant.
 * Validates input, checks the role, runs the handler, writes the audit row.
 */
export async function runAction(
  name: string,
  rawInput: unknown,
  ctx: ActionCtx,
  opts: { confirmed?: boolean } = {}
): Promise<ActionResult> {
  const action = registry.get(name);
  if (!action) return { ok: false, error: `Unknown action: ${name}`, code: "NOT_FOUND" };

  if (!action.roles.includes(ctx.user.role)) {
    await audit({ userId: ctx.user.id, actorName: ctx.user.name, action: name, source: ctx.source,
      payload: rawInput, result: "permission denied", ok: false });
    return { ok: false, error: `Your role (${ctx.user.role}) cannot perform "${name}".`, code: "FORBIDDEN" };
  }

  const parsed = action.input.safeParse(rawInput ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i: any) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
    return { ok: false, error: msg, code: "INVALID_INPUT" };
  }

  // Confirmation gate: the assistant must pass confirmed:true for risky actions.
  if (action.requiresConfirm && ctx.source === "assistant" && !opts.confirmed) {
    return {
      ok: false, needsConfirm: true, action: name, input: parsed.data,
      summary: `${action.description}`,
      error: "Confirmation required before this action runs.", code: "NEEDS_CONFIRM",
    };
  }

  try {
    const data = await action.handler(parsed.data, ctx);
    if (!action.readOnly) {
      await audit({ userId: ctx.user.id, actorName: ctx.user.name, action: name, source: ctx.source,
        payload: parsed.data, result: data, ok: true });
    }
    return { ok: true, data };
  } catch (e: any) {
    const error = e?.message ?? "Unexpected error";
    await audit({ userId: ctx.user.id, actorName: ctx.user.name, action: name, source: ctx.source,
      payload: parsed.data, result: error, ok: false });
    return { ok: false, error, code: e?.code ?? "HANDLER_ERROR" };
  }
}

/** Derives the OpenRouter/OpenAI tools array straight from the registry. */
export function toolSchemas(user: SessionUser) {
  return actionsFor(user).map((a) => {
    const schema = zodToJsonSchema(a.input, { target: "openApi3", $refStrategy: "none" }) as any;
    delete schema.$schema;
    return {
      type: "function" as const,
      function: {
        name: a.name,
        description: a.requiresConfirm ? `${a.description} (Requires user confirmation before executing.)` : a.description,
        parameters: { type: "object", properties: schema.properties ?? {}, required: schema.required ?? [] },
      },
    };
  });
}

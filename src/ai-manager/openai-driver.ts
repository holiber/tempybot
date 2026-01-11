import OpenAI from "openai";

import { withTimeout } from "./time.js";

export type OpenAiRole = "system" | "developer" | "user" | "assistant";

export type OpenAiMessage = {
  role: OpenAiRole;
  content: string;
};

export type OpenAiFunctionTool = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  handler: (args: unknown) => Promise<unknown> | unknown;
};

export type OpenAiTurnResult = {
  text: string;
  toolCalls: Array<{ name: string; callId: string; arguments: unknown }>;
};

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export function readOpenAiKey(): string | undefined {
  return readEnv("OPENAI_KEY") ?? readEnv("OPENAI_API_KEY");
}

function extractOutputText(output: any[]): string {
  const parts: string[] = [];
  for (const item of output ?? []) {
    if (item?.type !== "message") continue;
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const c of content) {
      if (c?.type === "output_text" && typeof c?.text === "string") parts.push(c.text);
    }
  }
  return parts.join("").trim();
}

function extractFunctionCalls(output: any[]): Array<{ name: string; call_id: string; arguments: string }> {
  const calls: Array<{ name: string; call_id: string; arguments: string }> = [];
  for (const item of output ?? []) {
    if (item?.type !== "function_call") continue;
    const name = typeof item?.name === "string" ? item.name : "";
    const callId = typeof item?.call_id === "string" ? item.call_id : "";
    const args = typeof item?.arguments === "string" ? item.arguments : "";
    if (!name || !callId) continue;
    calls.push({ name, call_id: callId, arguments: args });
  }
  return calls;
}

function parseJsonOrNull(raw: string): unknown | null {
  const txt = String(raw ?? "").trim();
  if (!txt) return null;
  try {
    return JSON.parse(txt) as unknown;
  } catch {
    return null;
  }
}

export async function runOpenAiTurn(args: {
  model: string;
  messages: OpenAiMessage[];
  tools?: OpenAiFunctionTool[];
  toolChoice?: "auto" | { type: "function"; name: string };
  timeoutMs?: number;
  maxToolRounds?: number;
}): Promise<OpenAiTurnResult> {
  const apiKey = readOpenAiKey();
  if (!apiKey) throw new Error("Missing OpenAI key (set OPENAI_KEY or OPENAI_API_KEY).");

  const client = new OpenAI({ apiKey });

  const toolDefs = (args.tools ?? []).map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: t.parameters ?? { type: "object", additionalProperties: true },
  }));
  const handlers = new Map((args.tools ?? []).map((t) => [t.name, t.handler] as const));

  const inputItems: any[] = args.messages.map((m) => ({
    type: "message",
    role: m.role,
    content: m.content,
  }));

  const toolCallsSeen: Array<{ name: string; callId: string; arguments: unknown }> = [];

  const timeoutMs = Math.max(1_000, args.timeoutMs ?? 30_000);
  const maxToolRounds = Math.max(0, args.maxToolRounds ?? 6);

  for (let round = 0; round <= maxToolRounds; round++) {
    // If the caller forces a function tool call, only force it on the first round.
    // After we have tool outputs, force "none" so the model can produce the final answer.
    const effectiveToolChoice =
      typeof args.toolChoice === "object"
        ? toolCallsSeen.length === 0
          ? args.toolChoice
          : ("none" as const)
        : (args.toolChoice ?? "auto");

    const resp = await withTimeout(
      client.responses.create({
        model: args.model,
        input: inputItems,
        tools: toolDefs.length ? toolDefs : undefined,
        tool_choice: effectiveToolChoice,
        parallel_tool_calls: false,
        temperature: 0,
      } as any),
      timeoutMs,
      "openai_timeout"
    );

    const output = Array.isArray((resp as any)?.output) ? (resp as any).output : [];
    const calls = extractFunctionCalls(output);
    if (!calls.length) {
      return { text: extractOutputText(output), toolCalls: toolCallsSeen };
    }

    for (const c of calls) {
      const parsedArgs = parseJsonOrNull(c.arguments);
      toolCallsSeen.push({ name: c.name, callId: c.call_id, arguments: parsedArgs });

      // IMPORTANT: For the next request, Responses API expects the *tool call item*
      // to exist in the conversation before its corresponding `function_call_output`.
      // Otherwise the API returns:
      // "No tool call found for function call output with call_id ..."
      inputItems.push({
        type: "function_call",
        call_id: c.call_id,
        name: c.name,
        arguments: c.arguments,
      });

      const h = handlers.get(c.name);
      if (!h) {
        inputItems.push({
          type: "function_call_output",
          call_id: c.call_id,
          output: JSON.stringify({ ok: false, error: { message: `Unknown tool: ${c.name}` } }),
        });
        continue;
      }

      let out: unknown;
      try {
        out = await h(parsedArgs);
      } catch (e) {
        out = { ok: false, error: { message: e instanceof Error ? e.message : String(e) } };
      }

      const outputStr =
        typeof out === "string"
          ? out
          : (() => {
              try {
                return JSON.stringify(out);
              } catch {
                return String(out);
              }
            })();

      inputItems.push({ type: "function_call_output", call_id: c.call_id, output: outputStr });
    }
  }

  throw new Error(`Exceeded maxToolRounds=${maxToolRounds}`);
}


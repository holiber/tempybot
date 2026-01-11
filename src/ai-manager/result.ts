export type ToolResult<T> =
  | { ok: true; data: T }
  | { ok: false; retryable: boolean; code: string; message: string; data?: unknown };

export function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}

export function err(args: { retryable: boolean; code: string; message: string; data?: unknown }): ToolResult<never> {
  return { ok: false, retryable: args.retryable, code: args.code, message: args.message, data: args.data };
}


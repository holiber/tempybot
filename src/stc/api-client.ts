import { InMemoryChannel, type IChannel } from "./channel.js";
import type { DiagnosticsContext } from "./diagnostics.js";
import type { IRuntime } from "./runtime.js";
import type { TransportClient } from "./transport.js";

export type ApiRequestId = string;
export type ApiChannelId = string;

export type ApiLogLevel = "error" | "warn" | "info" | "log" | "debug";
export type ApiMethodRef = string;
export type ApiStatus = "ok" | "error" | "canceled" | "timeout";

export interface ApiCallError extends Record<string, unknown> {
  code?: string | number;
  message: string;
  details?: Record<string, unknown>;
  stack?: string;
  origin?: "client" | "server" | "transport";
}

export interface ApiCallResult<T = unknown> extends Record<string, unknown> {
  status: ApiStatus;
  value?: T;
  error?: ApiCallError;
  completionCode?: string | number;
}

export interface ApiCallRequest<T = unknown> extends Record<string, unknown> {
  requestId: ApiRequestId;
  method: ApiMethodRef;
  input: unknown;
  channel: IChannel<unknown>;
  promise: Promise<ApiCallResult<T>>;
  syncResult?: ApiCallResult<T>;
}

export interface ApiCallOptions {
  signal?: AbortSignal;
  logLevel?: ApiLogLevel;
  stream?: boolean;
  timeoutMs?: number;
}

export interface IApiClient {
  call<T = unknown>(method: ApiMethodRef, input: unknown, options?: ApiCallOptions): ApiCallRequest<T>;
}

function createRequestId(): ApiRequestId {
  return `req_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function normalizeError(err: unknown, origin: ApiCallError["origin"]): ApiCallError {
  if (err instanceof Error) {
    return { message: err.message, stack: err.stack, name: err.name, origin } as any;
  }
  if (typeof err === "object" && err) {
    const anyErr = err as any;
    return {
      message: String(anyErr.message ?? "Unknown error"),
      code: anyErr.code,
      details: anyErr.details,
      stack: anyErr.stack,
      origin
    };
  }
  return { message: String(err ?? "Unknown error"), origin };
}

export class ApiClient implements IApiClient {
  public constructor(
    private readonly deps: {
      transport: TransportClient;
      runtime?: IRuntime;
      diagnostics?: DiagnosticsContext;
    }
  ) {}

  public call<T = unknown>(method: ApiMethodRef, input: unknown, options?: ApiCallOptions): ApiCallRequest<T> {
    const requestId = createRequestId();
    const channel: IChannel<unknown> =
      this.deps.runtime?.createChannel?.({ id: `call:${requestId}` }) ??
      new InMemoryChannel<unknown>({ id: `call:${requestId}` });

    const startedAt = Date.now();

    const promise = (async (): Promise<ApiCallResult<T>> => {
      try {
        if (options?.signal?.aborted) {
          return { status: "canceled", error: { message: "Call aborted", origin: "client" } };
        }

        if (options?.timeoutMs && options.timeoutMs > 0) {
          const res = await Promise.race([
            this.deps.transport.call({ requestId, method, input, channel, startedAtMs: startedAt }),
            new Promise<ApiCallResult<T>>((_, reject) => {
              setTimeout(() => reject(Object.assign(new Error("Call timeout"), { code: "timeout" })), options.timeoutMs);
            })
          ]);
          return res as ApiCallResult<T>;
        }

        const res = await this.deps.transport.call({ requestId, method, input, channel, startedAtMs: startedAt });
        return res as ApiCallResult<T>;
      } catch (err) {
        const normalized = normalizeError(err, "transport");
        if ((normalized.code as any) === "timeout") return { status: "timeout", error: normalized };
        if ((normalized.code as any) === "aborted") return { status: "canceled", error: normalized };

        try {
          await this.deps.diagnostics?.error?.("ApiClient call failed", {
            source: "api-client",
            correlationId: requestId,
            details: { method }
          } as any);
        } catch {
          // ignore diagnostics failures
        }
        return { status: "error", error: normalized };
      } finally {
        try {
          await channel.close({ code: "done" });
        } catch {
          // ignore
        }
      }
    })();

    return { requestId, method, input, channel, promise };
  }
}


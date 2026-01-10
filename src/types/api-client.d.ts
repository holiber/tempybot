/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STCAPI — ApiClient Spec (Tier 1)
 *
 * ApiClient provides a unified way to call public API methods regardless of
 * whether components are local or remote.
 *
 * Tier 1:
 * - CallRequest returned immediately
 * - request has a channel for lifecycle/progress/logs/chunks
 * - request has a promise resolving to CallResult
 * - supports AbortSignal
 * - log levels aligned with Chrome console
 *
 * Proposal:
 * - cancellation protocol (server-side cancel)
 * - richer streaming capabilities declarations
 * - retries/backoff coordination with transport
 */

export declare namespace STC {
  export namespace ApiClient {
    export type RequestId = string;
    export type ChannelId = string;

    export type LogLevel = "error" | "warn" | "info" | "log" | "debug";

    /** Method reference (implementation-defined string path). */
    export type MethodRef = string; // e.g. "issueTracker.getTasks"

    /** Result status. */
    export type Status = "ok" | "error" | "canceled" | "timeout";

    export interface CallError extends STC.Collection.AnyRecord {
      /** Stable error code if available (HTTP/status/exit code). */
      code?: string | number;

      /** Human-readable summary. */
      message: string;

      /** Optional details (safe to serialize). */
      details?: Record<string, unknown>;

      /** Stack trace (best-effort). */
      stack?: string;

      /** Origin classification. */
      origin?: "client" | "server" | "transport";
    }

    export interface CallResult<T = unknown> extends STC.Collection.AnyRecord {
      status: Status;

      /** Present if status === "ok". */
      value?: T;

      /** Present if status !== "ok". */
      error?: CallError;

      /** Optional completion code (HTTP/status/exit). */
      completionCode?: string | number;
    }

    export interface CallRequest<T = unknown> extends STC.Collection.AnyRecord {
      requestId: RequestId;

      /** Method to call. */
      method: MethodRef;

      /** Input payload (JSON-serializable for Tier1 transports). */
      input: unknown;

      /** Channel with lifecycle/progress/logs/chunks events. */
      channel: STC.Channel.Channel<unknown>;

      /** Resolves/rejects on call completion. */
      promise: Promise<CallResult<T>>;

      /**
       * Proposal: if result is available synchronously (local calls),
       * it may be exposed here.
       */
      syncResult?: CallResult<T>;
    }

    export interface CallOptions {
      /** Abort in-flight call (client side). */
      signal?: AbortSignal;

      /** Desired verbosity of streamed events. */
      logLevel?: LogLevel;

      /**
       * If true, caller wants all available intermediate events (best-effort).
       * If false/omitted, implementation may only return final result.
       */
      stream?: boolean;

      /** Optional timeout (ms). */
      timeoutMs?: number;
    }

    export interface Client {
      /**
       * Perform a call and return a request handle immediately.
       * The request handle exposes a channel and a completion promise.
       */
      call<T = unknown>(method: MethodRef, input: unknown, options?: CallOptions): CallRequest<T>;
    }

    export namespace Proposal {
      /** Proposal: server-side cancellation. */
      export interface CancelOptions {
        reason?: string;
      }

      /** Proposal: capabilities declared by API methods for streaming support. */
      export interface MethodCapabilities {
        streaming?: boolean;
        progress?: boolean;
        logs?: boolean;
      }
    }
  }
}

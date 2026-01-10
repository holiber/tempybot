/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STCAPI — Transport Spec (Tier 1)
 *
 * Transport defines how ApiClient communicates with remote ApiHost using a protocol.
 * Tier 1 focuses on REST-like / RPC-like calls over carriers:
 * - HTTP (fetch/undici)
 * - WebSocket
 * - stdio
 *
 * Transport should reuse STC.Channel semantics for streaming and safety.
 *
 * Proposal:
 * - retries with incremental backoff
 * - richer protocols (grpc, trpc, graphql, mcp, etc.)
 */

export declare namespace STC {
  export namespace Transport {
    /** Transport name identifier. */
    export type Name = string;

    /** Carrier kind indicates runtime mechanism. */
    export type Carrier = "http" | "ws" | "stdio" | "sse" | "poll";

    /** Protocol describes the wire contract. */
    export type Protocol = "rest";

    export interface Endpoint {
      /** Base URL or connection string. */
      url: string; // e.g. "https://api.example.com", "ws://...", "stdio://"
    }

    /**
     * Auth wiring. Tier 1 keeps it minimal and transport-agnostic.
     * Adapters/integrations can choose how to apply this to HTTP/WS/etc.
     */
    export type AuthConfig =
      | { kind: "none" }
      | { kind: "bearer"; token: string }
      | { kind: "headers"; headers: Record<string, string> }
      | { kind: "apiKey"; key: string; header?: string; queryParam?: string };

    export interface Options {
      name?: Name;

      carrier: Carrier;
      protocol: Protocol;

      endpoint: Endpoint;

      /** Optional auth config. */
      auth?: AuthConfig;

      /** Optional mode hint. */
      mode?: "dev" | "prod";

      /** Optional diagnostics sink to report transport-level issues. */
      diagnostics?: STC.Diagnostics.Sink;
    }

    /**
     * Low-level transport client capable of executing calls and opening streaming channels.
     */
    export interface Client {
      readonly options: Readonly<Options>;

      /**
       * Execute a one-shot call.
       * For REST-like, this maps to HTTP request/response.
       */
      call(request: STC.ApiClient.CallRequest): Promise<STC.ApiClient.CallResult>;

      /**
       * Open a streaming channel for a call (logs/progress/chunks).
       * Implementations should apply Channel safety defaults (caps/cleanup/buffer).
       */
      openChannel(request: STC.ApiClient.CallRequest): Promise<STC.Channel.Channel<unknown>>;

      /** Close/cleanup underlying resources (idempotent). */
      dispose(): Promise<void>;
    }

    export interface Factory {
      createClient(options: Options): Client;
    }

    export namespace Proposal {
      export type Protocol =
        | "rpc"
        | "graphql"
        | "trpc"
        | "grpc"
        | "mcp"
        | "asyncapi";

      export interface RetryPolicy {
        enabled?: boolean;
        maxAttempts?: number;
        initialDelayMs?: number;
        maxDelayMs?: number;
        backoff?: "exponential" | "linear";
        jitter?: boolean;
        retryOn?: Array<"timeout" | "network" | "5xx" | "429">;
      }

      export interface Options {
        retry?: RetryPolicy;

        /** Proposal: throughput limits for channels opened by transport. */
        channelLimits?: STC.Channel.Proposal.ThroughputLimits;
      }
    }
  }
}

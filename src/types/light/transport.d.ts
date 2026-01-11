/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STCAPI — Transport Spec (Tier 1)
 *
 * Transport defines how a client communicates with a remote host.
 *
 * Tier 1:
 * - REST-like / RPC-like calls
 * - HTTP / WS / stdio / SSE / polling
 * - streaming via STC.Channel
 *
 * Proposal:
 * - retries / backoff
 * - richer protocols (grpc, trpc, graphql, mcp, etc.)
 */

import type { STC as ApiClientSTC } from "../api-client.js";
import type { STC as ChannelSTC } from "./channel.js";
import type { STC as DiagnosticsSTC } from "../diagnostic.js";

export declare namespace STC {
  // Cross-spec dependencies referenced by Transport.
  export import ApiClient = ApiClientSTC.ApiClient;
  export import Channel = ChannelSTC.Channel;
  export import Diagnostics = DiagnosticsSTC.Diagnostics;

  export namespace Transport {
    /** Transport name identifier (diagnostics / routing). */
    export type Name = string;

    /** Carrier indicates runtime mechanism. */
    export type Carrier = "http" | "ws" | "stdio" | "sse" | "poll";

    /** Tier1 wire protocol. */
    export type Protocol = "rest";

    export interface Endpoint {
      /** Base URL or connection string. */
      url: string; // e.g. https://api.example.com, ws://..., stdio://
    }

    /**
     * Transport-agnostic auth wiring.
     * How it maps to headers/query/etc is implementation-defined.
     */
    export type AuthConfig =
      | { kind: "none" }
      | { kind: "bearer"; token: string }
      | { kind: "headers"; headers: Record<string, string> }
      | { kind: "apiKey"; key: string; header?: string; queryParam?: string };

    /** Generic meta container. */
    export type Meta<M extends Record<string, unknown> = Record<string, unknown>> = M;

    export interface Options<M extends Meta = Meta> {
      name?: Name;

      carrier: Carrier;
      protocol: Protocol;

      endpoint: Endpoint;

      auth?: AuthConfig;

      /** Optional mode hint (best-effort). */
      mode?: "dev" | "prod";

      /** Free-form transport metadata (timeouts, tags, provider info). */
      meta?: M;

      /** Optional diagnostics sink. */
      diagnostics?: STC.Diagnostics.Sink;
    }

    /**
     * Low-level transport client.
     * Stateless from API perspective; lifecycle managed externally.
     */
    export interface Client<M extends Meta = Meta> {
      readonly options: Readonly<Options<M>>;

      /**
       * Execute a one-shot request.
       * For REST this maps to HTTP request/response.
       */
      call(
        request: STC.ApiClient.CallRequest
      ): Promise<STC.ApiClient.CallResult>;

      /**
       * Open a streaming channel for a request.
       * Used for:
       * - logs
       * - progress
       * - chunked responses
       *
       * Channel must respect safety defaults (cleanup, caps).
       */
      openChannel(
        request: STC.ApiClient.CallRequest
      ): Promise<STC.Channel.Channel<unknown, M>>;

      /** Cleanup underlying resources (idempotent). */
      dispose(): Promise<void>;
    }

    export interface Factory {
      createClient<M extends Meta = Meta>(options: Options<M>): Client<M>;
    }

    // ----------------------------
    // Proposal (Tier2+)
    // ----------------------------
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

        /** Throughput limits for channels opened by transport. */
        channelLimits?: STC.Channel.Proposal.ThroughputLimits;
      }
    }
  }
}

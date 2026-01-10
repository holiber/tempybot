/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STCAPI — ApiHost Spec (Tier 1)
 *
 * ApiHost exposes an application's API to the outside world via one or more Transports.
 * It is the server-side counterpart to STC.ApiClient.
 *
 * Tier 1 goals:
 * - expose API schema + method handlers
 * - support REST-like calls over multiple transports
 * - integrate with Channel for streaming/progress/logs
 * - safe-by-default lifecycle management
 *
 * Proposal:
 * - auth / authorization policies
 * - rate limiting & quotas
 * - multi-tenant isolation
 */

export declare namespace STC {
  export namespace ApiHost {
    /** Host identifier (for diagnostics/debugging). */
    export type Id = string;

    /** Host lifecycle state. */
    export type State = "created" | "listening" | "closing" | "closed";

    /** Execution context for a single API call. */
    export interface CallContext {
      /** Unique request id (shared with ApiClient if remote). */
      requestId: STC.ApiClient.RequestId;

      /** Channel bound to this call (lifecycle/progress/logs). */
      channel: STC.Channel.Channel<unknown>;

      /** Runtime reference. */
      runtime: STC.Runtime.Runtime;

      /** Diagnostics context for this call. */
      diagnostics: STC.Diagnostics.Context;

      /** Abort signal (client disconnect / timeout / cancel). */
      signal: AbortSignal;

      /** Transport-specific metadata (best-effort). */
      transport?: {
        name?: string;
        carrier?: STC.Transport.Carrier;
        remoteAddress?: string;
        headers?: Record<string, string>;
      };
    }

    /** API method handler signature. */
    export type MethodHandler = (
      input: unknown,
      ctx: CallContext
    ) => Promise<unknown>;

    /** API method descriptor registered on the host. */
    export interface MethodDescriptor {
      /** Fully-qualified method ref (e.g. "issueTracker.getTasks"). */
      method: STC.ApiClient.MethodRef;

      /** Handler function. */
      handler: MethodHandler;

      /** Capabilities declaration (best-effort). */
      capabilities?: STC.ApiClient.Proposal.MethodCapabilities;

      /** Optional metadata for docs/policies. */
      meta?: Record<string, unknown>;
    }

    /** ApiHost options. */
    export interface Options {
      /** Host id. */
      id?: Id;

      /** Runtime reference. */
      runtime: STC.Runtime.Runtime;

      /** Diagnostics sink for host-level events. */
      diagnostics?: STC.Diagnostics.Sink;

      /** Registered transports used to expose the API. */
      transports: STC.Transport.Client[];

      /**
       * Optional default call options.
       * Timeouts, log levels, etc.
       */
      defaults?: {
        timeoutMs?: number;
        logLevel?: STC.ApiClient.LogLevel;
      };
    }

    /**
     * ApiHost instance.
     * Owns lifecycle of transports and call routing.
     */
    export interface Host {
      readonly id: Id;
      readonly state: State;

      /** Start listening on all configured transports. */
      start(): Promise<void>;

      /** Gracefully stop accepting new calls and close transports. */
      stop(): Promise<void>;

      /** Register an API method handler. */
      register(method: MethodDescriptor): void;

      /** Register multiple methods at once. */
      registerAll(methods: MethodDescriptor[]): void;

      /** Introspection helper (for docs/debug). */
      getMethods(): MethodDescriptor[];
    }

    /** Factory for creating ApiHost instances. */
    export interface Factory {
      create(options: Options): Host;
    }

    // ----------------------------
    // Proposal (Tier2+)
    // ----------------------------
    export namespace Proposal {
      /** Proposal: authorization hook. */
      export interface Authorizer {
        authorize(ctx: CallContext, method: MethodDescriptor): Promise<boolean>;
      }

      /** Proposal: rate limiting / quotas. */
      export interface RateLimiter {
        check(ctx: CallContext): Promise<{ allowed: boolean; retryAfterMs?: number }>;
      }

      /** Proposal: request recording for full replay/debugging. */
      export interface Recorder {
        recordCallStart(ctx: CallContext): void;
        recordEvent(event: STC.Channel.Event<unknown>): void;
        recordCallEnd(result: STC.ApiClient.CallResult): void;
      }
    }
  }
}

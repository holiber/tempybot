
/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STCAPI — Channel Spec (Tier 1)
 *
 * Channel = structured event stream with subscriptions, safe defaults, caps and cleanup.
 *
 * Tier 1:
 * - subscribe/unsubscribe via returned function (Unsubscribe)
 * - auto-cleanup on close (required)
 * - hard cap on subscriptions (dev=100, prod=10000), warn at 80%
 * - buffering of outgoing events (default 100ms) to reduce UI churn
 * - supports AbortSignal for cancellation
 *
 * Proposal:
 * - persisted history
 * - universal sequence/time semantics across distributed sources
 * - bandwidth limits / message size limits (tracked as final questions)
 */

export declare namespace STC {
  export namespace Channel {
    /** Channel identifier. */
    export type Id = string;

    /** Unsubscribe function returned from subscribe(). */
    export type Unsubscribe = () => void;

    /** Chrome-like log levels (Tier 1). */
    export type Level = "error" | "warn" | "info" | "log" | "debug";

    /** Channel lifecycle state. */
    export type State = "open" | "closing" | "closed";

    /** System event types. */
    export type SystemEventType =
      | "channel.opened"
      | "channel.params"
      | "channel.progress"
      | "channel.closed";

    /** Close reasons/codes (Tier1: supports HTTP/status/exit code shapes). */
    export type CloseCode = number | string;

    /** Generic channel event wrapper. */
    export type Event<T> = DataEvent<T> | SystemEvent;

    export interface DataEvent<T> {
      kind: "data";
      data: T;

      /**
       * Optional sequencing/timestamps (best-effort).
       * See Proposal for stronger guarantees.
       */
      seq?: number;
      tsMs?: number;
    }

    export interface SystemEvent {
      kind: "system";
      type: SystemEventType;

      seq?: number;
      tsMs?: number;

      payload?: unknown;
    }

    /** Progress payload (Tier1: can arrive anytime; optional fields). */
    export interface ProgressPayload {
      status?: "queued" | "processing" | "done" | "failed" | "canceled";

      /** 0..1 */
      progress?: number;

      stageCode?: string;
      stageTitle?: string;

      subStageCode?: string;
      subStageTitle?: string;

      /** Best-effort performance metrics. */
      metrics?: {
        cpu?: number;
        memBytes?: number;
        ioBytes?: number;
        netBytes?: number;
        processes?: number;
      };
    }

    /** Channel params are observable and can be updated by system events. */
    export interface Params {
      id: Id;

      state: State;

      /** Whether current principal can read/write. */
      canRead: boolean;
      canWrite: boolean;

      /** Message encoding. */
      encoding: "json" | Proposal.Encoding;

      /** Optional TTL (ms). If omitted, channel may be infinite-lived. */
      ttlMs?: number;

      /** Default buffering window for outgoing events (ms). */
      bufferMs: number;

      /** Subscription safety caps (resolved). */
      caps: {
        /** Hard cap. */
        maxSubscriptions: number;
        /** Warning threshold, e.g. 0.8. */
        warnAtRatio: number;
      };
    }

    export interface CreateOptions {
      /** Optional id. If omitted, runtime generates one. */
      id?: Id;

      /** Permission hints (best-effort). */
      canRead?: boolean;
      canWrite?: boolean;

      /** Default encoding. */
      encoding?: "json" | Proposal.Encoding;

      /** Optional TTL. */
      ttlMs?: number;

      /**
       * Buffering for outgoing events (default 100ms).
       * Helps avoid too frequent rerenders in web UIs.
       */
      bufferMs?: number;

      /**
       * Subscription cap.
       * Tier1 default is expected to be:
       * - dev: 100
       * - prod: 10000
       */
      maxSubscriptions?: number;

      /** Warning threshold ratio (default 0.8). */
      warnAtRatio?: number;

      /** Optional cancellation. */
      signal?: AbortSignal;
    }

    export interface SubscribeOptions {
      /** Receive system events too (default true). */
      includeSystem?: boolean;

      /** Optional cancellation for the subscription itself. */
      signal?: AbortSignal;
    }

    export interface Channel<T> {
      /** Current params snapshot. */
      getParams(): Params;

      /** Subscribe to events. Returns an Unsubscribe function. */
      subscribe(
        handler: (event: Event<T>) => void,
        options?: SubscribeOptions
      ): Unsubscribe;

      /**
       * Send data event (if canWrite).
       * Implementations may buffer according to bufferMs.
       */
      send(data: T): Promise<void>;

      /**
       * Send system progress event (best-effort).
       * This is optional convenience; transports and hosts may emit these too.
       */
      progress(payload: ProgressPayload): Promise<void>;

      /**
       * Close channel (idempotent).
       * Must auto-cleanup all subscriptions on close (Tier1 requirement).
       */
      close(info?: { code?: CloseCode; reason?: string }): Promise<void>;
    }

    /** Factory for creating channels (usually provided by Runtime/Workbench). */
    export interface Factory {
      create<T>(options?: CreateOptions): Channel<T>;
    }

    // ----------------------------
    // Proposal (Tier2+)
    // ----------------------------
    export namespace Proposal {
      export type Encoding = "bson" | "binary";

      /**
       * Proposal: persisted history / replay.
       * (Not required in Tier1)
       */
      export interface HistoryOptions {
        enabled?: boolean;
        maxEvents?: number;
      }

      /**
       * Proposal: stronger event ordering semantics.
       * - sourceSeq: sequence at source
       * - recvSeq: sequence at receiver (for debugging)
       * - tsSourceMs / tsRecvMs
       */
      export interface Ordering {
        sourceSeq?: number;
        recvSeq?: number;
        tsSourceMs?: number;
        tsRecvMs?: number;
      }

      /**
       * Proposal: message size / bandwidth limits.
       */
      export interface ThroughputLimits {
        maxMessageBytes?: number;
        maxBytesPerSecond?: number;
        maxEventsPerSecond?: number;
      }
    }
  }
}

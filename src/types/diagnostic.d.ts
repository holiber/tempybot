/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STCAPI — Diagnostics Spec (Tier 1)
 *
 * Diagnostics = structured diagnostic events for humans and AI agents.
 * Works via Channel (stream) and optionally via Collection (history).
 *
 * Tier 1:
 * - levels aligned with Chrome console
 * - sink with channel (+ optional history collection)
 * - context helper for consistent emission
 *
 * Notes:
 * - dev/prod mode is NOT stored in events; it may be used as config input to set defaults.
 */

export declare namespace STC {
  export namespace Diagnostics {
    /** Tier 1 levels aligned with Chrome console. */
    export type Level = "error" | "warn" | "info" | "log" | "debug";

    /**
     * Stable diagnostic codes (optional but recommended).
     * Examples:
     * - "TRANSPORT.CONNECT_FAILED"
     * - "API.TIMEOUT.CLIENT"
     * - "CHAT.POST_DENIED"
     */
    export type Code = string;

    /**
     * Where the event originated from.
     * Examples: "transport:http", "host", "chat:github", "module:issueTracker"
     */
    export type Source = string;

    export interface ErrorInfo {
      name?: string;
      message?: string;
      stack?: string;

      /** Normalized error code if available (HTTP/status/exit code/etc.). */
      code?: string | number;
    }

    export interface Event extends STC.Collection.AnyRecord {
      id?: string; // if stored in a collection; otherwise optional

      level: Level;
      message: string;

      code?: Code;
      source?: Source;

      tsMs: number;

      /**
       * Correlation ids to connect diagnostics to calls/chats/modules.
       * Examples: callId, requestId, channelId, chatId.
       */
      correlationId?: string;

      /** Optional structured details (must be safe to serialize). */
      details?: Record<string, unknown>;

      /** Optional error shape (normalized). */
      error?: ErrorInfo;

      /** Optional tags for filtering/searching. */
      tags?: string[];
    }

    /**
     * Sink that receives diagnostics.
     * Tier 1: channel is recommended; collection is optional for history.
     */
    export interface Sink {
      /** Live stream of diagnostic events. */
      readonly channel: STC.Channel<Event>;

      /** Optional stored history. */
      readonly history?: STC.Collection<Event>;

      /** Emit a new event. */
      emit(event: Event): Promise<void>;
    }

    export interface CreateSinkOptions {
      /** Optional mode hint to apply default caps (implementation-defined). */
      mode?: "dev" | "prod";

      /** Optional history collection. */
      history?: {
        enabled?: boolean;
        maxEvents?: number; // default aligns with Collection default 10000
      };

      /** Default fields applied to emitted events. */
      defaults?: {
        source?: Source;
        correlationId?: string;
        tags?: string[];
      };
    }

    export interface Factory {
      createSink(options?: CreateSinkOptions): Sink;

      /**
       * Create a context helper for building events consistently.
       * (Pure utility, does not create a new sink.)
       */
      createContext(sink: Sink, defaults?: CreateSinkOptions["defaults"]): Context;
    }

    export interface Context {
      /** Emit a fully-specified event (defaults applied). */
      emit(event: Omit<Event, "tsMs"> & Partial<Pick<Event, "tsMs">>): Promise<void>;

      error(message: string, init?: Partial<Event>): Promise<void>;
      warn(message: string, init?: Partial<Event>): Promise<void>;
      info(message: string, init?: Partial<Event>): Promise<void>;
      log(message: string, init?: Partial<Event>): Promise<void>;
      debug(message: string, init?: Partial<Event>): Promise<void>;

      /** Create a derived context with additional defaults. */
      with(defaults: CreateSinkOptions["defaults"]): Context;
    }

    export namespace Proposal {
      /** Proposal: additional levels. */
      export type Level = "trace";

      /** Proposal: sampling, rate-limits, and sinks (console/file/remote). */
      export interface Limits {
        maxEventsPerSecond?: number;
        maxBytesPerSecond?: number;
        sampleRate?: number; // 0..1
      }

      export interface Transport {
        kind: "console" | "file" | "remote";
        options?: Record<string, unknown>;
      }
    }
  }
}

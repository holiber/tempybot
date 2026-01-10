/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STCAPI — Runtime / Global Config Spec (Tier 1)
 *
 * Runtime is a single global environment object created by Workbench/AppEngine
 * and injected into modules via ctx.
 *
 * Goals:
 * - one place to hold mode/devprod and defaults
 * - avoid duplicating dev/prod flags across components
 * - provide helper factories that apply global defaults (optional)
 */

export declare namespace STC {
  export namespace Runtime {
    export type Mode = "dev" | "prod";

    export interface Config {
      mode: Mode;

      channel: {
        /** Default buffering window for outgoing events (ms). */
        bufferMs: number; // default 100

        /** Warning threshold ratio for caps (0..1). */
        warnAtRatio: number; // default 0.8

        /** Hard cap for subscriptions in dev. */
        maxSubscriptionsDev: number; // default 100

        /** Hard cap for subscriptions in prod. */
        maxSubscriptionsProd: number; // default 10000
      };

      diagnostics: {
        historyEnabled: boolean;

        /** Default caps for stored diagnostic events. */
        maxEventsDev: number;  // e.g. 10_000
        maxEventsProd: number; // e.g. 100_000 (or 10_000)
      };

      collection: {
        /** Default record limit per collection. */
        defaultLimit: number; // default 10_000

        /** Warning threshold ratio for limit (0..1). */
        warnAtRatio: number; // default 0.9
      };

      fs?: {
        /** Workspace identifier/root. */
        workspace?: string;
      };

      features?: Record<string, boolean>;
    }

    export interface Runtime {
      readonly mode: Mode;
      readonly config: Readonly<Config>;

      /** Monotonic-ish clock source for consistency and tests. */
      nowMs(): number;

      /**
       * Optional helpers that apply runtime defaults.
       * Reference implementations may provide these.
       */
      createChannel?<T>(options?: STC.Channel.CreateOptions): STC.Channel.Channel<T>;
      createDiagnosticsSink?(options?: STC.Diagnostics.CreateSinkOptions): STC.Diagnostics.Sink;
    }

    export interface Loader {
      /**
       * Load config (from file/env/overrides) and return normalized object.
       * Implementation-defined; Tier 1 allows JSON config file.
       */
      load(options?: {
        /** Explicit mode override. */
        mode?: Mode;

        /** Override values (highest priority). */
        overrides?: Partial<Config>;
      }): Promise<Config>;
    }
  }
}

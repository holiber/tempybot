/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STCAPI — Workbench / AppEngine Spec (Tier 1)
 *
 * Workbench is the primary composition root:
 * - loads and owns STC.Runtime (global config/defaults)
 * - wires Storage/FS
 * - provides factories (Collection/Channel/Diagnostics)
 * - manages adapters/integrations
 * - builds an App from modules and exposes API schema
 *
 * Tier 1 is focused on spec + reference tooling friendliness.
 */

export declare namespace STC {
  export namespace Workbench {
    export type Platform = "node" | "web" | "auto";

    export interface CreateOptions {
      /**
       * Global config source.
       * Exactly one of:
       * - config
       * - configFile (node)
       * - configUrl (web)
       */
      config?: STC.Runtime.Config;
      configFile?: string;
      configUrl?: string;

      /** Platform hint (default "auto"). */
      platform?: Platform;

      /** Storage/FS wiring (Tier1). */
      storage?: {
        /** Workspace root/identifier. */
        workspace?: string;

        /** FS implementation override (if omitted, reference impl chooses). */
        fs?: STC.FS;

        /** Environment hint (for consumers). */
        environment?: "node" | "browser" | "unknown";
      };

      /** Default Chat adapter wiring (optional). */
      chat?: {
        adapter?: STC.Chat.Adapter;
      };

      /** Optional Transport wiring (for remote calls / hosting). */
      transport?: {
        client?: STC.Transport.Client;
      };

      /** Optional Diagnostics sink override. */
      diagnostics?: {
        sink?: STC.Diagnostics.Sink;
      };
    }

    /**
     * Workbench instance: owns runtime + common services,
     * and creates Apps from modules.
     */
    export interface Workbench {
      readonly runtime: STC.Runtime.Runtime;
      readonly storage: STC.Storage;

      /** Shared diagnostics sink (optional). */
      readonly diagnostics?: STC.Diagnostics.Sink;

      /** Factories (expected to exist in reference implementations). */
      readonly collections?: STC.Collection.Factory;
      readonly channels?: STC.Channel.Factory;

      /** Default chat adapter (optional). */
      readonly chatAdapter?: STC.Chat.Adapter;

      /**
       * Create an app from one or more root modules.
       * App is not active until activate() is called.
       */
      createApp(root: Module | Module[]): App;
    }

    /**
     * Module: unit of composition.
     * Tier 1: module returns public API object and may use ctx lifecycle hooks.
     */
    export type Module = (ctx: ModuleContext) => ModuleExport;

    export interface ModuleExport {
      /** Public API surface exposed by the App. */
      api?: Record<string, unknown>;

      /** Optional nested modules (composition). */
      modules?: Record<string, Module>;
    }

    export interface ModuleContext {
      readonly runtime: STC.Runtime.Runtime;
      readonly storage: STC.Storage;

      /** Factories (optional but recommended). */
      readonly collections?: STC.Collection.Factory;
      readonly channels?: STC.Channel.Factory;

      /** Diagnostics context helper (optional). */
      readonly diagnostics?: STC.Diagnostics.Context;

      /** Chat opening convenience (optional). */
      readonly chats?: {
        open(ref: STC.Chat.AdapterRef & { adapter?: STC.Chat.Adapter }): Promise<STC.Chat.Chat>;
      };

      /** Lifecycle hooks. */
      onInit(fn: () => void | Promise<void>): void;
      onDispose(fn: () => void | Promise<void>): void;

      /**
       * Minimal event bus (implementation-defined).
       * Proposal: standardize this later or replace with Channel.
       */
      events?: {
        sub(topic: string, handler: (...args: any[]) => void): STC.Channel.Unsubscribe;
        pub(topic: string, ...args: any[]): void;
      };
    }

    /**
     * App: activated runtime instance built from modules.
     * Exposes API schema and disposal.
     */
    export interface App {
      /** Activate app (init modules, wire handlers). */
      activate(): App;

      /** Dispose resources (idempotent). */
      dispose(): void;

      /** Introspection for docs/cli. */
      getApiSchema(): unknown;
    }

    /** Factory for creating Workbench. */
    export interface Factory {
      create(options?: CreateOptions): Promise<Workbench>;
    }

    export namespace Proposal {
      /** Proposal: plugins system for extending workbench (integrations, docs, etc.). */
      export interface Plugin {
        name: string;
        apply(wb: Workbench): void | Promise<void>;
      }
    }
  }
}

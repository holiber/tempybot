/* eslint-disable @typescript-eslint/no-unused-vars */

export declare namespace STC {
  export namespace Channel {
    export type Id = string;
    export type Unsubscribe = () => void;

    /** Generic event. Tier1: only data + optional system. */
    export type Event<T = unknown> =
      | { kind: "data"; data: T; meta?: Record<string, unknown> }
      | { kind: "system"; type: string; payload?: unknown; meta?: Record<string, unknown> };

    export interface CreateOptions {
      id?: Id;
      signal?: AbortSignal;
      meta?: Record<string, unknown>;
    }

    export interface SubscribeOptions {
      signal?: AbortSignal;
    }

    export interface Channel<T = unknown> {
      id: Id;

      /** Subscribe to events; must be safe to call multiple times. */
      subscribe(
        handler: (event: Event<T>) => void,
        options?: SubscribeOptions
      ): Unsubscribe;

      /** Send a data event. */
      send(data: T, meta?: Record<string, unknown>): Promise<void> | void;

      /** Close channel (idempotent). Must cleanup subscriptions. */
      close(info?: { code?: string | number; reason?: string }): Promise<void> | void;
    }

    export interface Factory {
      create<T = unknown>(options?: CreateOptions): Channel<T>;
    }
  }
}

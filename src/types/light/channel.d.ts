/* eslint-disable @typescript-eslint/no-unused-vars */

export declare namespace STC {
  export namespace Channel {
    export type Id = string;
    export type Unsubscribe = () => void;

    export type Meta<M extends Record<string, unknown> = Record<string, unknown>> = M;

    export type Event<T = unknown, M extends Meta = Meta> =
      | { kind: "data"; data: T; meta?: M }
      | { kind: "system"; type: string; payload?: unknown; meta?: M };

    export interface Capabilities {
      canRead: boolean;
      canWrite: boolean;
    }

    export interface CreateOptions<M extends Meta = Meta> {
      id?: Id;
      caps?: Partial<Capabilities>; // defaults resolved by impl
      meta?: M;
      signal?: AbortSignal;
    }

    export interface SubscribeOptions {
      signal?: AbortSignal;
    }

    /**
     * Channel = streaming primitive.
     * canRead / canWrite define allowed directions.
     */
    export interface Channel<
      T = unknown,
      M extends Meta = Meta
    > {
      readonly id: Id;

      /** Capability snapshot (may be best-effort). */
      readonly caps: Capabilities;

      /** Free-form channel metadata. */
      readonly meta?: M;

      /**
       * Subscribe to events.
       * Must throw or no-op if canRead === false.
       */
      subscribe(
        handler: (event: Event<T, M>) => void,
        options?: SubscribeOptions
      ): Unsubscribe;

      /**
       * Send event into channel.
       * Must reject if canWrite === false.
       */
      send(data: T, meta?: M): Promise<void> | void;

      /**
       * Close channel (idempotent).
       * Must cleanup subscriptions.
       */
      close(info?: { code?: string | number; reason?: string }): Promise<void> | void;
    }

    export interface Factory {
      create<T = unknown, M extends Meta = Meta>(
        options?: CreateOptions<M>
      ): Channel<T, M>;
    }
  }
}

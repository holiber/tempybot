/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STCAPI — World Spec (Tier 1)
 *
 * World = cheap snapshot of observable state.
 * No behavior, no mutation.
 */

export declare namespace STC {
  export namespace World {
    export type Meta<M extends Record<string, unknown> = Record<string, unknown>> = M;

    /**
     * A single observable item in the world.
     * Everything is flattened.
     */
    export interface Item<M extends Meta = Meta> {
      /** Stable identifier (scoped by kind). */
      id: string;

      /** Item kind (open-ended). */
      kind: string; // "chat", "job", "issue", "pr", "comment", ...

      /** Lightweight descriptor / summary. */
      summary?: string;

      /** Free-form metadata (provider refs, status, etc.). */
      meta?: M;
    }

    /**
     * World snapshot.
     * Usually produced by Runtime / Cerebellum.
     */
    export interface World<M extends Meta = Meta> {
      items: Array<Item<M>>;

      /** Snapshot timestamp. */
      ts: string;

      meta?: M;
    }
  }

  /** Convenience alias. */
  export type World = World.World;
}

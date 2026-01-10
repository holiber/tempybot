/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STCAPI — Collection Spec (Tier 1) (minified)
 *
 * Collection = in-memory KV store.
 * Tier1 includes:
 * - flat + tree
 * - deterministic key access
 * - meta generic everywhere
 *
 * Proposal:
 * - query language / filtering
 * - indices
 * - persistence backends
 */

export declare namespace STC {
  export namespace Collection {
    /** Generic meta container (convention). */
    export type Meta<M extends Record<string, unknown> = Record<string, unknown>> = M;

    /** Supported key types (Tier1). */
    export type Key = string | number;

    /** Stored record shape (must allow meta). */
    export type Record<M extends Meta = Meta> = {
      meta?: M;
      [k: string]: unknown;
    };

    /**
     * Convenience alias for "any collection record".
     * Used across other specs (Chat, Diagnostics, Policy, etc).
     */
    export type AnyRecord = Record;

    export type Kind = "flat" | "tree";

    export interface Options<
      K extends Key = Key,
      M extends Meta = Meta
    > {
      name?: string;

      /**
       * If provided, upsert(record) may infer key from record[keyField].
       * (No autoKey in Tier1; if missing -> impl may throw.)
       */
      keyField?: string;

      meta?: M;
    }

    export interface TreeOptions<
      K extends Key = Key,
      M extends Meta = Meta
    > extends Options<K, M> {
      kind: "tree";

      /**
       * Field in record that points to parent key.
       * If absent/undefined => root node.
       */
      parentField: string;
    }

    export type UpsertOp = "create" | "update";

    export interface UpsertResult<K extends Key> {
      key: K;
      op: UpsertOp;
    }

    export interface Collection<
      T extends Record<M>,
      K extends Key = Key,
      M extends Meta = Meta
    > {
      readonly kind: Kind;
      readonly size: number;
      readonly meta?: M;

      get(key: K): T | undefined;
      has(key: K): boolean;

      /**
       * Insert or update.
       * - If key is provided, it wins.
       * - Else impl may infer from options.keyField.
       */
      upsert(record: T, key?: K): UpsertResult<K>;

      delete(key: K): boolean;
      clear(): void;

      /** Unordered snapshot. */
      list(): T[];

      values(): Iterable<T>;
      keys(): Iterable<K>;
    }

    export interface TreeCollection<
      T extends Record<M>,
      K extends Key = Key,
      M extends Meta = Meta
    > extends Collection<T, K, M> {
      readonly kind: "tree";

      /** Direct children for given parent key. */
      childrenOf(parentKey: K): T[];

      /** Parent record for node key (if exists). */
      parentOf(key: K): T | undefined;
    }

    /** Factory for creating collections (usually provided by Runtime/Workbench). */
    export interface Factory {
      create<
        T extends Record<M>,
        K extends Key = Key,
        M extends Meta = Meta
      >(options?: Options<K, M>): Collection<T, K, M>;

      createTree<
        T extends Record<M>,
        K extends Key = Key,
        M extends Meta = Meta
      >(options: TreeOptions<K, M>): TreeCollection<T, K, M>;
    }

    // ----------------------------
    // Proposal (Tier2+)
    // ----------------------------
    export namespace Proposal {
      export interface QueryOptions {
        filter?: unknown;
        sort?: unknown;
        limit?: number;
        skip?: number;
      }

      export interface Index {
        fields: string[];
        unique?: boolean;
        kind?: "btree" | "hash";
      }

      export type Backend = "memory" | "fs" | "db" | "redis" | "rabbitmq";

      export interface BinaryRecord {
        buffer: ArrayBuffer;
        schema?: unknown;
      }
    }
  }
}

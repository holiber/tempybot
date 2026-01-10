/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STCAPI — Collection Spec (Tier 1)
 *
 * Collection = in-memory key-value store with limits and safe defaults.
 * Tier 1 focuses on:
 * - in-memory implementation
 * - generic typing
 * - deterministic key access
 *
 * Proposal:
 * - query language
 * - indices
 * - persistent backends
 */

export declare namespace STC {
  export namespace Collection {
    /** Supported key types (Tier1). */
    export type Key = string | number;

    /** Generic record shape stored in collections. */
    export type AnyRecord = Record<string, unknown>;

    /** Collection kind (Tier1). */
    export type Kind = "flat" | "tree";

    /** Base options for all collections. */
    export interface Options<K extends Key = Key> {
      /** Collection name (for diagnostics/debugging). */
      name?: string;

      /** Explicit key field in record (optional). */
      keyField?: string;

      /**
       * Max number of records allowed.
       * Default: 10000
       * Warning emitted at 90%.
       */
      limit?: number;

      /**
       * If true, collection will auto-generate keys
       * when not provided explicitly.
       */
      autoKey?: boolean;

      /** Collection kind. */
      kind?: Kind;
    }

    /** Tree collection specific options. */
    export interface TreeOptions<K extends Key = Key> extends Options<K> {
      kind: "tree";

      /**
       * Parent reference field.
       * Required for tree collections.
       */
      parentField: string;
    }

    /** Result of upsert operation. */
    export interface UpsertResult<K extends Key> {
      key: K;
      created: boolean;
      updated: boolean;
    }

    /** Base collection interface (Tier1). */
    export interface Collection<T extends AnyRecord, K extends Key = Key> {
      /** Collection kind. */
      readonly kind: Kind;

      /** Number of records stored. */
      readonly size: number;

      /** Collection options (resolved defaults). */
      readonly options: Readonly<Options<K>>;

      /** Get record by key. */
      get(key: K): T | undefined;

      /** Check if key exists. */
      has(key: K): boolean;

      /** Insert or update record. */
      upsert(record: T & Partial<Record<string, K>>): UpsertResult<K>;

      /** Remove record by key. */
      delete(key: K): boolean;

      /** Remove all records. */
      clear(): void;

      /** List all records (unordered). */
      list(): T[];

      /** Iterate over records. */
      values(): Iterable<T>;

      /** Iterate over keys. */
      keys(): Iterable<K>;
    }

    /** Tree collection interface (Tier1). */
    export interface TreeCollection<
      T extends AnyRecord & { [key: string]: K },
      K extends Key = Key
    > extends Collection<T, K> {
      readonly kind: "tree";

      /** Get direct children of a node. */
      getChildren(parentKey: K): T[];

      /** Get parent record (if exists). */
      getParent(key: K): T | undefined;
    }

    /**
     * Factory for creating collections.
     * Usually provided by Workbench/Runtime.
     */
    export interface Factory {
      create<T extends AnyRecord, K extends Key = Key>(
        options?: Options<K>
      ): Collection<T, K>;

      createTree<T extends AnyRecord, K extends Key = Key>(
        options: TreeOptions<K>
      ): TreeCollection<T & { [key: string]: K }, K>;
    }

    // ----------------------------
    // Proposal (Tier2+)
    // ----------------------------
    export namespace Proposal {
      /** Graph collection kinds. */
      export type Kind = "ugraph" | "mgraph";

      /** Query language support (e.g. mingo). */
      export interface QueryOptions {
        filter?: unknown;
        sort?: unknown;
        limit?: number;
        skip?: number;
      }

      /** Indexed collections. */
      export interface Index {
        fields: string[];
        unique?: boolean;
        kind?: "btree" | "hash";
      }

      /** Persistent backends. */
      export type Backend = "memory" | "fs" | "db" | "redis" | "rabbitmq";

      /** Binary / high-performance records (WASM, shared memory). */
      export interface BinaryRecord {
        buffer: ArrayBuffer;
        schema?: unknown;
      }
    }
  }
}

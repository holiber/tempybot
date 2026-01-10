/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STCAPI — Policy Spec (Tier 1)
 *
 * Tier 1:
 * - Policies stored as Markdown files with YAML frontmatter (docs/policy/*.md by default)
 * - Loaded into a PolicyRegistry backed by STC.Collection
 * - Mandatory metadata: id, title
 *
 * Proposal:
 * - enforcement profiles (STRICT, etc.)
 * - runnable checks/lint rules
 * - signatures/attestation
 */

export declare namespace STC {
  export namespace Policy {
    export type Id = string;

    export type Status = "active" | "draft" | "deprecated";

    export interface Record extends STC.Collection.AnyRecord {
      /** Unique policy identifier. */
      id: Id;

      /** Human-readable title. */
      title: string;

      /** Lifecycle status. */
      status?: Status;

      /** Semver-like policy version (string to avoid locking format early). */
      version?: string;

      /** Tags for grouping and search. */
      tags?: string[];

      /**
       * Where it applies (optional).
       * Examples: ["spec", "repo", "cli", "agents", "frontend", "backend"]
       */
      appliesTo?: string[];

      /** Markdown body (without frontmatter). */
      body: string;

      /** Raw frontmatter object (best-effort, implementation-defined). */
      frontmatter?: Record<string, unknown>;

      /** Source info for traceability. */
      source?: {
        path?: string; // e.g. "docs/policy/..."
        modifiedAtMs?: number;
      };

      /** Optional extracted index fields (implementation-defined). */
      index?: {
        headings?: Array<{ level: number; title: string }>;
        links?: string[];
      };
    }

    /**
     * Policy registry is a collection of Policy records.
     * Tier 1: in-memory STC.Collection.
     */
    export interface Registry {
      readonly collection: STC.Collection.Collection<Record>;

      /** Find policy by id (helper). */
      getById(id: Id): Promise<Record | null>;

      /** Build or return table-of-contents. */
      getIndex(): Promise<Index>;
    }

    export interface Index {
      items: Array<{
        id: Id;
        title: string;
        status?: Status;
        version?: string;
        tags?: string[];
        sourcePath?: string;
      }>;
    }

    /**
     * Loads policies from FS into a registry.
     * Tier 1: reads docs/policy/*.md (implementation may be non-recursive).
     */
    export interface Loader {
      load(options?: LoadOptions): Promise<LoadResult>;
    }

    export interface LoadOptions {
      /** Directory containing policy markdown files. */
      dir?: string; // default: "docs/policy"

      /** (proposal) recursive scan */
      recursive?: boolean;

      /** Optional filter by status. */
      status?: Status | Status[];
    }

    export interface LoadResult {
      loaded: number;
      skipped: number;
      errors: Array<{
        path: string;
        error: { message: string; details?: Record<string, unknown> };
      }>;
    }

    export namespace Proposal {
      /** Proposal: policy profile/enforcement set, e.g. STRICT. */
      export interface Profile {
        name: string; // e.g. "STRICT"
        enabledPolicyIds: Id[];
      }

      /** Proposal: runnable checks/lint rules derived from policies. */
      export interface Check {
        id: string;
        title: string;
        run(context: Record<string, unknown>): Promise<Array<{ level: "warn" | "error"; message: string }>>;
      }
    }
  }
}

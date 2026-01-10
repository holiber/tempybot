
/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * STCAPI — Docs & Schemas Spec (Tier 1)
 *
 * Docs are derived artifacts generated from:
 * - API schema
 * - type information
 * - metadata
 * - policy registry
 *
 * Docs are read-only and deterministic.
 */

export declare namespace STC {
  export namespace Docs {
    /** Supported documentation/schema formats (Tier 1). */
    export type Format = "dts" | "jsonSchema" | "openapi";

    /** Generic generation options. */
    export interface GenerateOptions {
      format: Format;

      /** Optional output target. If omitted, result is returned in-memory. */
      output?: {
        /** Write result to FS. */
        fs?: {
          path: string; // e.g. "docs/api/schema.json"
          overwrite?: boolean;
        };
      };

      /** Optional generation hints (format-specific). */
      options?: Record<string, unknown>;
    }

    /** Result of documentation generation. */
    export interface GenerateResult {
      format: Format;

      /** Generated artifact (string or JSON object). */
      content: string | object;

      /** Optional metadata about generation. */
      meta?: {
        generatedAtMs?: number;
        toolVersion?: string;
        warnings?: string[];
      };
    }

    /**
     * Docs generator.
     * Tier 1: pure generation, no side effects except optional FS write.
     */
    export interface Generator {
      generate(options: GenerateOptions): Promise<GenerateResult>;
    }

    /**
     * Factory for creating docs generators.
     * Implementation decides which sources are available.
     */
    export interface Factory {
      create(options: FactoryOptions): Generator;
    }

    export interface FactoryOptions {
      /** API schema source (usually from AppEngine/Workbench). */
      apiSchema?: unknown;

      /** Policy registry for cross-linking or embedding references. */
      policyRegistry?: STC.Policy.Registry;

      /** Storage for optional FS output. */
      storage?: STC.Storage;

      /** Environment hint (affects defaults). */
      environment?: "node" | "web";
    }

    export namespace Proposal {
      export type Format = "asyncapi" | "graphql" | "markdown" | "html";

      /** Proposal: live docs server. */
      export interface LiveServer {
        start(): Promise<void>;
        stop(): Promise<void>;
      }
    }
  }
}

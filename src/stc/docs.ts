import type { Storage } from "./storage.js";
import type { PolicyRegistry } from "./policy.js";

export type DocsFormat = "dts" | "jsonSchema" | "openapi";

export interface DocsGenerateOptions {
  format: DocsFormat;
  output?: {
    fs?: { path: string; overwrite?: boolean };
  };
  options?: Record<string, unknown>;
}

export interface DocsGenerateResult {
  format: DocsFormat;
  content: string | object;
  meta?: {
    generatedAtMs?: number;
    toolVersion?: string;
    warnings?: string[];
  };
}

export interface DocsGenerator {
  generate(options: DocsGenerateOptions): Promise<DocsGenerateResult>;
}

export interface DocsFactoryOptions {
  apiSchema?: unknown;
  policyRegistry?: PolicyRegistry;
  storage?: Storage;
  environment?: "node" | "web";
}

export interface DocsFactory {
  create(options: DocsFactoryOptions): DocsGenerator;
}

export class SimpleDocsGenerator implements DocsGenerator {
  public constructor(private readonly init: DocsFactoryOptions) {}

  public async generate(options: DocsGenerateOptions): Promise<DocsGenerateResult> {
    const generatedAtMs = Date.now();
    const warnings: string[] = [];

    let content: string | object;
    switch (options.format) {
      case "jsonSchema":
        content = {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          title: "STC API Schema (placeholder)",
          type: "object",
          apiSchema: this.init.apiSchema ?? null
        };
        warnings.push("jsonSchema output is a placeholder (Tier1 reference implementation).");
        break;
      case "openapi":
        content = {
          openapi: "3.1.0",
          info: { title: "STC API (placeholder)", version: "0.0.0" },
          paths: {},
          "x-apiSchema": this.init.apiSchema ?? null
        };
        warnings.push("openapi output is a placeholder (Tier1 reference implementation).");
        break;
      case "dts":
      default:
        content = `// STC API typings (placeholder)\n// GeneratedAt: ${new Date(generatedAtMs).toISOString()}\n`;
        warnings.push("dts output is a placeholder (Tier1 reference implementation).");
        break;
    }

    if (options.output?.fs && this.init.storage?.fs) {
      const path = options.output.fs.path;
      const overwrite = options.output.fs.overwrite ?? false;
      const data = typeof content === "string" ? content : JSON.stringify(content, null, 2);
      await this.init.storage.fs.writeFile(path, data, { overwrite });
    }

    return {
      format: options.format,
      content,
      meta: {
        generatedAtMs,
        warnings: warnings.length ? warnings : undefined
      }
    };
  }
}

export class SimpleDocsFactory implements DocsFactory {
  public create(options: DocsFactoryOptions): DocsGenerator {
    return new SimpleDocsGenerator(options);
  }
}


import { z } from "zod";
import { ChannelFactory } from "./channel.js";
import { CollectionFactory } from "./collection.js";
import { DefaultDiagnosticsContext, DiagnosticsFactory, type DiagnosticsContext, type DiagnosticsSink } from "./diagnostics.js";
import { Runtime, type IRuntime, type RuntimeConfig, defaultRuntimeConfig } from "./runtime.js";
import { Storage } from "./storage.js";

/**
 * Workbench-lite (investigation utility)
 * ------------------------------------
 *
 * This is a small "schema-first" API builder that:
 * - composes nested modules (plain objects or other modules)
 * - validates inputs/outputs at runtime via Zod
 * - exposes an introspectable schema tree via `getApiSchema()`
 *
 * Note:
 * - This project now uses workbench-light modules as the SSOT for API + schema + CLI metadata.
 * - workbench-lite remains as a small, schema-first helper with runtime Zod validation.
 */

type UnaryKind = "query" | "mutation";
type Kind = UnaryKind | "stream";

export type Op<K extends UnaryKind, I extends z.ZodTypeAny, O extends z.ZodTypeAny> =
  ((input: z.infer<I>) => Promise<z.infer<O>> | z.infer<O>) & {
    kind: K;
    input: I;
    output: O;
    meta?: Record<string, unknown>;
  };

export type StreamOp<I extends z.ZodTypeAny, C extends z.ZodTypeAny> =
  ((input: z.infer<I>) => AsyncIterable<z.infer<C>>) & {
    kind: "stream";
    input: I;
    chunk: C;
    meta?: Record<string, unknown>;
  };

type AnyOp = Op<any, any, any> | StreamOp<any, any>;

const define =
  <K extends UnaryKind>(kind: K) =>
  <I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
    input: I,
    output: O,
    handler: (i: z.infer<I>) => Promise<z.infer<O>> | z.infer<O>,
    meta?: Record<string, unknown>
  ): Op<K, I, O> =>
    Object.assign(handler, { kind, input, output, meta });

export const query = define("query");
export const mutate = define("mutation");

export const stream = <I extends z.ZodTypeAny, C extends z.ZodTypeAny>(
  input: I,
  chunk: C,
  handler: (i: z.infer<I>) => AsyncIterable<z.infer<C>>,
  meta?: Record<string, unknown>
): StreamOp<I, C> => Object.assign(handler, { kind: "stream" as const, input, chunk, meta });

/** =========================
 *  Schema tree (what getApiSchema returns)
 *  ========================= */
export type ApiSchemaNode =
  | {
      kind: UnaryKind;
      input: z.ZodTypeAny;
      output: z.ZodTypeAny;
      meta?: Record<string, unknown>;
    }
  | {
      kind: "stream";
      input: z.ZodTypeAny;
      chunk: z.ZodTypeAny;
      meta?: Record<string, unknown>;
    }
  | { [key: string]: ApiSchemaNode };

const WB_SCHEMA = Symbol("workbench-light.schema");

type ModuleLike = {
  getApiSchema: () => ApiSchemaNode;
};

function isOp(x: unknown): x is AnyOp {
  const y = x as any;
  return typeof y === "function" && !!y.kind && !!y.input && (!!y.output || !!y.chunk);
}

function isModule(x: unknown): x is ModuleLike & { [WB_SCHEMA]: ApiSchemaNode } {
  const y = x as any;
  return !!y && typeof y === "object" && typeof y.getApiSchema === "function" && !!y[WB_SCHEMA];
}

function buildSchema(node: any): ApiSchemaNode {
  if (isOp(node)) {
    if (node.kind === "stream") {
      return { kind: "stream", input: node.input, chunk: (node as any).chunk, meta: node.meta };
    }
    return { kind: node.kind, input: node.input, output: (node as any).output, meta: node.meta };
  }
  if (isModule(node)) {
    return node.getApiSchema();
  }
  const out: Record<string, ApiSchemaNode> = {};
  for (const k of Object.keys(node)) out[k] = buildSchema(node[k]);
  return out;
}

/** =========================
 *  module()
 *  ========================= */
interface ApiDef {
  [key: string]: AnyOp | ApiDef | ModuleLike;
}

type ApiFromDef<D> =
  D extends Op<any, infer I, infer O>
    ? (input: z.infer<I>) => Promise<z.infer<O>>
    : D extends StreamOp<infer I, infer C>
      ? (input: z.infer<I>) => AsyncIterable<z.infer<C>>
    : D extends ModuleLike
      ? D
    : D extends Record<string, any>
      ? { [K in keyof D]: ApiFromDef<D[K]> }
      : never;

export function module<const D extends ApiDef>(def: D): ApiFromDef<D> & ModuleLike {
  const schema = buildSchema(def);

  const buildRuntime = (node: any): any => {
    if (isOp(node)) {
      if (node.kind === "stream") {
        return (input: unknown) => {
          const parsed = (node as any).input.parse(input);
          const iter = (node as any)(parsed) as AsyncIterable<unknown>;
          return (async function* () {
            for await (const chunk of iter) {
              yield (node as any).chunk.parse(chunk);
            }
          })();
        };
      }

      return async (input: unknown) => {
        const unary = node as Op<any, any, any>;
        const parsed = unary.input.parse(input);
        const out = await unary(parsed);
        return unary.output.parse(out);
      };
    }
    if (isModule(node)) {
      // already built module -> just reuse it as a submodule
      return node;
    }
    const out: any = {};
    for (const k of Object.keys(node)) out[k] = buildRuntime(node[k]);
    return out;
  };

  const apiObj: any = buildRuntime(def);

  Object.defineProperty(apiObj, WB_SCHEMA, {
    value: schema,
    enumerable: false,
    configurable: false,
    writable: false
  });

  Object.defineProperty(apiObj, "getApiSchema", {
    value: () => apiObj[WB_SCHEMA] as ApiSchemaNode,
    enumerable: false,
    configurable: false,
    writable: false
  });

  return apiObj;
}

/**
 * =========================
 * Workbench runtime (Tier1 reference implementation)
 * =========================
 *
 * This intentionally coexists with the "workbench-lite" schema-first helper above.
 */

export type WorkbenchPlatform = "node" | "web" | "auto";

export interface WorkbenchCreateOptions {
  config?: RuntimeConfig;
  configFile?: string;
  configUrl?: string;
  platform?: WorkbenchPlatform;
  storage?: {
    workspace?: string;
    fs?: unknown;
    environment?: "node" | "browser" | "unknown";
  };
  chat?: { adapter?: unknown };
  transport?: { client?: unknown };
  diagnostics?: { sink?: DiagnosticsSink };
}

export type WorkbenchModule = (ctx: WorkbenchModuleContext) => WorkbenchModuleExport;

export interface WorkbenchModuleExport {
  api?: Record<string, unknown>;
  modules?: Record<string, WorkbenchModule>;
}

export interface WorkbenchModuleContext {
  readonly runtime: IRuntime;
  readonly storage: Storage;
  readonly collections?: CollectionFactory;
  readonly channels?: ChannelFactory;
  readonly diagnostics?: DiagnosticsContext;
  readonly chats?: {
    open(ref: Record<string, unknown> & { adapter?: any }): Promise<any>;
  };
  onInit(fn: () => void | Promise<void>): void;
  onDispose(fn: () => void | Promise<void>): void;
  events?: {
    sub(topic: string, handler: (...args: any[]) => void): () => void;
    pub(topic: string, ...args: any[]): void;
  };
}

export interface WorkbenchApp {
  activate(): WorkbenchApp;
  dispose(): void;
  getApiSchema(): unknown;
}

export interface IWorkbench {
  readonly runtime: IRuntime;
  readonly storage: Storage;
  readonly diagnostics?: DiagnosticsSink;
  readonly collections?: CollectionFactory;
  readonly channels?: ChannelFactory;
  readonly chatAdapter?: any;
  createApp(root: WorkbenchModule | WorkbenchModule[]): WorkbenchApp;
}

function toArray<T>(x: T | T[]): T[] {
  return Array.isArray(x) ? x : [x];
}

function mergeSchemas(a: any, b: any): any {
  if (!a) return b;
  if (!b) return a;
  if (typeof a !== "object" || typeof b !== "object") return b;
  const out: any = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = mergeSchemas(out[k], v);
  return out;
}

function schemaFromApi(api: unknown): unknown {
  if (!api || typeof api !== "object") return api;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(api as Record<string, unknown>)) {
    if (typeof v === "function") out[k] = { kind: "function" };
    else if (v && typeof v === "object") out[k] = schemaFromApi(v);
    else out[k] = { kind: typeof v };
  }
  return out;
}

class WorkbenchAppImpl implements WorkbenchApp {
  private activated = false;
  private disposed = false;
  private apiSchema: unknown = {};
  private readonly initHooks: Array<() => void | Promise<void>> = [];
  private readonly disposeHooks: Array<() => void | Promise<void>> = [];

  public constructor(
    private readonly roots: WorkbenchModule[],
    private readonly baseCtx: Omit<WorkbenchModuleContext, "onInit" | "onDispose">
  ) {}

  public activate(): WorkbenchApp {
    if (this.activated) return this;
    this.activated = true;

    const build = (mod: WorkbenchModule): { schema: unknown } => {
      const ctx: WorkbenchModuleContext = {
        ...this.baseCtx,
        onInit: (fn) => this.initHooks.push(fn),
        onDispose: (fn) => this.disposeHooks.push(fn)
      };
      const exp = mod(ctx) ?? {};
      const api = exp.api ?? {};
      const schema = schemaFromApi(api);

      if (exp.modules) {
        for (const [name, child] of Object.entries(exp.modules)) {
          const childRes = build(child);
          (schema as any)[name] = childRes.schema;
        }
      }
      return { schema };
    };

    for (const root of this.roots) {
      const res = build(root);
      this.apiSchema = mergeSchemas(this.apiSchema, res.schema);
    }

    void (async () => {
      for (const fn of this.initHooks) await fn();
    })();

    return this;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    void (async () => {
      for (const fn of this.disposeHooks.reverse()) await fn();
    })();
  }

  public getApiSchema(): unknown {
    return this.apiSchema;
  }
}

export class Workbench implements IWorkbench {
  public readonly runtime: IRuntime;
  public readonly storage: Storage;
  public readonly diagnostics?: DiagnosticsSink;
  public readonly collections?: CollectionFactory;
  public readonly channels?: ChannelFactory;
  public readonly chatAdapter?: any;

  private readonly diagnosticsFactory: DiagnosticsFactory;

  public constructor(options?: WorkbenchCreateOptions) {
    const cfg = options?.config ?? defaultRuntimeConfig("dev");
    this.runtime = new Runtime({ config: cfg, mode: cfg.mode });
    this.storage = new Storage({ workspace: options?.storage?.workspace });

    this.channels = new ChannelFactory();
    this.collections = new CollectionFactory();

    this.diagnosticsFactory = new DiagnosticsFactory({
      channels: this.channels,
      collections: this.collections
    });
    this.diagnostics = options?.diagnostics?.sink ?? this.runtime.createDiagnosticsSink?.();

    this.chatAdapter = options?.chat?.adapter;
  }

  public createApp(root: WorkbenchModule | WorkbenchModule[]): WorkbenchApp {
    const sink = this.diagnostics;
    const diagnosticsCtx = sink ? this.diagnosticsFactory.createContext(sink, { source: "workbench" }) : undefined;

    const baseCtx: Omit<WorkbenchModuleContext, "onInit" | "onDispose"> = {
      runtime: this.runtime,
      storage: this.storage,
      collections: this.collections,
      channels: this.channels,
      diagnostics: diagnosticsCtx,
      chats: {
        open: async (ref) => {
          const adapter = ref.adapter ?? this.chatAdapter;
          if (!adapter || typeof adapter.open !== "function") {
            throw new Error("No chat adapter configured");
          }
          return await adapter.open(ref);
        }
      }
    };

    return new WorkbenchAppImpl(toArray(root), baseCtx);
  }
}

export class WorkbenchFactory {
  public async create(options?: WorkbenchCreateOptions): Promise<IWorkbench> {
    // Tier1 reference impl ignores configFile/configUrl and uses provided config only.
    return new Workbench(options);
  }
}

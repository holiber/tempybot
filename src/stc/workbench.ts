// workbench-light.ts
import type { AnySchema, Schema } from "./schema";

/**
 * Minimal module system + event bus + schema registry + tRPC-like procedure builder.
 *
 * Key properties:
 * - activate() builds runtime and PUSHES API schema into a registry (no tree walk on getApiSchema)
 * - getApiSchema() returns only what is active (O(1))
 * - events.sub() auto-unsubscribes on dispose (scope-bound)
 * - procedure builder: meta/input/output/query|mutate|stream like tRPC
 */

export type ApiSchemaNode =
  | {
      kind: "query" | "mutation";
      input: AnySchema;
      output?: AnySchema; // optional like tRPC
      meta?: Record<string, unknown>;
    }
  | {
      kind: "stream";
      input: AnySchema;
      chunk: AnySchema;
      meta?: Record<string, unknown>;
    }
  | { [key: string]: ApiSchemaNode };

/** =========================
 *  Schema registry
 *  ========================= */

type SchemaRegistry = {
  set(path: string[], node: ApiSchemaNode): void;
  delPrefix(path: string[]): void;
  snapshot(): ApiSchemaNode;
};

function createSchemaRegistry(): SchemaRegistry {
  const root: Record<string, ApiSchemaNode> = {};

  const set = (path: string[], node: ApiSchemaNode) => {
    if (path.length === 0) throw new Error("schema.set: empty path");
    let cur: any = root;
    for (let i = 0; i < path.length - 1; i++) {
      const k = path[i];
      const next = cur[k];
      if (!next || typeof next !== "object" || "kind" in next) cur[k] = {};
      cur = cur[k];
    }
    cur[path[path.length - 1]] = node;
  };

  const delPrefix = (path: string[]) => {
    if (path.length === 0) {
      for (const k of Object.keys(root)) delete root[k];
      return;
    }
    let cur: any = root;
    for (let i = 0; i < path.length - 1; i++) {
      cur = cur?.[path[i]];
      if (!cur || typeof cur !== "object" || "kind" in cur) return;
    }
    delete cur[path[path.length - 1]];
  };

  const snapshot = (): ApiSchemaNode => root as ApiSchemaNode;

  return { set, delPrefix, snapshot };
}

/** =========================
 *  Context + events
 *  ========================= */

export type ModuleCtx = {
  readonly root: RootCtx;

  events: {
    sub(event: string, cb: (payload: unknown) => void): () => void;
    pub(event: string, payload?: unknown): void;
  };

  onDispose(fn: () => void): void;
  scope(): ModuleCtx;
};

type RootCtx = {
  schema: SchemaRegistry;

  _events: {
    sub(event: string, cb: (payload: unknown) => void): () => void;
    pub(event: string, payload?: unknown): void;
  };

  _disposeStack: Array<() => void>;
  disposeAll(): void;
};

function createRootCtx(): RootCtx {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const schema = createSchemaRegistry();
  const disposeStack: Array<() => void> = [];

  const _events: RootCtx["_events"] = {
    sub(event, cb) {
      const set = listeners.get(event) ?? new Set();
      set.add(cb);
      listeners.set(event, set);
      return () => set.delete(cb);
    },
    pub(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const cb of set) cb(payload);
    },
  };

  return {
    schema,
    _events,
    _disposeStack: disposeStack,
    disposeAll() {
      for (let i = disposeStack.length - 1; i >= 0; i--) {
        try {
          disposeStack[i]();
        } catch {}
      }
      disposeStack.length = 0;
      schema.delPrefix([]);
    },
  };
}

function createScope(root: RootCtx): ModuleCtx {
  const localDisposables: Array<() => void> = [];

  const ctx: ModuleCtx = {
    root,

    events: {
      sub(event, cb) {
        const unsub = root._events.sub(event, cb);
        localDisposables.push(unsub); // auto-unsub for this scope
        return unsub;
      },
      pub: root._events.pub,
    },

    onDispose(fn) {
      localDisposables.push(fn);
    },

    scope() {
      return createScope(root);
    },
  };

  root._disposeStack.push(() => {
    for (let i = localDisposables.length - 1; i >= 0; i--) {
      try {
        localDisposables[i]();
      } catch {}
    }
    localDisposables.length = 0;
  });

  return ctx;
}

/** =========================
 *  Procedure ops
 *  ========================= */

export type QueryOp<I, O> = ((input: I, ctx: ModuleCtx) => Promise<O> | O) & {
  kind: "query";
  input: Schema<I>;
  output?: Schema<O>;
  meta?: Record<string, unknown>;
};

export type MutationOp<I, O> = ((input: I, ctx: ModuleCtx) => Promise<O> | O) & {
  kind: "mutation";
  input: Schema<I>;
  output?: Schema<O>;
  meta?: Record<string, unknown>;
};

export type StreamOp<I, C> = ((input: I, ctx: ModuleCtx) => AsyncIterable<C>) & {
  kind: "stream";
  input: Schema<I>;
  chunk: Schema<C>;
  meta?: Record<string, unknown>;
};

type AnyOp = QueryOp<any, any> | MutationOp<any, any> | StreamOp<any, any>;

function isOp(x: any): x is AnyOp {
  return typeof x === "function" && x.kind && x.input && (x.output || x.chunk);
}

const unknownSchema: Schema<unknown> = {
  node: { kind: "literal", value: null }, // not used for validation; placeholder
  meta: { description: "unknown" },
  parse: (v: unknown) => v,
  desc: () => unknownSchema,
  example: () => unknownSchema,
  deprecated: () => unknownSchema,
  kind: () => "literal",
};

const voidSchema: Schema<void> = {
  node: { kind: "literal", value: null },
  meta: { description: "void" },
  parse: (v: unknown) => {
    if (v !== undefined) throw new Error("Expected undefined input");
    return undefined as void;
  },
  desc: () => voidSchema,
  example: () => voidSchema,
  deprecated: () => voidSchema,
  kind: () => "literal",
};

type ProcState = {
  meta?: Record<string, unknown>;
  input?: AnySchema;
  output?: AnySchema;
  chunk?: AnySchema;
};

function makeOp<T extends AnyOp>(fn: any, props: Omit<T, keyof Function>): T {
  return Object.assign(fn, props) as T;
}

export const procedure = (() => {
  const start = (st: ProcState = {}) => ({
    meta(meta: Record<string, unknown>) {
      return start({ ...st, meta: { ...(st.meta ?? {}), ...meta } });
    },

    input<I>(input: Schema<I>) {
      return start({ ...st, input });
    },

    output<O>(output: Schema<O>) {
      return start({ ...st, output });
    },

    chunk<C>(chunk: Schema<C>) {
      return start({ ...st, chunk });
    },

    query<I = void, O = unknown>(
      resolver: (args: { input: I; ctx: ModuleCtx }) => Promise<O> | O
    ): QueryOp<I, O> {
      const inSchema = (st.input ?? voidSchema) as Schema<I>;
      const outSchema = st.output as Schema<O> | undefined;

      const fn = async (raw: I, ctx: ModuleCtx) => resolver({ input: raw, ctx });

      return makeOp<QueryOp<I, O>>(fn, {
        kind: "query",
        input: inSchema,
        output: outSchema,
        meta: st.meta,
      });
    },

    mutate<I = void, O = unknown>(
      resolver: (args: { input: I; ctx: ModuleCtx }) => Promise<O> | O
    ): MutationOp<I, O> {
      const inSchema = (st.input ?? voidSchema) as Schema<I>;
      const outSchema = st.output as Schema<O> | undefined;

      const fn = async (raw: I, ctx: ModuleCtx) => resolver({ input: raw, ctx });

      return makeOp<MutationOp<I, O>>(fn, {
        kind: "mutation",
        input: inSchema,
        output: outSchema,
        meta: st.meta,
      });
    },

    stream<I = void, C = unknown>(
      resolver: (args: { input: I; ctx: ModuleCtx }) => AsyncIterable<C>
    ): StreamOp<I, C> {
      const inSchema = (st.input ?? voidSchema) as Schema<I>;
      const chSchema = (st.chunk ?? unknownSchema) as Schema<C>;

      const fn = (raw: I, ctx: ModuleCtx) => resolver({ input: raw, ctx });

      return makeOp<StreamOp<I, C>>(fn, {
        kind: "stream",
        input: inSchema,
        chunk: chSchema,
        meta: st.meta,
      });
    },
  });

  return start();
})();

/** =========================
 *  Module: def / activation
 *  ========================= */

const WB_REF = Symbol("wb.moduleRef");

export type ApiDef = Record<string, AnyOp | ApiDef | ModuleRef<any>>;
export type ModuleFactory<D extends ApiDef> = (ctx: ModuleCtx) => { api: D };

type ApiFromDef<D> =
  D extends QueryOp<infer I, infer O>
    ? (input: I) => Promise<O>
    : D extends MutationOp<infer I, infer O>
      ? (input: I) => Promise<O>
      : D extends StreamOp<infer I, infer C>
        ? (input: I) => AsyncIterable<C>
        : D extends ModuleRef<infer TApi>
          ? TApi
          : D extends Record<string, any>
            ? { [K in keyof D]: ApiFromDef<D[K]> }
            : never;

export type BuiltModule<TApi> = TApi & {
  getApiSchema(): ApiSchemaNode;
  dispose(): void;
};

export type ModuleRef<TApi> = {
  [WB_REF]: true;
  activate(ctx?: ModuleCtx, path?: string[]): BuiltModule<TApi>;
};

function isModuleRef(x: any): x is ModuleRef<any> {
  return !!x?.[WB_REF];
}

function mount(node: any, ctx: ModuleCtx, path: string[]): any {
  if (isOp(node)) {
    if (node.kind === "stream") {
      ctx.root.schema.set(path, {
        kind: "stream",
        input: node.input as AnySchema,
        chunk: (node as any).chunk as AnySchema,
        meta: node.meta,
      });

      return (raw: unknown) => {
        const parsedIn = node.input.parse(raw);
        const iter = (node as any)(parsedIn, ctx) as AsyncIterable<unknown>;

        return (async function* () {
          for await (const c of iter) yield (node as any).chunk.parse(c);
        })();
      };
    }

    ctx.root.schema.set(path, {
      kind: node.kind,
      input: node.input as AnySchema,
      output: (node as any).output as AnySchema | undefined,
      meta: node.meta,
    });

    return async (raw: unknown) => {
      const parsedIn = node.input.parse(raw);
      const out = await (node as any)(parsedIn, ctx);
      return (node as any).output ? (node as any).output.parse(out) : out;
    };
  }

  if (isModuleRef(node)) {
    return node.activate(ctx, path);
  }

  const out: any = {};
  for (const k of Object.keys(node)) out[k] = mount(node[k], ctx, [...path, k]);
  return out;
}

export function module<D extends ApiDef>(def: D): ModuleRef<ApiFromDef<D>>;
export function module<D extends ApiDef>(factory: ModuleFactory<D>): ModuleRef<ApiFromDef<D>>;
export function module(arg: any): ModuleRef<any> {
  const cache = new WeakMap<RootCtx, Map<string, BuiltModule<any>>>();

  const getDef = (ctx: ModuleCtx): ApiDef => (typeof arg === "function" ? arg(ctx).api : arg);

  const ref: ModuleRef<any> = {
    [WB_REF]: true,

    activate(ctx?: ModuleCtx, path: string[] = []) {
      const root = ctx?.root ?? createRootCtx();
      const host = ctx ?? createScope(root);

      const pathKey = path.join(".");
      let byPath = cache.get(root);
      if (!byPath) {
        byPath = new Map();
        cache.set(root, byPath);
      }
      const cached = byPath.get(pathKey);
      if (cached) return cached;

      const scope = host.scope();

      if (path.length > 0) {
        scope.onDispose(() => root.schema.delPrefix(path));
      }

      const def = getDef(scope);
      const apiObj: any = mount(def, scope, path);

      Object.defineProperty(apiObj, "getApiSchema", {
        value: () => root.schema.snapshot(),
        enumerable: false,
      });

      Object.defineProperty(apiObj, "dispose", {
        value: () => root.disposeAll(),
        enumerable: false,
      });

      byPath.set(pathKey, apiObj);
      return apiObj;
    },
  };

  return ref;
}

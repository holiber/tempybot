import { z } from "zod";

/** =========================
 *  Schema types
 *  ========================= */

export type ApiSchemaNode =
  | {
      kind: "query" | "mutation";
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

/** =========================
 *  Context
 *  ========================= */

type SchemaRegistry = {
  set(path: string[], node: ApiSchemaNode): void;
  delPrefix(path: string[]): void;
  snapshot(): ApiSchemaNode;
};

function createSchemaRegistry(): SchemaRegistry {
  const root: Record<string, ApiSchemaNode> = {};

  const set = (path: string[], node: ApiSchemaNode) => {
    if (path.length === 0) throw new Error("schema.set: empty path is not allowed");
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

export type ModuleCtx = {
  readonly root: RootCtx;

  events: {
    sub(event: string, cb: (payload: unknown) => void): () => void;
    pub(event: string, payload?: unknown): void;
  };

  /** add cleanup for this module scope */
  onDispose(fn: () => void): void;

  /** make child scope that shares events + schema, but has its own disposables list */
  scope(): ModuleCtx;
};

type RootCtx = {
  schema: SchemaRegistry;

  /** low-level bus; scopes will wrap it to auto-dispose subs */
  _events: {
    sub(event: string, cb: (payload: unknown) => void): () => void;
    pub(event: string, payload?: unknown): void;
  };

  /** root-wide dispose stack */
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
        } catch {
          // keep minimal
        }
      }
      disposeStack.length = 0;
      schema.delPrefix([]); // clear whole schema
    },
  };
}

function createScope(root: RootCtx): ModuleCtx {
  const localDisposables: Array<() => void> = [];

  const ctx: ModuleCtx = {
    root,

    // IMPORTANT: auto-dispose subscriptions created by this scope
    events: {
      sub(event, cb) {
        const unsub = root._events.sub(event, cb);
        localDisposables.push(unsub);
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

  // register this scope cleanup into root cleanup, preserving LIFO
  root._disposeStack.push(() => {
    for (let i = localDisposables.length - 1; i >= 0; i--) {
      try {
        localDisposables[i]();
      } catch {
        // keep minimal
      }
    }
    localDisposables.length = 0;
  });

  return ctx;
}

/** =========================
 *  Ops: query / mutate / stream
 *  ========================= */

export type QueryOp<I extends z.ZodTypeAny, O extends z.ZodTypeAny> = ((
  input: z.infer<I>,
  ctx: ModuleCtx
) => Promise<z.infer<O>> | z.infer<O>) & {
  kind: "query";
  input: I;
  output: O;
  meta?: Record<string, unknown>;
};

export type MutationOp<I extends z.ZodTypeAny, O extends z.ZodTypeAny> = ((
  input: z.infer<I>,
  ctx: ModuleCtx
) => Promise<z.infer<O>> | z.infer<O>) & {
  kind: "mutation";
  input: I;
  output: O;
  meta?: Record<string, unknown>;
};

export type StreamOp<I extends z.ZodTypeAny, C extends z.ZodTypeAny> = ((
  input: z.infer<I>,
  ctx: ModuleCtx
) => AsyncIterable<z.infer<C>>) & {
  kind: "stream";
  input: I;
  chunk: C;
  meta?: Record<string, unknown>;
};

type AnyOp = QueryOp<any, any> | MutationOp<any, any> | StreamOp<any, any>;

export const query = <I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  input: I,
  output: O,
  handler: (i: z.infer<I>, ctx: ModuleCtx) => Promise<z.infer<O>> | z.infer<O>,
  meta?: Record<string, unknown>
): QueryOp<I, O> => Object.assign(handler, { kind: "query" as const, input, output, meta });

export const mutate = <I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  input: I,
  output: O,
  handler: (i: z.infer<I>, ctx: ModuleCtx) => Promise<z.infer<O>> | z.infer<O>,
  meta?: Record<string, unknown>
): MutationOp<I, O> => Object.assign(handler, { kind: "mutation" as const, input, output, meta });

export const stream = <I extends z.ZodTypeAny, C extends z.ZodTypeAny>(
  input: I,
  chunk: C,
  handler: (i: z.infer<I>, ctx: ModuleCtx) => AsyncIterable<z.infer<C>>,
  meta?: Record<string, unknown>
): StreamOp<I, C> => Object.assign(handler, { kind: "stream" as const, input, chunk, meta });

function isOp(x: any): x is AnyOp {
  return typeof x === "function" && x.kind && x.input && (x.output || x.chunk);
}

/** =========================
 *  Module: def / activation
 *  ========================= */

const WB_REF = Symbol("wb.moduleRef");

export type ApiDef = Record<string, AnyOp | ApiDef | ModuleRef<any>>;
export type ModuleFactory<D extends ApiDef> = (ctx: ModuleCtx) => { api: D };

type ApiFromDef<D> =
  D extends QueryOp<infer I, infer O>
    ? (input: z.infer<I>) => Promise<z.infer<O>>
    : D extends MutationOp<infer I, infer O>
      ? (input: z.infer<I>) => Promise<z.infer<O>>
      : D extends StreamOp<infer I, infer C>
        ? (input: z.infer<I>) => AsyncIterable<z.infer<C>>
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

/**
 * Build runtime AND push schema into root registry while walking the def.
 * This happens only during activation (not during getApiSchema()).
 */
function mount(node: any, ctx: ModuleCtx, path: string[]): any {
  if (isOp(node)) {
    if (node.kind === "stream") {
      ctx.root.schema.set(path, {
        kind: "stream",
        input: node.input,
        chunk: (node as any).chunk,
        meta: node.meta,
      });

      return (input: unknown) => {
        const parsedIn = node.input.parse(input);
        const iter = (node as any)(parsedIn, ctx) as AsyncIterable<unknown>;

        return (async function* () {
          for await (const c of iter) {
            yield (node as any).chunk.parse(c);
          }
        })();
      };
    }

    ctx.root.schema.set(path, {
      kind: node.kind,
      input: node.input,
      output: (node as any).output,
      meta: node.meta,
    });

    return async (input: unknown) => {
      const parsedIn = node.input.parse(input);
      const out = await (node as any)(parsedIn, ctx);
      return (node as any).output.parse(out);
    };
  }

  if (isModuleRef(node)) {
    // Activate submodule into the SAME root ctx, and under the current path.
    return node.activate(ctx, path);
  }

  const out: any = {};
  for (const k of Object.keys(node)) {
    out[k] = mount(node[k], ctx, [...path, k]);
  }
  return out;
}

export function module<D extends ApiDef>(def: D): ModuleRef<ApiFromDef<D>>;
export function module<D extends ApiDef>(factory: ModuleFactory<D>): ModuleRef<ApiFromDef<D>>;
export function module(arg: any): ModuleRef<any> {
  // Cache per root ctx + pathKey to prevent double activation.
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

      // Each module instance gets its own scope (own disposables),
      // but shares root events + schema.
      const scope = host.scope();

      // If this module is mounted under a non-empty path, ensure cleanup removes that subtree.
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

/** Convenience helper: activate root module without passing ctx */
export function activate<TApi>(root: ModuleRef<TApi>): BuiltModule<TApi> {
  return root.activate(undefined, []);
}

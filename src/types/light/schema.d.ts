// schema.ts
import { z } from "zod";

/**
 * A small, typed schema DSL with reliable validation via pluggable backends.
 * Default backend here is Zod (compile-to-zod + cache).
 *
 * Goals:
 * - Strong TypeScript inference
 * - Stable introspection (AST) for CLI/docs
 * - Reliable runtime validation (as reliable as Zod)
 * - Ability to swap backend later (Valibot/Ajv/custom), without changing call-sites
 */

export type Meta = {
  description?: string;
  example?: unknown;
  deprecated?: boolean;
  [k: string]: unknown;
};

export type Node =
  | { kind: "string" }
  | { kind: "number"; int?: boolean }
  | { kind: "boolean" }
  | { kind: "literal"; value: string | number | boolean | null }
  | { kind: "object"; shape: Record<string, AnySchema> }
  | { kind: "array"; element: AnySchema }
  | { kind: "optional"; inner: AnySchema };

export type Schema<T> = {
  readonly node: Node;
  readonly meta: Meta;

  parse(v: unknown): T;

  desc(text: string): Schema<T>;
  example(v: unknown): Schema<T>;
  deprecated(): Schema<T>;

  /** Introspection helpers (optional convenience) */
  kind(): Node["kind"];
};

export type AnySchema = Schema<any>;
export type Infer<S extends AnySchema> = S extends Schema<infer T> ? T : never;

export type SchemaBackend = {
  compile(schema: AnySchema): { parse(v: unknown): unknown };
};

let backend: SchemaBackend | null = null;

/** Set backend globally (recommended). */
export function setSchemaBackend(b: SchemaBackend) {
  backend = b;
}

/** Default backend: Zod */
export function zodBackend(): SchemaBackend {
  const cache = new WeakMap<AnySchema, z.ZodTypeAny>();

  const compileToZod = (schema: AnySchema): z.ZodTypeAny => {
    const cached = cache.get(schema);
    if (cached) return cached;

    const n = schema.node;
    let out: z.ZodTypeAny;

    switch (n.kind) {
      case "string":
        out = z.string();
        break;
      case "number":
        out = n.int ? z.number().int() : z.number();
        break;
      case "boolean":
        out = z.boolean();
        break;
      case "literal":
        out = z.literal(n.value as any);
        break;
      case "object": {
        const shape: Record<string, z.ZodTypeAny> = {};
        for (const k of Object.keys(n.shape)) shape[k] = compileToZod(n.shape[k]);
        out = z.object(shape);
        break;
      }
      case "array":
        out = z.array(compileToZod(n.element));
        break;
      case "optional":
        out = compileToZod(n.inner).optional();
        break;
      default:
        throw new Error(`Unknown schema kind: ${(n as any).kind}`);
    }

    // Attach meta to Zod too (useful for debugging; our system doesn't rely on it).
    out = out.meta?.(schema.meta) ?? out;

    cache.set(schema, out);
    return out;
  };

  return {
    compile(schema) {
      const zodSchema = compileToZod(schema);
      return { parse: (v: unknown) => zodSchema.parse(v) };
    },
  };
}

function ensureBackend(): SchemaBackend {
  if (!backend) backend = zodBackend();
  return backend;
}

class BaseSchema<T> implements Schema<T> {
  public readonly node: Node;
  public readonly meta: Meta;

  private compiled?: { parse(v: unknown): unknown };

  constructor(node: Node, meta: Meta = {}) {
    this.node = node;
    this.meta = meta;
  }

  kind(): Node["kind"] {
    return this.node.kind;
  }

  parse(v: unknown): T {
    if (!this.compiled) this.compiled = ensureBackend().compile(this);
    return this.compiled.parse(v) as T;
  }

  desc(text: string): Schema<T> {
    return new BaseSchema<T>(this.node, { ...this.meta, description: text });
  }

  example(v: unknown): Schema<T> {
    return new BaseSchema<T>(this.node, { ...this.meta, example: v });
  }

  deprecated(): Schema<T> {
    return new BaseSchema<T>(this.node, { ...this.meta, deprecated: true });
  }
}

/** Builders (no prefix) */
export const str = () => new BaseSchema<string>({ kind: "string" });
export const num = () => new BaseSchema<number>({ kind: "number" });
export const int = () => new BaseSchema<number>({ kind: "number", int: true });
export const bool = () => new BaseSchema<boolean>({ kind: "boolean" });

export const lit = <T extends string | number | boolean | null>(value: T) =>
  new BaseSchema<T>({ kind: "literal", value });

export const obj = <S extends Record<string, AnySchema>>(shape: S) => {
  type Out = { [K in keyof S]: Infer<S[K]> };
  return new BaseSchema<Out>({ kind: "object", shape });
};

export const arr = <E extends AnySchema>(element: E) => {
  type Out = Array<Infer<E>>;
  return new BaseSchema<Out>({ kind: "array", element });
};

export const opt = <I extends AnySchema>(inner: I) => {
  type Out = Infer<I> | undefined;
  return new BaseSchema<Out>({ kind: "optional", inner });
};

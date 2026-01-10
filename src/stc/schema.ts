/**
 * Minimal runtime schema helpers used by `src/stc/workbench.ts`.
 *
 * Notes:
 * - This is intentionally small (not a full validation library).
 * - Schemas validate at runtime via `parse()` and carry basic metadata.
 * - The `.node` field is a lightweight descriptor that can be used for introspection.
 */

export type SchemaNode =
  | { kind: "string" }
  | { kind: "array"; item: SchemaNode }
  | { kind: "object"; shape: Record<string, SchemaNode> }
  | { kind: "optional"; inner: SchemaNode }
  | { kind: "literal"; value: unknown };

export type SchemaMeta = {
  description?: string;
  example?: unknown;
  deprecated?: boolean;
};

export type Schema<T> = {
  node: SchemaNode;
  meta: SchemaMeta;
  parse(v: unknown): T;

  /** attach a human description */
  desc(description: string): Schema<T>;
  /** attach an example value */
  example(example: unknown): Schema<T>;
  /** mark as deprecated */
  deprecated(isDeprecated?: boolean): Schema<T>;
  /** returns the node "kind" for debugging */
  kind(): SchemaNode["kind"];
};

export type AnySchema = Schema<any>;

function withMeta<T>(base: Schema<T>, patch: Partial<SchemaMeta>): Schema<T> {
  const meta: SchemaMeta = { ...base.meta, ...patch };
  return makeSchema(base.node, meta, base.parse);
}

function makeSchema<T>(node: SchemaNode, meta: SchemaMeta, parse: (v: unknown) => T): Schema<T> {
  const self: Schema<T> = {
    node,
    meta,
    parse,
    desc(description) {
      return withMeta(self, { description });
    },
    example(example) {
      return withMeta(self, { example });
    },
    deprecated(isDeprecated = true) {
      return withMeta(self, { deprecated: isDeprecated });
    },
    kind() {
      return node.kind;
    },
  };
  return self;
}

export function str(): Schema<string> {
  return makeSchema(
    { kind: "string" },
    {},
    (v) => {
      if (typeof v !== "string") throw new Error("Expected string");
      return v;
    }
  );
}

export function opt<T>(inner: Schema<T>): Schema<T | undefined> {
  return makeSchema(
    { kind: "optional", inner: inner.node },
    {},
    (v) => {
      if (v === undefined) return undefined;
      return inner.parse(v);
    }
  );
}

export function arr<T>(item: Schema<T>): Schema<T[]> {
  return makeSchema(
    { kind: "array", item: item.node },
    {},
    (v) => {
      if (!Array.isArray(v)) throw new Error("Expected array");
      return v.map((x) => item.parse(x));
    }
  );
}

export function obj<S extends Record<string, AnySchema>>(
  shape: S
): Schema<{ [K in keyof S]: S[K] extends Schema<infer T> ? T : never }> {
  const nodeShape: Record<string, SchemaNode> = {};
  for (const k of Object.keys(shape)) nodeShape[k] = shape[k].node;

  return makeSchema(
    { kind: "object", shape: nodeShape },
    {},
    (v) => {
      if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("Expected object");
      const rec = v as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(shape)) {
        // If missing, pass `undefined` through (works with `opt(...)`).
        const raw = Object.prototype.hasOwnProperty.call(rec, k) ? rec[k] : undefined;
        out[k] = shape[k].parse(raw);
      }
      return out as any;
    }
  );
}

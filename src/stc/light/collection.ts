import type { STC } from "../../types/light/stc.js";

export type CollectionMeta<M extends Record<string, unknown> = Record<string, unknown>> = STC.Collection.Meta<M>;
export type CollectionKey = STC.Collection.Key;
export type CollectionRecord<M extends CollectionMeta = CollectionMeta> = STC.Collection.Record<M>;
export type CollectionKind = STC.Collection.Kind;
export type CollectionOptions<
  K extends CollectionKey = CollectionKey,
  M extends CollectionMeta = CollectionMeta
> = STC.Collection.Options<K, M>;
export type TreeCollectionOptions<
  K extends CollectionKey = CollectionKey,
  M extends CollectionMeta = CollectionMeta
> = STC.Collection.TreeOptions<K, M>;
export type UpsertOp = STC.Collection.UpsertOp;
export type UpsertResult<K extends CollectionKey> = STC.Collection.UpsertResult<K>;
export type ICollection<
  T extends CollectionRecord<M>,
  K extends CollectionKey = CollectionKey,
  M extends CollectionMeta = CollectionMeta
> = STC.Collection.Collection<T, K, M>;
export type ITreeCollection<
  T extends CollectionRecord<M>,
  K extends CollectionKey = CollectionKey,
  M extends CollectionMeta = CollectionMeta
> = STC.Collection.TreeCollection<T, K, M>;

function inferKey<K extends CollectionKey>(record: Record<string, unknown>, keyField: string): K | undefined {
  const v = record[keyField] as K | undefined;
  if (v === undefined || v === null) return undefined;
  return v;
}

export class InMemoryCollection<
  T extends CollectionRecord<M>,
  K extends CollectionKey = CollectionKey,
  M extends CollectionMeta = CollectionMeta
> implements STC.Collection.Collection<T, K, M>
{
  public readonly kind: CollectionKind = "flat";
  public readonly meta?: M;

  protected readonly options: Readonly<CollectionOptions<K, M>>;
  protected readonly map = new Map<K, T>();
  protected readonly keyField?: string;

  public constructor(options?: CollectionOptions<K, M>) {
    this.options = {
      name: options?.name,
      keyField: options?.keyField,
      meta: options?.meta
    };
    this.meta = options?.meta;
    this.keyField = options?.keyField;
  }

  public get size(): number {
    return this.map.size;
  }

  public get(key: K): T | undefined {
    return this.map.get(key);
  }

  public has(key: K): boolean {
    return this.map.has(key);
  }

  public upsert(record: T, key?: K): UpsertResult<K> {
    const resolvedKey =
      key ??
      (this.keyField ? inferKey<K>(record as Record<string, unknown>, this.keyField) : undefined);

    if (resolvedKey === undefined) {
      const name = this.options.name ? ` (${this.options.name})` : "";
      throw new Error(`Cannot upsert without key${name}`);
    }

    const existed = this.map.has(resolvedKey);
    this.map.set(resolvedKey, record);
    return { key: resolvedKey, op: existed ? "update" : "create" };
  }

  public delete(key: K): boolean {
    return this.map.delete(key);
  }

  public clear(): void {
    this.map.clear();
  }

  public list(): T[] {
    return Array.from(this.map.values());
  }

  public values(): Iterable<T> {
    return this.map.values();
  }

  public keys(): Iterable<K> {
    return this.map.keys();
  }
}

export class InMemoryTreeCollection<
  T extends CollectionRecord<M>,
  K extends CollectionKey = CollectionKey,
  M extends CollectionMeta = CollectionMeta
> extends InMemoryCollection<T, K, M> implements STC.Collection.TreeCollection<T, K, M> {
  public override readonly kind: "tree" = "tree";
  private readonly parentField: string;

  public constructor(options: TreeCollectionOptions<K, M>) {
    super(options);
    this.parentField = options.parentField;
  }

  public childrenOf(parentKey: K): T[] {
    const out: T[] = [];
    for (const r of this.values()) {
      const parent = (r as any)[this.parentField] as K | undefined;
      if (parent === parentKey) out.push(r);
    }
    return out;
  }

  public parentOf(key: K): T | undefined {
    const self = this.get(key);
    if (!self) return undefined;
    const parent = (self as any)[this.parentField] as K | undefined;
    if (parent === undefined) return undefined;
    return this.get(parent);
  }
}

export class CollectionFactory {
  public create<T extends CollectionRecord<M>, K extends CollectionKey = CollectionKey, M extends CollectionMeta = CollectionMeta>(
    options?: CollectionOptions<K, M>
  ): STC.Collection.Collection<T, K, M> {
    return new InMemoryCollection<T, K, M>(options);
  }

  public createTree<
    T extends CollectionRecord<M>,
    K extends CollectionKey = CollectionKey,
    M extends CollectionMeta = CollectionMeta
  >(options: TreeCollectionOptions<K, M>): InMemoryTreeCollection<T, K, M> {
    return new InMemoryTreeCollection<T, K, M>(options);
  }
}


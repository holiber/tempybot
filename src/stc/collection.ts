export type CollectionKey = string | number;

export type AnyRecord = Record<string, unknown>;

export type CollectionKind = "flat" | "tree";

export interface CollectionOptions<K extends CollectionKey = CollectionKey> {
  name?: string;
  keyField?: string;
  limit?: number;
  autoKey?: boolean;
  kind?: CollectionKind;
}

export interface TreeCollectionOptions<K extends CollectionKey = CollectionKey> extends CollectionOptions<K> {
  kind: "tree";
  parentField: string;
}

export interface UpsertResult<K extends CollectionKey> {
  key: K;
  created: boolean;
  updated: boolean;
}

export interface ICollection<T extends AnyRecord, K extends CollectionKey = CollectionKey> {
  readonly kind: CollectionKind;
  readonly size: number;
  readonly options: Readonly<CollectionOptions<K>>;

  get(key: K): T | undefined;
  has(key: K): boolean;
  upsert(record: T & Record<string, unknown>): UpsertResult<K>;
  delete(key: K): boolean;
  clear(): void;
  list(): T[];
  values(): Iterable<T>;
  keys(): Iterable<K>;
}

export interface ITreeCollection<
  T extends AnyRecord & { [key: string]: K },
  K extends CollectionKey = CollectionKey
> extends ICollection<T, K> {
  readonly kind: "tree";
  getChildren(parentKey: K): T[];
  getParent(key: K): T | undefined;
}

function defaultLimit(): number {
  return 10_000;
}

function pickKey<K extends CollectionKey>(
  record: Record<string, unknown>,
  keyField: string
): K | undefined {
  const v = record[keyField] as K | undefined;
  if (v === undefined || v === null) return undefined;
  return v;
}

function normalizeKeyField(options?: CollectionOptions): string {
  return options?.keyField ?? "id";
}

export class InMemoryCollection<T extends AnyRecord, K extends CollectionKey = CollectionKey>
  implements ICollection<T, K>
{
  public readonly kind: CollectionKind = "flat";
  public readonly options: Readonly<CollectionOptions<K>>;

  private readonly map = new Map<K, T>();
  private autoInc = 0;
  private readonly keyField: string;

  public constructor(options?: CollectionOptions<K>) {
    this.options = {
      name: options?.name,
      keyField: options?.keyField,
      limit: options?.limit ?? defaultLimit(),
      autoKey: options?.autoKey ?? true,
      kind: options?.kind ?? "flat"
    };
    this.kind = this.options.kind ?? "flat";
    this.keyField = normalizeKeyField(this.options);
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

  public upsert(record: T & Record<string, unknown>): UpsertResult<K> {
    const limit = this.options.limit ?? defaultLimit();
    if (this.map.size >= limit) {
      throw new Error(
        `Collection limit exceeded${this.options.name ? ` (${this.options.name})` : ""}: ${limit}`
      );
    }

    let key = pickKey<K>(record as Record<string, unknown>, this.keyField);
    if (key === undefined) {
      if (!this.options.autoKey) {
        throw new Error(
          `Missing key field '${this.keyField}'${this.options.name ? ` for collection ${this.options.name}` : ""}`
        );
      }
      // Best-effort key generation:
      // - Tier1 spec does not mandate the generated key type.
      // - We default to string keys for stability across JS runtimes.
      this.autoInc += 1;
      key = `${this.autoInc}` as unknown as K;
      (record as any)[this.keyField] = key;
    }

    const existed = this.map.has(key);
    this.map.set(key, record);
    return { key, created: !existed, updated: existed };
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
  T extends AnyRecord & { [key: string]: K },
  K extends CollectionKey = CollectionKey
> extends InMemoryCollection<T, K> implements ITreeCollection<T, K> {
  public override readonly kind: "tree" = "tree";
  private readonly parentField: string;

  public constructor(options: TreeCollectionOptions<K>) {
    super({ ...options, kind: "tree" });
    this.parentField = options.parentField;
  }

  public getChildren(parentKey: K): T[] {
    const out: T[] = [];
    for (const r of this.values()) {
      const p = (r as any)[this.parentField] as K | undefined;
      if (p === parentKey) out.push(r);
    }
    return out;
  }

  public getParent(key: K): T | undefined {
    const self = this.get(key);
    if (!self) return undefined;
    const p = (self as any)[this.parentField] as K | undefined;
    if (p === undefined) return undefined;
    return this.get(p);
  }
}

export class CollectionFactory {
  public create<T extends AnyRecord, K extends CollectionKey = CollectionKey>(
    options?: CollectionOptions<K>
  ): InMemoryCollection<T, K> {
    return new InMemoryCollection<T, K>(options);
  }

  public createTree<T extends AnyRecord, K extends CollectionKey = CollectionKey>(
    options: TreeCollectionOptions<K>
  ): InMemoryTreeCollection<T & { [key: string]: K }, K> {
    return new InMemoryTreeCollection<T & { [key: string]: K }, K>(options);
  }
}


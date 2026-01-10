import matter from "gray-matter";
import { CollectionFactory, type ICollection } from "./collection.js";
import type { IFS } from "./fs.js";

export type PolicyId = string;
export type PolicyStatus = "active" | "draft" | "deprecated";

export interface PolicyRecord extends Record<string, unknown> {
  id: PolicyId;
  title: string;
  status?: PolicyStatus;
  version?: string;
  tags?: string[];
  appliesTo?: string[];
  body: string;
  frontmatter?: Record<string, unknown>;
  source?: {
    path?: string;
    modifiedAtMs?: number;
  };
  index?: {
    headings?: Array<{ level: number; title: string }>;
    links?: string[];
  };
}

export interface PolicyIndex {
  items: Array<{
    id: PolicyId;
    title: string;
    status?: PolicyStatus;
    version?: string;
    tags?: string[];
    sourcePath?: string;
  }>;
}

export interface PolicyRegistry {
  readonly collection: ICollection<PolicyRecord, string>;
  getById(id: PolicyId): Promise<PolicyRecord | null>;
  getIndex(): Promise<PolicyIndex>;
}

export interface PolicyLoadOptions {
  dir?: string;
  recursive?: boolean;
  status?: PolicyStatus | PolicyStatus[];
}

export interface PolicyLoadResult {
  loaded: number;
  skipped: number;
  errors: Array<{ path: string; error: { message: string; details?: Record<string, unknown> } }>;
}

export interface PolicyLoader {
  load(options?: PolicyLoadOptions): Promise<PolicyLoadResult>;
}

function isMarkdown(name: string): boolean {
  return name.endsWith(".md") || name.endsWith(".markdown");
}

async function listFiles(fs: IFS, dir: string, recursive: boolean): Promise<string[]> {
  const entries = await fs.readdir(dir);
  const out: string[] = [];
  for (const entry of entries) {
    const full = fs.join(dir, entry);
    const st = await fs.stat(full);
    if (st.isDirectory && recursive) {
      out.push(...(await listFiles(fs, full, recursive)));
    } else if (st.isFile && isMarkdown(entry)) {
      out.push(full);
    }
  }
  return out;
}

export class InMemoryPolicyRegistry implements PolicyRegistry {
  public readonly collection: ICollection<PolicyRecord, string>;
  public constructor(collection: ICollection<PolicyRecord, string>) {
    this.collection = collection;
  }

  public async getById(id: PolicyId): Promise<PolicyRecord | null> {
    return this.collection.get(id) ?? null;
  }

  public async getIndex(): Promise<PolicyIndex> {
    const items = this.collection
      .list()
      .map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        version: p.version,
        tags: p.tags,
        sourcePath: p.source?.path
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return { items };
  }
}

export class MarkdownPolicyLoader implements PolicyLoader {
  public readonly registry: PolicyRegistry;

  public constructor(
    private readonly deps: {
      fs: IFS;
      registry?: PolicyRegistry;
      collectionFactory?: CollectionFactory;
    }
  ) {
    const collection =
      deps.registry?.collection ??
      (deps.collectionFactory ?? new CollectionFactory()).create<PolicyRecord, string>({
        name: "policy.registry",
        keyField: "id",
        autoKey: false
      });
    this.registry = deps.registry ?? new InMemoryPolicyRegistry(collection);
  }

  public async load(options?: PolicyLoadOptions): Promise<PolicyLoadResult> {
    const dir = options?.dir ?? "docs/policy";
    const recursive = options?.recursive ?? false;
    const statusFilter = options?.status;
    const statuses = statusFilter ? (Array.isArray(statusFilter) ? statusFilter : [statusFilter]) : undefined;

    const errors: PolicyLoadResult["errors"] = [];
    let loaded = 0;
    let skipped = 0;

    let files: string[] = [];
    try {
      files = await listFiles(this.deps.fs, dir, recursive);
    } catch (err) {
      return {
        loaded: 0,
        skipped: 0,
        errors: [{ path: dir, error: { message: err instanceof Error ? err.message : String(err ?? "Failed to read dir") } }]
      };
    }

    for (const path of files) {
      try {
        const raw = await this.deps.fs.readFile(path, "utf8");
        const parsed = matter(raw);
        const fm = (parsed.data ?? {}) as Record<string, unknown>;
        const id = String(fm.id ?? "");
        const title = String(fm.title ?? "");
        if (!id || !title) {
          skipped += 1;
          continue;
        }

        const status = (fm.status as PolicyStatus | undefined) ?? undefined;
        if (statuses && status && !statuses.includes(status)) {
          skipped += 1;
          continue;
        }

        const st = await this.deps.fs.stat(path);

        const rec: PolicyRecord = {
          id,
          title,
          status,
          version: fm.version ? String(fm.version) : undefined,
          tags: Array.isArray(fm.tags) ? (fm.tags as any[]).map(String) : undefined,
          appliesTo: Array.isArray(fm.appliesTo) ? (fm.appliesTo as any[]).map(String) : undefined,
          body: parsed.content,
          frontmatter: fm,
          source: { path, modifiedAtMs: st.mtimeMs }
        };

        this.registry.collection.upsert(rec);
        loaded += 1;
      } catch (err) {
        errors.push({
          path,
          error: { message: err instanceof Error ? err.message : String(err ?? "Failed to load policy") }
        });
      }
    }

    return { loaded, skipped, errors };
  }
}


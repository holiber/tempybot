import { describe, expect, it } from "vitest";
import { CollectionFactory } from "../../../../src/stc/light/index.js";

describe("stc/light Collection", () => {
  it("upserts with explicit key", () => {
    const c = new CollectionFactory().create<{ id: string; v: number }, string>({ name: "t" });
    expect(c.upsert({ id: "a", v: 1 }, "a")).toEqual({ key: "a", op: "create" });
    expect(c.upsert({ id: "a", v: 2 }, "a")).toEqual({ key: "a", op: "update" });
    expect(c.get("a")?.v).toBe(2);
  });

  it("infers key from keyField when provided", () => {
    const c = new CollectionFactory().create<{ id: string; v: number }, string>({ keyField: "id" });
    expect(c.upsert({ id: "k1", v: 1 })).toEqual({ key: "k1", op: "create" });
  });

  it("throws when key cannot be resolved", () => {
    const c = new CollectionFactory().create<{ v: number }, string>({});
    expect(() => c.upsert({ v: 1 } as any)).toThrow(/without key/i);
  });

  it("supports tree relationships", () => {
    const t = new CollectionFactory().createTree<{ id: string; parentId?: string; label: string }, string>({
      kind: "tree",
      keyField: "id",
      parentField: "parentId"
    });

    t.upsert({ id: "root", label: "r" });
    t.upsert({ id: "c1", parentId: "root", label: "c1" });
    t.upsert({ id: "c2", parentId: "root", label: "c2" });

    expect(t.childrenOf("root").map((x) => x.id).sort()).toEqual(["c1", "c2"]);
    expect(t.parentOf("c1")?.id).toBe("root");
  });
});


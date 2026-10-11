import { expect, it } from "vitest";
import { RefStore } from "./ref-store";
import { testStore } from "./test-helpers";

it("updates refs with atomic CAS and HEAD, sorts and filters refs", () => {
  const { storage } = testStore();
  const refs = new RefStore(storage);
  const a = "a".repeat(40),
    b = "b".repeat(40);
  expect(
    refs.updateRefs([{ name: "refs/heads/main", oldOid: null, newOid: a }], {
      head: "ref: refs/heads/main"
    })
  ).toEqual([{ name: "refs/heads/main", status: "ok" }]);
  expect(refs.getHead()).toBe("ref: refs/heads/main");
  expect(
    refs.updateRefs(
      [
        { name: "refs/heads/main", oldOid: b, newOid: b },
        { name: "refs/tags/v1", oldOid: null, newOid: a }
      ],
      { head: b }
    )
  ).toEqual([
    { name: "refs/heads/main", status: "stale info" },
    { name: "refs/tags/v1", status: "atomic update failed" }
  ]);
  expect(refs.getRef("refs/heads/main")).toBe(a);
  expect(refs.getRef("refs/tags/v1")).toBe(null);
  expect(refs.getHead()).toBe("ref: refs/heads/main");
  refs.updateRefs([
    { name: "refs/heads/main", oldOid: a, newOid: b },
    { name: "refs/heads/feature", oldOid: undefined, newOid: a }
  ]);
  expect(refs.listRefs("refs/heads/").map((ref) => ref.name)).toEqual([
    "refs/heads/feature",
    "refs/heads/main"
  ]);
  refs.updateRefs([{ name: "refs/heads/feature", oldOid: undefined, newOid: null }], { head: b });
  expect(refs.listRefs()).toEqual([{ name: "refs/heads/main", oid: b }]);
  expect(refs.getHead()).toBe(b);
});

it("rejects invalid names, duplicate updates and namespace conflicts", () => {
  const refs = new RefStore(testStore().storage);
  for (const name of [
    "main",
    "refs/remotes/main",
    "refs/heads/",
    "refs/tags/.bad",
    "refs/heads/a..b",
    "refs/heads/a.lock",
    "refs/heads/a//b",
    "refs/heads/a@{b",
    "refs/heads/a b",
    "refs/heads/a."
  ]) {
    expect(() => refs.updateRefs([{ name, oldOid: null, newOid: "a".repeat(40) }])).toThrow();
  }
  const update = { name: "refs/heads/a", oldOid: undefined, newOid: "a".repeat(40) };
  expect(() => refs.updateRefs([update, update])).toThrow();
  refs.updateRefs([update]);
  expect(refs.updateRefs([{ ...update, name: "refs/heads/a/b" }])[0]?.status).toBe(
    "refname conflict"
  );
  expect(
    refs
      .updateRefs([
        { ...update, newOid: null },
        { ...update, name: "refs/heads/a/b" }
      ])
      .map((item) => item.status)
  ).toEqual(["ok", "ok"]);
});

it("commits refs, HEAD and migration metadata in one transaction, or rolls everything back", () => {
  const { storage } = testStore();
  const refs = new RefStore(storage);
  const update = { name: "refs/heads/main", oldOid: null, newOid: "a".repeat(40) };
  const head = "ref: refs/heads/main";
  expect(() =>
    refs.updateRefs([update], {
      head,
      meta: { initialized: "1", oversized: "x".repeat(2 * 1024 * 1024 + 1) }
    })
  ).toThrow();
  expect(refs.listRefs()).toEqual([]);
  expect(refs.getHead()).toBe(null);
  expect(storage.sql.exec("SELECT * FROM meta WHERE key = 'initialized'").toArray()).toEqual([]);
  expect(refs.updateRefs([update], { head, meta: { initialized: "1" } })[0]?.status).toBe("ok");
  expect(refs.getHead()).toBe(head);
  expect(storage.sql.exec("SELECT value FROM meta WHERE key = 'initialized'").one().value).toBe(
    "1"
  );
});

it("detects every prefix conflict among thousands of tags and allows atomic replacement", () => {
  const refs = new RefStore(testStore().storage);
  const update = { oldOid: undefined, newOid: "a".repeat(40) };
  const tags = Array.from({ length: 3000 }, (_, i) => ({
    ...update, name: `refs/tags/release-${i}`
  }));
  expect(refs.updateRefs(tags).every((status) => status.status === "ok")).toBe(true);
  const conflicts = refs.updateRefs([
    { ...update, name: "refs/tags/release-1/a" },
    { ...update, name: "refs/tags/release-1/a/deep" },
    { ...update, name: "refs/tags/unrelated" }
  ]);
  expect(conflicts.map((status) => status.status))
    .toEqual(["refname conflict", "refname conflict", "atomic update failed"]);
  expect(refs.updateRefs([
    { ...update, name: "refs/tags/release-1", newOid: null },
    { ...update, name: "refs/tags/release-1/a" }
  ]).every((status) => status.status === "ok")).toBe(true);
});

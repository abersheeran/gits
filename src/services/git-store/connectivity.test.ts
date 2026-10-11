import { expect, it } from "vitest";
import { findMissingObject } from "./connectivity";
import { oidToBytes } from "./oid";
import { testStore } from "./test-helpers";

const text = new TextEncoder();

const missing = "a".repeat(40);

function commit(tree: string, parent?: string) {
  return text.encode(
    "tree " +
      tree +
      "\n" +
      (parent ? `parent ${parent}\n` : "") +
      "author A <a@a> 1234 +0000\ncommitter A <a@a> 1234 +0000\n\nmessage\n"
  );
}

it("reports absent tips, trees, parents and blobs and follows tags", () => {
  const { store } = testStore();
  expect(findMissingObject(store, 0, [missing])).toBe(missing);
  const missingTree = store.writeFullObject("commit", commit(missing));
  expect(findMissingObject(store, 0, [missingTree])).toBe(missing);
  const emptyTree = store.writeFullObject("tree", new Uint8Array());
  const missingParent = store.writeFullObject("commit", commit(emptyTree, missing));
  expect(findMissingObject(store, 0, [missingParent])).toBe(missing);
  const tree = store.writeFullObject(
    "tree",
    Buffer.concat([text.encode("100644 file\0"), oidToBytes(missing)])
  );
  const tip = store.writeFullObject("commit", commit(tree));
  const tag = store.writeFullObject(
    "tag",
    text.encode(`object ${tip}\ntype commit\ntag v1\n\nmessage\n`)
  );
  expect(findMissingObject(store, 0, [tag])).toBe(missing);
});

it("skips submodules and previously connected objects, batches wide trees", () => {
  const { store } = testStore();
  const tree = store.writeFullObject(
    "tree",
    Buffer.concat([text.encode("160000 module\0"), oidToBytes(missing)])
  );
  const tip = store.writeFullObject("commit", commit(tree));
  expect(findMissingObject(store, 0, [tip])).toBe(null);
  const old = store.writeFullObject("commit", commit(missing));
  const start = store.maxRowid();
  const next = store.writeFullObject("commit", commit(tree, old));
  expect(findMissingObject(store, start, [next])).toBe(null);
  const entries = Array.from({ length: 200 }, (_, i) => {
    const blob = store.writeFullObject("blob", text.encode(String(i)));
    return Buffer.concat([text.encode(`100644 file-${i}\0`), oidToBytes(blob)]);
  });
  const wide = store.writeFullObject("tree", Buffer.concat(entries));
  expect(findMissingObject(store, start, [wide])).toBe(null);
});

import { deflate } from "pako";
import { expect, it } from "vitest";
import { MAX_RESOLVE_BYTES } from "./git-store/object-format";
import { oidToBytes } from "./git-store/oid";
import { RefStore } from "./git-store/ref-store";
import { testStore } from "./git-store/test-helpers";
import { RepositoryBrowserService } from "./repository-browser-service";

it("previews large objects and handles unresolvable deltas without page errors", async () => {
  const { store, storage } = testStore();
  const refs = new RefStore(storage);
  const encoder = new TextEncoder();
  const large = store.writeFullObject("blob", new Uint8Array(MAX_RESOLVE_BYTES + 1).fill(65));
  const delta = "d".repeat(40);
  const data = deflate(new Uint8Array([0]));
  store.insert(
    {
      oid: delta,
      type: 3,
      size: MAX_RESOLVE_BYTES + 1,
      baseOid: large,
      depth: 1,
      payload_size: 1
    },
    { data, chunkId: null, storedSize: data.length }
  );
  const tree = store.writeFullObject(
    "tree",
    Buffer.concat([
      encoder.encode("100644 README.md\0"),
      oidToBytes(large),
      encoder.encode("100644 delta.bin\0"),
      oidToBytes(delta)
    ])
  );
  const commit = store.writeFullObject(
    "commit",
    encoder.encode(`tree ${tree}\nauthor A <a@a> 1 +0000\ncommitter A <a@a> 1 +0000\n\nlarge\n`)
  );
  refs.updateRefs([{ name: "refs/heads/main", oldOid: null, newOid: commit }], {
    head: "ref: refs/heads/main"
  });
  const browser = new RepositoryBrowserService(store, refs);
  const input = { owner: "a", repo: "b" };
  expect((await browser.getRepositoryDetail(input)).readme?.content.length).toBe(200 * 1024);
  const full = await browser.browseRepositoryContents({ ...input, path: "README.md" });
  expect(full.file).toMatchObject({
    size: MAX_RESOLVE_BYTES + 1,
    truncated: true,
    isBinary: false
  });
  expect(full.file?.content?.length).toBe(512 * 1024);
  const unresolved = await browser.browseRepositoryContents({ ...input, path: "delta.bin" });
  expect(unresolved.file).toMatchObject({
    size: MAX_RESOLVE_BYTES + 1,
    truncated: true,
    content: null
  });
  const detail = await browser.getCommitDetail({ ...input, oid: commit });
  expect(detail.changes.find((change) => change.path === "README.md")?.newContent?.length).toBe(
    256 * 1024
  );
  expect(detail.changes.find((change) => change.path === "delta.bin")).toMatchObject({
    isBinary: true,
    patch: null,
    newContent: null
  });
});

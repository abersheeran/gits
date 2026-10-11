import { expect, it, vi } from "vitest";
import { workerdFetch } from "../test-utils/workerd-fetch";
import { fetchMirror } from "./git-fetch-client";
import { buildInfoRefsResponse } from "./git-info-refs";
import { concatBytes } from "./git-pkt-line";
import { oidToBytes } from "./git-store/oid";
import { RefStore } from "./git-store/ref-store";
import { testStore } from "./git-store/test-helpers";
import { uploadPack } from "./git-upload-pack";

function remoteRepository() {
  const { store, storage } = testStore();
  const refs = new RefStore(storage);
  const text = new TextEncoder();
  let tip: string | null = null;
  let count = 0;
  function commit() {
    const blob = store.writeFullObject("blob", text.encode(`file version ${++count}`));
    const tree = store.writeFullObject("tree", concatBytes([
      text.encode("100644 file\0"), oidToBytes(blob)
    ]));
    const parent = tip ? `parent ${tip}\n` : "";
    tip = store.writeFullObject("commit", text.encode(
      `tree ${tree}\n${parent}author A <a@a.com> 1 +0000\n`
        + `committer A <a@a.com> 1 +0000\n\nv${count}\n`
    ));
    refs.updateRefs([{ name: "refs/heads/main", oldOid: undefined, newOid: tip }], {
      head: "ref: refs/heads/main"
    });
    return tip;
  }
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    if (request.method === "POST") {
      return uploadPack(store, refs, await request.arrayBuffer());
    }
    return buildInfoRefsResponse({
      service: "git-upload-pack", refs: refs.listRefs(), storedHead: refs.getHead()
    });
  });
  return { commit, refs, fetcher };
}

it.each([10, 100])("checks only new objects after %s historical commits", async (history) => {
  const remote = remoteRepository();
  const first = remote.commit();
  for (let index = 1; index < history; index++) {
    remote.commit();
  }
  const { store, storage } = testStore();
  const refs = new RefStore(storage);
  const readCommit = vi.spyOn(store, "readCommit");
  const readTree = vi.spyOn(store, "readTree");
  const sync = () => fetchMirror({
    store, refs, login: "user", token: "secret", fullName: "user/repo",
    http: { fetch: workerdFetch(remote.fetcher) }
  });
  expect((await sync()).objectCount).toBe(history * 3);
  readCommit.mockClear();
  readTree.mockClear();

  const latest = remote.commit();
  expect((await sync()).objectCount).toBe(3);
  expect(readCommit).toHaveBeenCalledExactlyOnceWith(latest);
  expect(readTree).toHaveBeenCalledOnce();
  expect(refs.getRef("refs/heads/main")).toBe(latest);

  readCommit.mockClear();
  readTree.mockClear();
  remote.refs.updateRefs([{ name: "refs/heads/main", oldOid: undefined, newOid: first }]);
  expect((await sync()).objectCount).toBe(0);
  expect(readCommit).not.toHaveBeenCalled();
  expect(readTree).not.toHaveBeenCalled();
  expect(refs.getRef("refs/heads/main")).toBe(first);
});

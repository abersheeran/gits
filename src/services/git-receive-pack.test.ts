import { expect, it } from "vitest";
import { limitGitBody } from "./git-body-limit";
import { concatBytes, encodeFlushPktLine, encodeTextPktLine } from "./git-protocol";
import { receivePack } from "./git-receive-pack";
import { parseReceivePackStream } from "./git-receive-request";
import { objectHash } from "./git-store/object-format";
import { RefStore } from "./git-store/ref-store";
import { makePack, testStore } from "./git-store/test-helpers";

const zero = "0".repeat(40);
const encoder = new TextEncoder();
function body(commands: string[], pack = makePack([])) {
  const bytes = concatBytes([
    ...commands.map((line, i) => encodeTextPktLine(line + (i ? "\n" : "\0report-status\n"))),
    encodeFlushPktLine(),
    pack
  ]);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset === bytes.length) {
        controller.close();
      } else {
        controller.enqueue(bytes.subarray(offset, offset + 7));
        offset = Math.min(bytes.length, offset + 7);
      }
    }
  });
}
function commit(tree: string) {
  return encoder.encode(`tree ${tree}\nauthor A <a@a> 1 +0000\ncommitter A <a@a> 1 +0000\n\nx\n`);
}

it("parses commands across chunk boundaries and preserves every remaining pack byte", async () => {
  const pack = makePack([{ type: 3, content: encoder.encode("contents") }]);
  const stream = body([`${zero} ${"a".repeat(40)} refs/heads/main`], pack);
  const request = await parseReceivePackStream(stream);
  expect(request.commands).toEqual([
    { oldOid: zero, newOid: "a".repeat(40), refName: "refs/heads/main" }
  ]);
  expect(request.capabilities).toEqual(new Set(["report-status"]));
  const received: Uint8Array[] = [];
  for await (const chunk of request.pack) {
    received.push(chunk);
  }
  expect(concatBytes(received)).toEqual(new Uint8Array(pack));
});

it("reports missing closure objects and keeps all references unchanged", async () => {
  const { store, storage } = testStore();
  const refs = new RefStore(storage);
  const content = commit("a".repeat(40));
  const oid = objectHash("commit", content);
  const response = await receivePack({
    store,
    refs,
    body: body([`${zero} ${oid} refs/heads/main`], makePack([{ type: 1, content }]))
  });
  expect(await response.text()).toContain("ng refs/heads/main missing necessary objects");
  expect(refs.listRefs()).toEqual([]);
});

it("uses atomic CAS and repairs HEAD in the same successful batch", async () => {
  const { store, storage } = testStore();
  const refs = new RefStore(storage);
  const tree = store.writeFullObject("tree", new Uint8Array());
  const oid = store.writeFullObject("commit", commit(tree));
  refs.updateRefs([{ name: "refs/heads/old", oldOid: null, newOid: oid }], {
    head: "ref: refs/heads/old"
  });
  const stale = await receivePack({
    store,
    refs,
    body: body([`${zero} ${zero} refs/heads/old`, `${zero} ${oid} refs/heads/main`])
  });
  const report = await stale.text();
  expect(report).toContain("ng refs/heads/old stale info");
  expect(report).toContain("ng refs/heads/main atomic update failed");
  expect(refs.getRef("refs/heads/main")).toBe(null);
  const success = await receivePack({
    store,
    refs,
    body: body([`${oid} ${zero} refs/heads/old`, `${zero} ${oid} refs/heads/main`])
  });
  expect(await success.text()).toContain("ok refs/heads/main");
  expect(refs.getHead()).toBe("ref: refs/heads/main");
  expect(refs.getRef("refs/heads/old")).toBe(null);
});

it("reports unpack failure for every command and recognizes streaming body limits", async () => {
  const { store, storage } = testStore();
  const refs = new RefStore(storage);
  const commands = [`${zero} ${"a".repeat(40)} refs/heads/main`];
  const invalid = await receivePack({ store, refs, body: body(commands, Buffer.from("bad")) });
  const text = await invalid.text();
  expect(text).toContain("unpack Truncated pack");
  expect(text).toContain("ng refs/heads/main");
  const request = new Request("http://localhost", {
    method: "POST",
    body: body(commands),
    duplex: "half"
  });
  const limited = limitGitBody(request, 12);
  const rejected = await receivePack({ store, refs, body: limited.stream });
  expect(rejected.status).toBe(413);
  expect(await rejected.text()).toContain("unpack Pack exceeds maxBytes");
  expect(refs.listRefs()).toEqual([]);
});

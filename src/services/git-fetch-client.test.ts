import { workerdFetch } from "../test-utils/workerd-fetch";
import { expect, it, vi } from "vitest";
import { fetchMirror } from "./git-fetch-client";
import { readAdvertisement, unpackSideband } from "./git-fetch-protocol";
import { concatBytes, encodeFlushPktLine, encodePktLine, encodeTextPktLine } from "./git-pkt-line";
import { RefStore } from "./git-store/ref-store";
import { makePack, testStore } from "./git-store/test-helpers";
import { objectHash } from "./git-store/object-format";

function advertisement(lines: string[]) {
  return new Response(Uint8Array.from(concatBytes([
    encodeTextPktLine("# service=git-upload-pack\n"), encodeFlushPktLine(),
    ...lines.map((line) => encodeTextPktLine(line + "\n")), encodeFlushPktLine()
  ])));
}

it("filters advertised refs and parses empty capabilities", async () => {
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const oid = "a".repeat(40);
  const parsed = await readAdvertisement(advertisement([
    `${oid} HEAD\0symref=HEAD:refs/heads/main side-band-64k`,
    `${oid} refs/heads/main`, `${oid} refs/tags/v1`, `${oid} refs/tags/v1^{}`,
    `${oid} refs/pull/1/head`, `${oid} refs/heads/invalid..name`
  ]).body!);
  expect([...parsed.refs.keys()]).toEqual(["refs/heads/main", "refs/tags/v1"]);
  expect(parsed.head).toBe("ref: refs/heads/main");
  expect(warning).toHaveBeenCalledOnce();
  const empty = await readAdvertisement(advertisement([
    `${"0".repeat(40)} capabilities^{}\0side-band-64k`
  ]).body!);
  expect(empty.refs.size).toBe(0);
  warning.mockRestore();
});

it.each([401, 403, 404])("classifies git HTTP %s safely", async (status) => {
  const { store, storage } = testStore();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("denied secret-token", {
    status
  }));
  await expect(fetchMirror({
    store, refs: new RefStore(storage), login: "user", token: "secret-token", fullName: "user/repo",
    http: { fetch: workerdFetch(fetcher) }
  })).rejects.toMatchObject({ kind: status === 401 ? "unauthorized"
    : status === 404 ? "not_found" : "other" });
});

it("demultiplexes fragmented packets and rejects sideband errors", async () => {
  const bytes = concatBytes([
    encodeTextPktLine("NAK\n"), encodePktLine(new Uint8Array([2, 65])),
    encodePktLine(new Uint8Array([1, 80, 65, 67, 75])), encodeFlushPktLine()
  ]);
  let offset = 0;
  const chunks = [];
  for await (const chunk of unpackSideband(new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) {
        controller.close();
      } else {
        controller.enqueue(bytes.slice(offset, ++offset));
      }
    }
  }))) {
    chunks.push(chunk);
  }
  expect(new TextDecoder().decode(concatBytes(chunks))).toBe("PACK");
  const error = new Response(encodePktLine(new Uint8Array([3, 69, 82, 82])));
  const iterator = unpackSideband(error.body!);
  await expect(iterator.next()).rejects.toThrow("GitHub git error");
});

it("checks newly ingested connectivity and preserves refs on failure", async () => {
  const { store, storage } = testStore();
  const refs = new RefStore(storage);
  const content = new TextEncoder().encode(
    `tree ${"a".repeat(40)}\nauthor A <a@a.com> 1 +0000\ncommitter A <a@a.com> 1 +0000\n\nx\n`
  );
  const commit = objectHash("commit", content);
  const pack = makePack([{ type: 1, content }]);
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(advertisement([
      `${commit} refs/heads/main\0symref=HEAD:refs/heads/main`
    ]))
    .mockResolvedValueOnce(new Response(Uint8Array.from(concatBytes([
      encodeTextPktLine("NAK\n"),
      encodePktLine(concatBytes([new Uint8Array([1]), pack])), encodeFlushPktLine()
    ]))));
  await expect(fetchMirror({
    store, refs, login: "user", token: "secret", fullName: "user/repo",
    http: { fetch: workerdFetch(fetcher) }
  })).rejects.toThrow("missing necessary objects");
  expect(refs.listRefs()).toEqual([]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

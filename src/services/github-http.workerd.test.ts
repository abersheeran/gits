import { afterEach, expect, it, vi } from "vitest";
import { workerdFetch } from "../test-utils/workerd-fetch";
import { fetchMirror } from "./git-fetch-client";
import { concatBytes, encodeFlushPktLine, encodeTextPktLine } from "./git-pkt-line";
import { RefStore } from "./git-store/ref-store";
import { testStore } from "./git-store/test-helpers";
import { GithubClient } from "./github/github-client";

afterEach(() => vi.unstubAllGlobals());

function advertisement(oid?: string) {
  return new Response(Uint8Array.from(concatBytes([
    encodeTextPktLine("# service=git-upload-pack\n"), encodeFlushPktLine(),
    ...(oid ? [encodeTextPktLine(`${oid} refs/heads/main\0side-band-64k\n`)] : []),
    encodeFlushPktLine()
  ])));
}

function mirrorInput() {
  const { store, storage } = testStore();
  return {
    store, refs: new RefStore(storage), fullName: "user/repo", login: "user", token: "secret"
  };
}

it.each(["default", "injected"])("uses workerd-compatible REST fetch: %s", async (mode) => {
  const implementation = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 1 }));
  const wrapped = workerdFetch(implementation);
  vi.stubGlobal("fetch", wrapped);
  const client = new GithubClient("secret", mode === "injected" ? { fetch: wrapped } : {});
  await expect(client.user()).resolves.toEqual({ user: { id: 1 }, scopes: [] });
  expect(implementation).toHaveBeenCalledExactlyOnceWith("https://api.github.com/user",
    expect.objectContaining({ redirect: "manual" }));
});

it.each(["default", "injected"])("uses workerd-compatible git fetch: %s", async (mode) => {
  const implementation = vi.fn<typeof fetch>().mockResolvedValue(advertisement());
  const wrapped = workerdFetch(implementation);
  vi.stubGlobal("fetch", wrapped);
  await expect(fetchMirror({
    ...mirrorInput(), ...(mode === "injected" ? { http: { fetch: wrapped } } : {})
  })).resolves.toEqual({ objectCount: 0 });
  expect(implementation).toHaveBeenCalledExactlyOnceWith(
    "https://github.com/user/repo.git/info/refs?service=git-upload-pack",
    expect.objectContaining({ redirect: "manual" })
  );
});

it.each([301, 302, 307, 308])("rejects REST redirect %s without following it", async (status) => {
  const implementation = vi.fn<typeof fetch>().mockResolvedValue(new Response("", {
    status, headers: { Location: "https://other.test/moved" }
  }));
  const client = new GithubClient("secret", { fetch: workerdFetch(implementation) });
  await expect(client.user()).rejects.toMatchObject({
    kind: "other", message: "GitHub 返回了重定向"
  });
  expect(implementation).toHaveBeenCalledOnce();
});

it.each(["advertisement", "pack"])("rejects git %s redirects without following", async (step) => {
  const implementation = vi.fn<typeof fetch>();
  if (step === "pack") {
    implementation.mockResolvedValueOnce(advertisement("a".repeat(40)));
  }
  implementation.mockResolvedValueOnce(new Response("", {
    status: 301, headers: { Location: "https://other.test/moved.git" }
  }));
  const args = mirrorInput();
  await expect(fetchMirror({ ...args, http: { fetch: workerdFetch(implementation) } }))
    .rejects.toMatchObject({
      kind: "other", message: "GitHub 仓库已移动，等待下次发现更新地址"
    });
  expect(implementation).toHaveBeenCalledTimes(step === "pack" ? 2 : 1);
  expect(args.refs.listRefs()).toEqual([]);
});

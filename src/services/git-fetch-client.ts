import {
  concatBytes, encodeFlushPktLine, encodeTextPktLine
} from "./git-pkt-line";
import { readAdvertisement, unpackSideband } from "./git-fetch-protocol";
import { findMissingObject } from "./git-store/connectivity";
import type { ObjectStore } from "./git-store/object-store";
import { ingestPack } from "./git-store/pack-ingest";
import type { RefStore, RefUpdate } from "./git-store/ref-store";
import { GithubError, safeError } from "./github/github-client";
import { MAX_MIRROR_BYTES, type GithubHttpOptions } from "./github/types";

async function checkResponse(response: Response, token: string): Promise<Response> {
  if (response.ok) {
    return response;
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new GithubError("other", "GitHub 仓库已移动，等待下次发现更新地址");
  }
  if (response.status === 401) {
    await response.body?.cancel();
    throw new GithubError("unauthorized", "GitHub token is invalid or expired");
  }
  if (response.status === 404) {
    await response.body?.cancel();
    throw new GithubError("not_found", "GitHub repository is not accessible");
  }
  let detail = "";
  if (response.status === 403) {
    if (response.headers.has("X-GitHub-SSO")) {
      detail = "Authorize this token for organization SAML SSO";
    } else {
      const reader = response.body?.getReader();
      try {
        const bytes = await reader?.read();
        detail = new TextDecoder().decode(bytes?.value?.subarray(0, 2048));
      } finally {
        await reader?.cancel();
        reader?.releaseLock();
      }
    }
  }
  await response.body?.cancel();
  throw new GithubError("other", safeError(
    new Error(`GitHub git request failed (${response.status})${detail ? ": " + detail : ""}`),
    token
  ));
}

export async function fetchMirror(args: {
  store: ObjectStore;
  refs: RefStore;
  fullName: string;
  login: string;
  token: string;
  http?: GithubHttpOptions;
  beforeUpdate?: () => Promise<void>;
}) {
  const fetcher = args.http?.fetch ?? fetch.bind(globalThis);
  const base = args.http?.gitBaseUrl ?? args.http?.webBaseUrl ?? "https://github.com";
  const path = args.fullName.split("/").map(encodeURIComponent).join("/");
  const url = `${base.replace(/\/$/, "")}/${path}.git`;
  const authorization = `Basic ${btoa(`${args.login}:${args.token}`)}`;
  const headers = { Authorization: authorization, "User-Agent": "git/gits" };
  let startRowid = args.store.maxRowid();
  try {
    const advertisement = await checkResponse(await fetcher(
      `${url}/info/refs?service=git-upload-pack`, { headers, redirect: "manual" }
    ), args.token);
    if (!advertisement.body) {
      throw new Error("Empty Git advertisement");
    }
    const remote = await readAdvertisement(advertisement.body);
    const local = args.refs.listRefs().filter((ref) => /^refs\/(heads|tags)\//.test(ref.name));
    const oids = [...new Set(remote.refs.values())];
    const present = args.store.hasMany(oids);
    const wants = oids.filter((oid) => !present.get(oid));
    let objectCount = 0;
    if (wants.length) {
      const capabilities = "ofs-delta side-band-64k no-progress agent=gits";
      const request = wants.map((oid, index) => encodeTextPktLine(
        `want ${oid}${index === 0 ? " " + capabilities : ""}\n`
      ));
      request.push(encodeFlushPktLine());
      const haves = new Set<string>();
      for (const ref of local) {
        if (args.store.readHeader(ref.oid)?.type === "commit") {
          haves.add(ref.oid);
        }
        if (haves.size === 256) {
          break;
        }
      }
      for (const oid of haves) {
        request.push(encodeTextPktLine(`have ${oid}\n`));
      }
      request.push(encodeTextPktLine("done\n"));
      const response = await checkResponse(await fetcher(`${url}/git-upload-pack`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-git-upload-pack-request" },
        body: Uint8Array.from(concatBytes(request)),
        redirect: "manual"
      }), args.token);
      if (!response.body) {
        throw new Error("Empty Git pack response");
      }
      const result = await ingestPack(args.store, unpackSideband(response.body), {
        maxBytes: MAX_MIRROR_BYTES
      });
      objectCount = result.objectCount;
      startRowid = result.startRowid;
    }
    const current = new Map(local.map((ref) => [ref.name, ref.oid]));
    const updates: RefUpdate[] = [];
    for (const [name, oid] of remote.refs) {
      if (current.get(name) !== oid) {
        if (name.startsWith("refs/heads/") && args.store.readHeader(oid)?.type !== "commit") {
          throw new Error("Remote branch does not point to a commit");
        }
        updates.push({ name, oldOid: undefined, newOid: oid });
      }
    }
    const missing = findMissingObject(args.store, startRowid,
      updates.map((update) => update.newOid!));
    if (missing) {
      throw new Error("Remote pack is missing necessary objects");
    }
    for (const { name } of local) {
      if (!remote.refs.has(name)) {
        updates.push({ name, oldOid: undefined, newOid: null });
      }
    }
    let head = remote.head ?? args.refs.getHead();
    if (!remote.head && (!head?.startsWith("ref: ") || !remote.refs.has(head.slice(5)))) {
      const branches = [...remote.refs.keys()].filter((name) => name.startsWith("refs/heads/"));
      head = `ref: ${branches.includes("refs/heads/main")
        ? "refs/heads/main" : branches.sort()[0] ?? "refs/heads/main"}`;
    }
    await args.beforeUpdate?.();
    const statuses = args.refs.updateRefs(updates, { head: head! });
    if (statuses.some((status) => status.status !== "ok")) {
      throw new Error("Remote references conflict");
    }
    return { objectCount };
  } catch (error) {
    const sanitized = safeError(new Error(safeError(error, args.token)), authorization.slice(6));
    if (error instanceof GithubError) {
      throw new GithubError(error.kind, sanitized, error.resetAt);
    }
    throw new Error(sanitized);
  }
}

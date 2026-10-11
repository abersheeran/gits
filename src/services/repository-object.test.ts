import { describe, expect, it, vi } from "vitest";
import { seedSampleRepositoryToR2 } from "../test-utils/git-fixture";
import { createMockDurableObjectState } from "../test-utils/mock-durable-object-state";
import { MockR2Bucket } from "../test-utils/mock-r2";
import type { AppBindings } from "../types";
import { concatBytes, encodeFlushPktLine, encodeTextPktLine } from "./git-protocol";
import { makePack } from "./git-store/test-helpers";
import { RepositoryObject } from "./repository-object";

function createEnv(bucket: MockR2Bucket): AppBindings {
  return { GIT_BUCKET: bucket as unknown as R2Bucket } as AppBindings;
}

function request(operation: string, payload: Record<string, unknown> = {}): Request {
  return new Request("https://repository-object/json", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, payload: { owner: "alice", repo: "demo", ...payload } })
  });
}

describe("RepositoryObject SQLite storage", () => {
  it("migrates R2 and KV snapshots, then survives instance recreation", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    await bucket.put("alice/other/HEAD", "ref: refs/heads/main");
    const state = createMockDurableObjectState();
    for (let i = 0; i < 257; i++) {
      await state.storage.put(`repository-snapshot/files/${i}`, "old");
    }
    await state.storage.put("unrelated", "keep");
    const env = createEnv(bucket);
    const object = new RepositoryObject(state, env);
    const first = await object.fetch(request("browse-repository-contents"));
    expect(first.ok).toBe(true);
    expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM objects").one().n).toBeGreaterThan(0);
    expect((await bucket.list({ prefix: "alice/demo/" })).objects).toEqual([]);
    expect((await bucket.list({ prefix: "alice/other/" })).objects).toHaveLength(1);
    expect((await state.storage.list({ prefix: "repository-snapshot/" })).size).toBe(0);
    expect(await state.storage.get("unrelated")).toBe("keep");
    const recycled = new RepositoryObject(state, env);
    const response = await recycled.fetch(request("browse-repository-contents"));
    expect(response.ok).toBe(true);
    const result = (await response.json()) as {
      readme: { path: string; content: string } | null;
      entries: Array<{ path: string }>;
    };
    expect(result.readme?.path).toBe("README.md");
    expect(result.readme?.content).toContain("Updated");
    expect(result.entries.some((entry) => entry.path === "README.md")).toBe(true);
  });

  it("deletes SQL, KV and leftover R2 and discards the object cache", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const state = createMockDurableObjectState();
    const object = new RepositoryObject(state, createEnv(bucket));
    await object.fetch(request("browse-repository-contents"));
    await state.storage.put("repository-snapshot/leftover", "old");
    await bucket.put("alice/demo/leftover", "old");
    expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM objects").one().n).toBeGreaterThan(0);
    expect((await object.fetch(request("delete-repository"))).ok).toBe(true);
    expect(state.storage.sql.exec("SELECT COUNT(*) AS n FROM objects").one().n).toBe(0);
    expect(state.storage.sql.exec("SELECT * FROM refs").toArray()).toEqual([]);
    expect((await state.storage.list()).size).toBe(0);
    expect((await bucket.list({ prefix: "alice/demo/" })).objects).toEqual([]);
    const empty = await object.fetch(request("browse-repository-contents"));
    expect(await empty.json()).toMatchObject({ entries: [], readme: null, headOid: null });
  });

  it("initializes only SQLite without attempting legacy import", async () => {
    const bucket = new MockR2Bucket();
    await bucket.put("alice/demo/objects/pack/broken.pack", "broken");
    const state = createMockDurableObjectState();
    const object = new RepositoryObject(state, createEnv(bucket));
    expect(
      (await object.fetch(request("initialize-repository", { defaultBranch: "trunk" }))).status
    ).toBe(201);
    expect(state.storage.sql.exec("SELECT value FROM meta WHERE key = 'head'").one().value).toBe(
      "ref: refs/heads/trunk"
    );
    expect((await bucket.list({ prefix: "alice/demo/" })).objects).toHaveLength(1);
  });

  it("keeps legacy data on migration failure and retries after correction", async () => {
    const bucket = new MockR2Bucket();
    await bucket.put("alice/demo/objects/pack/broken.pack", "broken");
    const state = createMockDurableObjectState();
    await state.storage.put("repository-snapshot/old", "old");
    const object = new RepositoryObject(state, createEnv(bucket));
    expect((await object.fetch(request("browse-repository-contents"))).status).toBe(500);
    expect((await bucket.list({ prefix: "alice/demo/" })).objects).toHaveLength(1);
    expect(await state.storage.get("repository-snapshot/old")).toBe("old");
    await bucket.delete("alice/demo/objects/pack/broken.pack");
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const responses = await Promise.all([
      object.fetch(request("browse-repository-contents")),
      object.fetch(request("list-head-refs"))
    ]);
    expect(responses.every((response) => response.ok)).toBe(true);
    expect((await bucket.list({ prefix: "alice/demo/" })).objects).toEqual([]);
  });
});

it("serializes competing branch writes and migrates by the old name before rename", async () => {
  const bucket = new MockR2Bucket();
  const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
  const state = createMockDurableObjectState();
  const object = new RepositoryObject(state, createEnv(bucket));
  const renamed = await object.fetch(request("rename-repository", { nextRepo: "renamed" }));
  expect(renamed.ok).toBe(true);
  expect((await bucket.list({ prefix: "alice/demo/" })).objects).toEqual([]);
  expect((await bucket.list({ prefix: "alice/renamed/" })).objects).toEqual([]);
  const operations = await Promise.all([
    object.fetch(
      request("create-branch", {
        repo: "renamed",
        branchName: "competing",
        sourceOid: seeded.latestCommit
      })
    ),
    object.fetch(
      request("create-branch", {
        repo: "renamed",
        branchName: "competing",
        sourceOid: seeded.initialCommit
      })
    )
  ]);
  expect(operations.map((response) => response.status).sort()).toEqual([201, 409]);
  const branches = await object.fetch(request("list-head-refs", { repo: "renamed" }));
  const result = (await branches.json()) as { branches: Array<{ name: string; oid: string }> };
  expect(result.branches.find((ref) => ref.name === "refs/heads/competing")?.oid).toBe(
    seeded.latestCommit
  );
});

it("keeps branch writes behind a streaming push while allowing reads", async () => {
  const bucket = new MockR2Bucket();
  const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
  const state = createMockDurableObjectState();
  const object = new RepositoryObject(state, createEnv(bucket));
  await object.fetch(request("list-head-refs"));
  const payload = concatBytes([
    encodeTextPktLine(
      `${"0".repeat(40)} ${seeded.latestCommit} refs/heads/pushed\0report-status\n`
    ),
    encodeFlushPktLine(),
    makePack([])
  ]);
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(payload.subarray(0, -1));
    },
    async pull(controller) {
      entered();
      await gate;
      controller.enqueue(payload.subarray(-1));
      controller.close();
    }
  });
  const push = object.fetch(
    new Request("https://repository-object/git/receive-pack?owner=alice&repo=demo", {
      method: "POST",
      body: stream,
      duplex: "half"
    })
  );
  await started;
  const branch = object.fetch(
    request("create-branch", {
      branchName: "queued",
      sourceOid: seeded.latestCommit
    })
  );
  try {
    const response = await object.fetch(request("list-head-refs"));
    const before = (await response.json()) as { branches: Array<{ name: string }> };
    expect(before.branches.some((item) => item.name === "refs/heads/queued")).toBe(false);
  } finally {
    release();
  }
  expect((await push).ok).toBe(true);
  expect((await branch).status).toBe(201);
});

it("resumes interrupted cleanup after recreation without reimporting partial data", async () => {
  const bucket = new MockR2Bucket();
  await seedSampleRepositoryToR2(bucket, "alice", "demo");
  await bucket.put("alice/demo/HEAD", "ref: refs/heads/feature\n");
  for (let index = 0; index < 1050; index++) {
    await bucket.put(`alice/demo/legacy-extra/${index}`, "old");
  }
  const remove = bucket.delete.bind(bucket);
  let deletes = 0;
  const failure = vi.spyOn(bucket, "delete").mockImplementation(async (key) => {
    deletes++;
    if (deletes === 2) {
      throw new Error("Temporary R2 cleanup failure");
    }
    await remove(key);
  });
  const state = createMockDurableObjectState();
  await state.storage.put("repository-snapshot/old", "old");
  const first = new RepositoryObject(state, createEnv(bucket));
  expect((await first.fetch(request("get-repository-detail"))).status).toBe(500);
  failure.mockRestore();
  expect(await bucket.get("alice/demo/HEAD")).toBe(null);
  const recycled = new RepositoryObject(state, createEnv(bucket));
  const response = await recycled.fetch(request("get-repository-detail"));
  expect(response.ok).toBe(true);
  expect(await response.json()).toMatchObject({ defaultBranch: "feature" });
  expect((await bucket.list({ prefix: "alice/demo/" })).objects).toEqual([]);
  expect((await state.storage.list({ prefix: "repository-snapshot/" })).size).toBe(0);
});

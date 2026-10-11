import { afterEach, expect, it, vi } from "vitest";
import app from "../app";
import { seedSampleRepositoryToR2 } from "../test-utils/git-fixture";
import {
  concat,
  containsPackSignature,
  createEnv,
  createPublicRepositoryDb,
  parsePktTextPrefix,
  pktLine
} from "../test-utils/git-integration-fixture";
import { cleanupTestGitFs } from "../test-utils/git-test-fs";
import { MockR2Bucket } from "../test-utils/mock-r2";

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTestGitFs();
});

it("returns shallow lines when deepen is requested", async () => {
  const bucket = new MockR2Bucket();
  const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");

  const response = await app.fetch(
    new Request("http://localhost/alice/demo/git-upload-pack", {
      method: "POST",
      headers: {
        "content-type": "application/x-git-upload-pack-request"
      },
      body: concat(
        pktLine(`want ${seeded.latestCommit}\n`),
        pktLine("deepen 1\n"),
        pktLine("done\n"),
        new TextEncoder().encode("0000")
      )
    }),
    createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
  );

  expect(response.status).toBe(200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(parsePktTextPrefix(bytes)).toContain(`shallow ${seeded.latestCommit}\n`);
  expect(containsPackSignature(bytes)).toBe(true);
});

it("supports deepen-since requests", async () => {
  const bucket = new MockR2Bucket();
  const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");

  const response = await app.fetch(
    new Request("http://localhost/alice/demo/git-upload-pack", {
      method: "POST",
      headers: {
        "content-type": "application/x-git-upload-pack-request"
      },
      body: concat(
        pktLine(`want ${seeded.latestCommit}\n`),
        pktLine("deepen-since 0\n"),
        pktLine("done\n"),
        new TextEncoder().encode("0000")
      )
    }),
    createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
  );

  expect(response.status).toBe(200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(new TextDecoder().decode(bytes).includes("ERR")).toBe(false);
  expect(containsPackSignature(bytes)).toBe(true);
});

it("supports deepen-not requests", async () => {
  const bucket = new MockR2Bucket();
  const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");

  const response = await app.fetch(
    new Request("http://localhost/alice/demo/git-upload-pack", {
      method: "POST",
      headers: {
        "content-type": "application/x-git-upload-pack-request"
      },
      body: concat(
        pktLine(`want ${seeded.latestCommit}\n`),
        pktLine("deepen-not refs/heads/feature\n"),
        pktLine("done\n"),
        new TextEncoder().encode("0000")
      )
    }),
    createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
  );

  expect(response.status).toBe(200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(new TextDecoder().decode(bytes).includes("ERR")).toBe(false);
  expect(containsPackSignature(bytes)).toBe(true);
});

it("supports blob:none filter requests", async () => {
  const bucket = new MockR2Bucket();
  const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");

  const response = await app.fetch(
    new Request("http://localhost/alice/demo/git-upload-pack", {
      method: "POST",
      headers: {
        "content-type": "application/x-git-upload-pack-request"
      },
      body: concat(
        pktLine(`want ${seeded.latestCommit}\n`),
        pktLine("filter blob:none\n"),
        pktLine("done\n"),
        new TextEncoder().encode("0000")
      )
    }),
    createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/x-git-upload-pack-result");
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(new TextDecoder().decode(bytes).includes("ERR")).toBe(false);
  expect(containsPackSignature(bytes)).toBe(true);
});

it("returns protocol ERR for unknown filter spec", async () => {
  const bucket = new MockR2Bucket();
  const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");

  const response = await app.fetch(
    new Request("http://localhost/alice/demo/git-upload-pack", {
      method: "POST",
      headers: {
        "content-type": "application/x-git-upload-pack-request"
      },
      body: concat(
        pktLine(`want ${seeded.latestCommit}\n`),
        pktLine("filter tree:0\n"),
        pktLine("done\n"),
        new TextEncoder().encode("0000")
      )
    }),
    createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
  );

  expect(response.status).toBe(200);
  expect(new TextDecoder().decode(await response.arrayBuffer())).toContain(
    "ERR filter unsupported"
  );
});

it("returns protocol ERR when deepen exceeds server limit", async () => {
  const bucket = new MockR2Bucket();
  const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");

  const response = await app.fetch(
    new Request("http://localhost/alice/demo/git-upload-pack", {
      method: "POST",
      headers: {
        "content-type": "application/x-git-upload-pack-request"
      },
      body: concat(
        pktLine(`want ${seeded.latestCommit}\n`),
        pktLine("deepen 20000\n"),
        pktLine("done\n"),
        new TextEncoder().encode("0000")
      )
    }),
    createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
  );

  expect(response.status).toBe(200);
  expect(new TextDecoder().decode(await response.arrayBuffer())).toContain(
    "ERR deepen exceeds maximum"
  );
});

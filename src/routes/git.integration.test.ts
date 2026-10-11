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

it("returns upload-pack result with packfile payload", async () => {
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
        pktLine("done\n"),
        new TextEncoder().encode("0000")
      )
    }),
    createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
  );

  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("application/x-git-upload-pack-result");
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(new TextDecoder().decode(bytes.subarray(0, 8))).toBe("0008NAK\n");
  expect(containsPackSignature(bytes)).toBe(true);
});

it("returns negotiation ACK or NAK only when done is missing", async () => {
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
        pktLine(`have ${seeded.initialCommit}\n`),
        new TextEncoder().encode("0000")
      )
    }),
    createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
  );

  expect(response.status).toBe(200);
  const lines = parsePktTextPrefix(new Uint8Array(await response.arrayBuffer()));
  expect(lines).toContain(`ACK ${seeded.initialCommit}\n`);
  expect(lines).not.toContain("FLUSH");
  expect(lines.some((line) => line.includes("PACK"))).toBe(false);
});

it("returns only the first ACK without a trailing flush during negotiation", async () => {
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
        pktLine(`have ${seeded.initialCommit}\n`),
        pktLine(`have ${seeded.latestCommit}\n`),
        new TextEncoder().encode("0000")
      )
    }),
    createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
  );

  expect(response.status).toBe(200);
  const lines = parsePktTextPrefix(new Uint8Array(await response.arrayBuffer()));
  expect(lines.filter((line) => line.startsWith("ACK "))).toEqual([
    `ACK ${seeded.initialCommit}\n`
  ]);
  expect(lines).not.toContain("FLUSH");
  expect(lines.some((line) => line.includes("PACK"))).toBe(false);
});

it("returns a single ACK before packfile when common commits are present", async () => {
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
        pktLine(`have ${seeded.initialCommit}\n`),
        pktLine("done\n"),
        new TextEncoder().encode("0000")
      )
    }),
    createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
  );

  expect(response.status).toBe(200);
  const bytes = new Uint8Array(await response.arrayBuffer());
  expect(new TextDecoder().decode(bytes.subarray(0, 49))).toBe(`0031ACK ${seeded.initialCommit}\n`);
  expect(containsPackSignature(bytes)).toBe(true);
});

it("returns protocol ERR when requested want object is missing", async () => {
  const bucket = new MockR2Bucket();
  await seedSampleRepositoryToR2(bucket, "alice", "demo");
  const missingOid = "ffffffffffffffffffffffffffffffffffffffff";

  const response = await app.fetch(
    new Request("http://localhost/alice/demo/git-upload-pack", {
      method: "POST",
      headers: {
        "content-type": "application/x-git-upload-pack-request"
      },
      body: concat(
        pktLine(`want ${missingOid}\n`),
        pktLine("done\n"),
        new TextEncoder().encode("0000")
      )
    }),
    createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
  );

  expect(response.status).toBe(200);
  expect(new TextDecoder().decode(await response.arrayBuffer())).toContain(
    "ERR want object not found"
  );
});

import { describe, expect, it } from "vitest";
import { seedSampleRepositoryToR2 } from "../test-utils/git-fixture";
import { MockR2Bucket } from "../test-utils/mock-r2";
import {
  RepositoryBrowserService,
  RepositoryBrowseInvalidPathError,
  RepositoryBrowsePathNotFoundError
} from "./repository-browser-service";
import { StorageService } from "./storage-service";

async function createServiceWithFixture() {
  const bucket = new MockR2Bucket();
  await seedSampleRepositoryToR2(bucket, "alice", "demo");
  const storage = new StorageService(bucket as unknown as R2Bucket);
  return new RepositoryBrowserService(storage);
}

describe("RepositoryBrowserService", () => {
  it("browses root tree with readme metadata", async () => {
    const service = await createServiceWithFixture();
    const result = await service.browseRepositoryContents({
      owner: "alice",
      repo: "demo"
    });

    expect(result.kind).toBe("tree");
    expect(result.path).toBe("");
    expect(result.entries.some((entry) => entry.type === "tree" && entry.path === "src")).toBe(true);
    expect(result.entries.some((entry) => entry.type === "blob" && entry.path === "README.md")).toBe(true);
    expect(result.readme?.path).toBe("README.md");
    expect(result.readme?.content).toContain("# Demo");
  });

  it("browses blob preview for text file", async () => {
    const service = await createServiceWithFixture();
    const result = await service.browseRepositoryContents({
      owner: "alice",
      repo: "demo",
      path: "src/app.txt"
    });

    expect(result.kind).toBe("blob");
    expect(result.path).toBe("src/app.txt");
    expect(result.file?.isBinary).toBe(false);
    expect(result.file?.truncated).toBe(false);
    expect(result.file?.content).toContain("console.log('hello')");
  });

  it("throws invalid-path error for parent-segment input", async () => {
    const service = await createServiceWithFixture();

    await expect(
      service.browseRepositoryContents({
        owner: "alice",
        repo: "demo",
        path: "../secret.txt"
      })
    ).rejects.toBeInstanceOf(RepositoryBrowseInvalidPathError);
  });

  it("throws not-found error for non-existing path", async () => {
    const service = await createServiceWithFixture();

    await expect(
      service.browseRepositoryContents({
        owner: "alice",
        repo: "demo",
        path: "missing.ts"
      })
    ).rejects.toBeInstanceOf(RepositoryBrowsePathNotFoundError);
  });

  it("returns structured diff hunks for commit detail", async () => {
    const bucket = new MockR2Bucket();
    const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const storage = new StorageService(bucket as unknown as R2Bucket);
    const service = new RepositoryBrowserService(storage);

    const detail = await service.getCommitDetail({
      owner: "alice",
      repo: "demo",
      oid: seeded.latestCommit
    });

    expect(detail.filesChanged).toBeGreaterThan(0);
    const readmeChange = detail.changes.find((change) => change.path === "README.md");
    expect(readmeChange?.patch).toContain("@@");
    expect(readmeChange?.hunks.length).toBeGreaterThan(0);
    expect(readmeChange?.hunks[0]?.lines.some((line) => line.kind === "add")).toBe(true);
    expect(readmeChange?.hunks[0]?.lines.some((line) => line.kind === "context")).toBe(true);

    const addedTextChange = detail.changes.find((change) => change.path === "src/app.txt");
    expect(addedTextChange?.status).toBe("added");
    expect(addedTextChange?.isBinary).toBe(false);
    expect(addedTextChange?.oldContent).toBe("");
    expect(addedTextChange?.newContent).toContain("console.log('hello')");
    expect(addedTextChange?.hunks.length).toBeGreaterThan(0);
    expect(addedTextChange?.hunks[0]?.lines.some((line) => line.kind === "add")).toBe(true);
  });

  it("returns structured diff hunks for compare refs", async () => {
    const bucket = new MockR2Bucket();
    const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const storage = new StorageService(bucket as unknown as R2Bucket);
    const service = new RepositoryBrowserService(storage);

    const comparison = await service.compareRefs({
      owner: "alice",
      repo: "demo",
      baseRef: seeded.initialCommit,
      headRef: seeded.latestCommit
    });

    expect(comparison.changes).toHaveLength(2);
    const readmeChange = comparison.changes.find((change) => change.path === "README.md");
    expect(readmeChange?.status).toBe("modified");
    expect(readmeChange?.hunks.length).toBeGreaterThan(0);
    expect(readmeChange?.hunks[0]?.header).toContain("@@");
    expect(
      readmeChange?.hunks[0]?.lines.some(
        (line) => line.kind === "add" && line.newLineNumber !== null && line.content.includes("Updated")
      )
    ).toBe(true);

    const addedTextChange = comparison.changes.find((change) => change.path === "src/app.txt");
    expect(addedTextChange?.status).toBe("added");
    expect(addedTextChange?.isBinary).toBe(false);
    expect(addedTextChange?.oldContent).toBe("");
    expect(addedTextChange?.newContent).toContain("console.log('hello')");
    expect(addedTextChange?.hunks.length).toBeGreaterThan(0);
    expect(addedTextChange?.hunks[0]?.lines.some((line) => line.kind === "add")).toBe(true);
  });
});

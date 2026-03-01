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
});

import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../../app";
import { createMockD1Database } from "../../test-utils/mock-d1";
import { seedSampleRepositoryToR2 } from "../../test-utils/git-fixture";
import { createMockRepositoryObjectNamespace } from "../../test-utils/mock-repository-object-namespace";
import { MockR2Bucket } from "../../test-utils/mock-r2";
import type { AppEnv } from "../../types";

function createEnv(db: D1Database, bucket: R2Bucket): AppEnv["Bindings"] {
  const env = {
    DB: db,
    GIT_BUCKET: bucket,
    JWT_SECRET: "test-secret",
    APP_ORIGIN: "http://localhost:8787"
  } as AppEnv["Bindings"];
  env.REPOSITORY_OBJECTS = createMockRepositoryObjectNamespace(() => env);
  return env;
}

function createPublicRepositoryDb(owner: string, repo: string): D1Database {
  return createMockD1Database([
    {
      when: "WHERE u.username = ? AND r.name = ?",
      first: (params) => {
        if (params[0] !== owner || params[1] !== repo) {
          return null;
        }
        return {
          id: "repo-1",
          owner_id: "user-1",
          owner_username: owner,
          name: repo,
          description: "demo repo",
          is_private: 0,
          created_at: Date.now()
        };
      }
    }
  ]);
}

describe("API repository browser route integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns repository details with branches and README", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo"),
      createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      defaultBranch: string;
      branches: Array<{ name: string; oid: string }>;
      readme: { path: string; content: string } | null;
    };
    expect(body.defaultBranch).toBe("main");
    expect(body.branches.some((item) => item.name === "main")).toBe(true);
    expect(body.readme?.content).toContain("# Demo");
  });

  it("returns commit history from newest to oldest", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/commits?limit=2"),
      createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { commits: Array<{ message: string }> };
    expect(body.commits).toHaveLength(2);
    expect(body.commits[0]?.message).toContain("second commit");
    expect(body.commits[1]?.message).toContain("initial commit");
  });

  it("returns repository contents for root tree", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/contents"),
      createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      kind: "tree" | "blob";
      path: string;
      entries: Array<{ name: string; path: string; type: string }>;
      readme: { path: string; content: string } | null;
    };
    expect(body.kind).toBe("tree");
    expect(body.path).toBe("");
    expect(body.entries.some((entry) => entry.type === "tree" && entry.path === "src")).toBe(true);
    expect(
      body.entries.some((entry) => entry.type === "blob" && entry.path === "README.md")
    ).toBe(true);
    expect(body.readme?.path).toBe("README.md");
    expect(body.readme?.content).toContain("# Demo");
  });

  it("returns file preview for blob path", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/contents?path=src%2Fapp.txt"),
      createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      kind: "tree" | "blob";
      path: string;
      file: {
        path: string;
        size: number;
        isBinary: boolean;
        truncated: boolean;
        content: string | null;
      } | null;
    };
    expect(body.kind).toBe("blob");
    expect(body.path).toBe("src/app.txt");
    expect(body.file?.path).toBe("src/app.txt");
    expect(body.file?.isBinary).toBe(false);
    expect(body.file?.truncated).toBe(false);
    expect(body.file?.size).toBeGreaterThan(0);
    expect(body.file?.content).toContain("console.log('hello')");
  });

  it("returns text diff hunks for added files in commit detail", async () => {
    const bucket = new MockR2Bucket();
    const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const response = await app.fetch(
      new Request(`http://localhost/api/repos/alice/demo/commits/${seeded.latestCommit}`),
      createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      changes: Array<{
        path: string;
        status: "added" | "modified" | "deleted";
        isBinary: boolean;
        oldContent: string | null;
        newContent: string | null;
        hunks: Array<{ lines: Array<{ kind: string }> }>;
      }>;
    };
    const addedTextChange = body.changes.find((change) => change.path === "src/app.txt");
    expect(addedTextChange?.status).toBe("added");
    expect(addedTextChange?.isBinary).toBe(false);
    expect(addedTextChange?.oldContent).toBe("");
    expect(addedTextChange?.newContent).toContain("console.log('hello')");
    expect(addedTextChange?.hunks.length).toBeGreaterThan(0);
    expect(addedTextChange?.hunks[0]?.lines.some((line) => line.kind === "add")).toBe(true);
  });

  it("returns text diff hunks for added files in compare", async () => {
    const bucket = new MockR2Bucket();
    const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const response = await app.fetch(
      new Request(
        `http://localhost/api/repos/alice/demo/compare?baseRef=${seeded.initialCommit}&headRef=${seeded.latestCommit}`
      ),
      createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      changes: Array<{
        path: string;
        status: "added" | "modified" | "deleted";
        isBinary: boolean;
        oldContent: string | null;
        newContent: string | null;
        hunks: Array<{ lines: Array<{ kind: string }> }>;
      }>;
    };
    const addedTextChange = body.changes.find((change) => change.path === "src/app.txt");
    expect(addedTextChange?.status).toBe("added");
    expect(addedTextChange?.isBinary).toBe(false);
    expect(addedTextChange?.oldContent).toBe("");
    expect(addedTextChange?.newContent).toContain("console.log('hello')");
    expect(addedTextChange?.hunks.length).toBeGreaterThan(0);
    expect(addedTextChange?.hunks[0]?.lines.some((line) => line.kind === "add")).toBe(true);
  });

  it("returns 400 for invalid repository content path", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/contents?path=..%2Fsecret.txt"),
      createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Invalid path");
  });

  it("returns 404 for missing repository content path", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/contents?path=missing.ts"),
      createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toContain("Path not found");
  });
});

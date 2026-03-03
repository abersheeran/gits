import { afterEach, describe, expect, it, vi } from "vitest";
import * as git from "isomorphic-git";
import { Volume, createFsFromVolume } from "memfs";
import app from "../app";
import { AuthService } from "../services/auth-service";
import { StorageService } from "../services/storage-service";
import { createMockD1Database } from "../test-utils/mock-d1";
import { seedSampleRepositoryToR2 } from "../test-utils/git-fixture";
import { MockR2Bucket } from "../test-utils/mock-r2";
import type { AppEnv } from "../types";

function createEnv(db: D1Database, bucket: R2Bucket): AppEnv["Bindings"] {
  return {
    DB: db,
    GIT_BUCKET: bucket,
    JWT_SECRET: "test-secret",
    APP_ORIGIN: "http://localhost:8787"
  };
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

function createPrivateOwnedRepositoryDb(owner: string, repo: string): D1Database {
  return createMockD1Database([
    {
      when: "WHERE u.username = ? AND r.name = ?",
      first: (params) => {
        if (params[0] !== owner || params[1] !== repo) {
          return null;
        }
        return {
          id: "repo-private-1",
          owner_id: "user-1",
          owner_username: owner,
          name: repo,
          description: "private repo",
          is_private: 1,
          created_at: Date.now()
        };
      }
    }
  ]);
}

function pktLine(payload: string): Uint8Array {
  const bytes = new TextEncoder().encode(payload);
  const total = bytes.length + 4;
  const out = new Uint8Array(total);
  out.set(new TextEncoder().encode(total.toString(16).padStart(4, "0")), 0);
  out.set(bytes, 4);
  return out;
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function containsPackSignature(bytes: Uint8Array): boolean {
  for (let i = 0; i <= bytes.length - 4; i += 1) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x41 &&
      bytes[i + 2] === 0x43 &&
      bytes[i + 3] === 0x4b
    ) {
      return true;
    }
  }
  return false;
}

function parsePktTextPrefix(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const header = new TextDecoder().decode(bytes.subarray(offset, offset + 4));
    if (!/^[0-9a-f]{4}$/i.test(header)) {
      break;
    }
    const length = Number.parseInt(header, 16);
    offset += 4;
    if (length === 0) {
      lines.push("FLUSH");
      continue;
    }
    const payloadLength = length - 4;
    if (payloadLength < 0 || offset + payloadLength > bytes.length) {
      break;
    }
    lines.push(new TextDecoder().decode(bytes.subarray(offset, offset + payloadLength)));
    offset += payloadLength;
  }
  return lines;
}

async function collectRequestBody(
  body: AsyncIterableIterator<Uint8Array> | undefined
): Promise<Uint8Array | undefined> {
  if (!body) {
    return undefined;
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return concat(...chunks);
}

function singleChunkBody(bytes: Uint8Array): AsyncIterableIterator<Uint8Array> {
  return (async function* generate() {
    if (bytes.byteLength > 0) {
      yield bytes;
    }
  })();
}

function createIsomorphicGitHttpClient(env: AppEnv["Bindings"]) {
  return {
    request: async (request: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: AsyncIterableIterator<Uint8Array>;
    }) => {
      const requestBody = await collectRequestBody(request.body);
      const response = await app.fetch(
        new Request(request.url, {
          method: request.method ?? "GET",
          headers: request.headers ?? {},
          body: requestBody
        }),
        env
      );
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        url: request.url,
        method: request.method,
        statusCode: response.status,
        statusMessage: response.statusText,
        headers,
        body: singleChunkBody(bytes)
      };
    }
  };
}

describe("API + Git integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns repository details with branches and README", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPublicRepositoryDb("alice", "demo");
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo"),
      createEnv(db, bucket as unknown as R2Bucket)
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
    const db = createPublicRepositoryDb("alice", "demo");
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/commits?limit=2"),
      createEnv(db, bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      commits: Array<{ message: string }>;
    };
    expect(body.commits).toHaveLength(2);
    expect(body.commits[0]?.message).toContain("second commit");
    expect(body.commits[1]?.message).toContain("initial commit");
  });

  it("returns repository contents for root tree", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPublicRepositoryDb("alice", "demo");
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/contents"),
      createEnv(db, bucket as unknown as R2Bucket)
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
    expect(body.entries.some((entry) => entry.type === "blob" && entry.path === "README.md")).toBe(true);
    expect(body.readme?.path).toBe("README.md");
    expect(body.readme?.content).toContain("# Demo");
  });

  it("returns file preview for blob path", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPublicRepositoryDb("alice", "demo");
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/contents?path=src%2Fapp.txt"),
      createEnv(db, bucket as unknown as R2Bucket)
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

  it("returns 400 for invalid repository content path", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPublicRepositoryDb("alice", "demo");
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/contents?path=..%2Fsecret.txt"),
      createEnv(db, bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).toContain("Invalid path");
  });

  it("returns 404 for missing repository content path", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPublicRepositoryDb("alice", "demo");
    const response = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/contents?path=missing.ts"),
      createEnv(db, bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(404);
    const body = await response.text();
    expect(body).toContain("Path not found");
  });

  it("returns upload-pack result with packfile payload", async () => {
    const bucket = new MockR2Bucket();
    const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPublicRepositoryDb("alice", "demo");

    const body = concat(
      pktLine(`want ${seeded.latestCommit}\n`),
      pktLine("done\n"),
      new TextEncoder().encode("0000")
    );
    const response = await app.fetch(
      new Request("http://localhost/alice/demo/git-upload-pack", {
        method: "POST",
        headers: {
          "content-type": "application/x-git-upload-pack-request"
        },
        body
      }),
      createEnv(db, bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-git-upload-pack-result");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const prefix = new TextDecoder().decode(bytes.subarray(0, 8));
    expect(prefix).toBe("0008NAK\n");
    expect(containsPackSignature(bytes)).toBe(true);
  });

  it("returns negotiation ACK/NAK only when done is missing", async () => {
    const bucket = new MockR2Bucket();
    const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPublicRepositoryDb("alice", "demo");

    const body = concat(
      pktLine(`want ${seeded.latestCommit}\n`),
      pktLine(`have ${seeded.initialCommit}\n`),
      new TextEncoder().encode("0000")
    );
    const response = await app.fetch(
      new Request("http://localhost/alice/demo/git-upload-pack", {
        method: "POST",
        headers: {
          "content-type": "application/x-git-upload-pack-request"
        },
        body
      }),
      createEnv(db, bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(200);
    const lines = parsePktTextPrefix(new Uint8Array(await response.arrayBuffer()));
    expect(lines).toContain(`ACK ${seeded.initialCommit}\n`);
    expect(lines).toContain("FLUSH");
    expect(lines.some((line) => line.includes("PACK"))).toBe(false);
  });

  it("returns shallow lines when deepen is requested", async () => {
    const bucket = new MockR2Bucket();
    const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPublicRepositoryDb("alice", "demo");

    const body = concat(
      pktLine(`want ${seeded.latestCommit}\n`),
      pktLine("deepen 1\n"),
      pktLine("done\n"),
      new TextEncoder().encode("0000")
    );
    const response = await app.fetch(
      new Request("http://localhost/alice/demo/git-upload-pack", {
        method: "POST",
        headers: {
          "content-type": "application/x-git-upload-pack-request"
        },
        body
      }),
      createEnv(db, bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const lines = parsePktTextPrefix(bytes);
    expect(lines).toContain(`shallow ${seeded.latestCommit}\n`);
    expect(containsPackSignature(bytes)).toBe(true);
  });

  it("supports deepen-since requests", async () => {
    const bucket = new MockR2Bucket();
    const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPublicRepositoryDb("alice", "demo");

    const body = concat(
      pktLine(`want ${seeded.latestCommit}\n`),
      pktLine("deepen-since 0\n"),
      pktLine("done\n"),
      new TextEncoder().encode("0000")
    );
    const response = await app.fetch(
      new Request("http://localhost/alice/demo/git-upload-pack", {
        method: "POST",
        headers: {
          "content-type": "application/x-git-upload-pack-request"
        },
        body
      }),
      createEnv(db, bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes).includes("ERR")).toBe(false);
    expect(containsPackSignature(bytes)).toBe(true);
  });

  it("supports deepen-not requests", async () => {
    const bucket = new MockR2Bucket();
    const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPublicRepositoryDb("alice", "demo");

    const body = concat(
      pktLine(`want ${seeded.latestCommit}\n`),
      pktLine("deepen-not refs/heads/feature\n"),
      pktLine("done\n"),
      new TextEncoder().encode("0000")
    );
    const response = await app.fetch(
      new Request("http://localhost/alice/demo/git-upload-pack", {
        method: "POST",
        headers: {
          "content-type": "application/x-git-upload-pack-request"
        },
        body
      }),
      createEnv(db, bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(200);
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(new TextDecoder().decode(bytes).includes("ERR")).toBe(false);
    expect(containsPackSignature(bytes)).toBe(false);
  });

  it("supports blob:none filter requests", async () => {
    const bucket = new MockR2Bucket();
    const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPublicRepositoryDb("alice", "demo");

    const body = concat(
      pktLine(`want ${seeded.latestCommit}\n`),
      pktLine("filter blob:none\n"),
      pktLine("done\n"),
      new TextEncoder().encode("0000")
    );
    const response = await app.fetch(
      new Request("http://localhost/alice/demo/git-upload-pack", {
        method: "POST",
        headers: {
          "content-type": "application/x-git-upload-pack-request"
        },
        body
      }),
      createEnv(db, bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-git-upload-pack-result");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    expect(text.includes("ERR")).toBe(false);
    expect(containsPackSignature(bytes)).toBe(true);
  });

  it("returns protocol ERR for unknown filter spec", async () => {
    const bucket = new MockR2Bucket();
    const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPublicRepositoryDb("alice", "demo");

    const body = concat(
      pktLine(`want ${seeded.latestCommit}\n`),
      pktLine("filter tree:0\n"),
      pktLine("done\n"),
      new TextEncoder().encode("0000")
    );
    const response = await app.fetch(
      new Request("http://localhost/alice/demo/git-upload-pack", {
        method: "POST",
        headers: {
          "content-type": "application/x-git-upload-pack-request"
        },
        body
      }),
      createEnv(db, bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(200);
    const text = new TextDecoder().decode(await response.arrayBuffer());
    expect(text).toContain("ERR filter unsupported");
  });

  it("returns protocol ERR when requested want object is missing", async () => {
    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPublicRepositoryDb("alice", "demo");
    const missingOid = "ffffffffffffffffffffffffffffffffffffffff";

    const body = concat(
      pktLine(`want ${missingOid}\n`),
      pktLine("done\n"),
      new TextEncoder().encode("0000")
    );
    const response = await app.fetch(
      new Request("http://localhost/alice/demo/git-upload-pack", {
        method: "POST",
        headers: {
          "content-type": "application/x-git-upload-pack-request"
        },
        body
      }),
      createEnv(db, bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(200);
    const text = new TextDecoder().decode(await response.arrayBuffer());
    expect(text).toContain("ERR want object not found");
  });

  it("returns protocol ERR when deepen exceeds server limit", async () => {
    const bucket = new MockR2Bucket();
    const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPublicRepositoryDb("alice", "demo");

    const body = concat(
      pktLine(`want ${seeded.latestCommit}\n`),
      pktLine("deepen 20000\n"),
      pktLine("done\n"),
      new TextEncoder().encode("0000")
    );
    const response = await app.fetch(
      new Request("http://localhost/alice/demo/git-upload-pack", {
        method: "POST",
        headers: {
          "content-type": "application/x-git-upload-pack-request"
        },
        body
      }),
      createEnv(db, bucket as unknown as R2Bucket)
    );

    expect(response.status).toBe(200);
    const text = new TextDecoder().decode(await response.arrayBuffer());
    expect(text).toContain("ERR deepen exceeds maximum");
  });

  it("is compatible with isomorphic-git fetch client", async () => {
    const bucket = new MockR2Bucket();
    const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPublicRepositoryDb("alice", "demo");
    const env = createEnv(db, bucket as unknown as R2Bucket);

    const volume = new Volume();
    const fs = createFsFromVolume(volume) as unknown as {
      promises: {
        mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
      };
    };
    await fs.promises.mkdir("/clone", { recursive: true });
    await git.init({
      fs: fs as never,
      dir: "/clone",
      defaultBranch: "main"
    });
    await git.addRemote({
      fs: fs as never,
      dir: "/clone",
      remote: "origin",
      url: "http://localhost/alice/demo.git",
      force: true
    });

    const result = await git.fetch({
      fs: fs as never,
      http: createIsomorphicGitHttpClient(env) as never,
      dir: "/clone",
      remote: "origin",
      ref: "main",
      singleBranch: true,
      depth: 1
    });

    expect(result.fetchHead).toBe(seeded.latestCommit);
  });

  it("supports authenticated push to private repository", async () => {
    const bucket = new MockR2Bucket();
    const storage = new StorageService(bucket as unknown as R2Bucket);
    await storage.initializeRepository("alice", "private-demo");
    const db = createPrivateOwnedRepositoryDb("alice", "private-demo");
    const env = createEnv(db, bucket as unknown as R2Bucket);

    vi.spyOn(AuthService.prototype, "verifyAccessToken").mockImplementation(async (token) => {
      if (token === "pat-ok") {
        return { id: "user-1", username: "alice" };
      }
      return null;
    });

    const volume = new Volume();
    const fs = createFsFromVolume(volume) as unknown as {
      promises: {
        mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
        writeFile(path: string, content: string): Promise<void>;
      };
    };
    await fs.promises.mkdir("/work", { recursive: true });
    await git.init({
      fs: fs as never,
      dir: "/work",
      defaultBranch: "main"
    });
    await fs.promises.writeFile("/work/README.md", "# private\n");
    await git.add({
      fs: fs as never,
      dir: "/work",
      filepath: "README.md"
    });
    const localCommit = await git.commit({
      fs: fs as never,
      dir: "/work",
      message: "initial private commit",
      author: {
        name: "Alice",
        email: "alice@example.com"
      }
    });
    await git.addRemote({
      fs: fs as never,
      dir: "/work",
      remote: "origin",
      url: "http://localhost/alice/private-demo.git",
      force: true
    });

    const result = await git.push({
      fs: fs as never,
      http: createIsomorphicGitHttpClient(env) as never,
      dir: "/work",
      remote: "origin",
      ref: "main",
      onAuth: async () => ({
        username: "alice",
        password: "pat-ok"
      })
    });

    expect(result.ok).toBe(true);
    expect(result.refs["refs/heads/main"]?.ok).toBe(true);

    const refs = await storage.listHeadRefs("alice", "private-demo");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.name).toBe("refs/heads/main");
    expect(refs[0]?.oid).toBe(localCommit);
    const objectKeys = await storage.listObjectKeys("alice", "private-demo");
    expect(objectKeys.length).toBeGreaterThan(0);
  });
});

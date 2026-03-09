import * as git from "isomorphic-git";
import { Volume, createFsFromVolume } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../app";
import { AuthService } from "../services/auth-service";
import { StorageService } from "../services/storage-service";
import { createMockD1Database } from "../test-utils/mock-d1";
import { seedSampleRepositoryToR2 } from "../test-utils/git-fixture";
import { createMockRepositoryObjectNamespace } from "../test-utils/mock-repository-object-namespace";
import { MockR2Bucket } from "../test-utils/mock-r2";
import type { AppEnv } from "../types";

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

describe("Git smart-http integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(new TextDecoder().decode(bytes.subarray(0, 49))).toBe(
      `0031ACK ${seeded.initialCommit}\n`
    );
    expect(containsPackSignature(bytes)).toBe(true);
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

  it("is compatible with isomorphic-git fetch client", async () => {
    const bucket = new MockR2Bucket();
    const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const env = createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket);

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
    const env = createEnv(
      createPrivateOwnedRepositoryDb("alice", "private-demo"),
      bucket as unknown as R2Bucket
    );

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
    expect((await storage.listObjectKeys("alice", "private-demo")).length).toBeGreaterThan(0);
  });
});

  it("creates, switches, and deletes branches via repository APIs", async () => {
    vi.spyOn(AuthService.prototype, "verifySessionToken").mockResolvedValue({
      id: "user-1",
      username: "alice"
    });

    const bucket = new MockR2Bucket();
    await seedSampleRepositoryToR2(bucket, "alice", "demo");
    const db = createPrivateOwnedRepositoryDb("alice", "demo");
    const env = createEnv(db, bucket as unknown as R2Bucket);

    const initialDetailResponse = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo", {
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      env
    );
    expect(initialDetailResponse.status).toBe(200);
    const initialDetail = (await initialDetailResponse.json()) as {
      headOid: string;
      defaultBranch: string | null;
      branches: Array<{ name: string; oid: string }>;
    };
    expect(initialDetail.headOid).toBeTruthy();
    expect(initialDetail.defaultBranch).toBe("main");

    const createResponse = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/branches", {
        method: "POST",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          branchName: "develop",
          sourceOid: initialDetail.headOid
        })
      }),
      env
    );
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      branches: Array<{ name: string }>;
    };
    expect(created.branches.some((item) => item.name === "refs/heads/develop")).toBe(true);

    const setDefaultResponse = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/default-branch", {
        method: "PATCH",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          branchName: "develop"
        })
      }),
      env
    );
    expect(setDefaultResponse.status).toBe(200);
    const updatedDefault = (await setDefaultResponse.json()) as {
      defaultBranch: string | null;
    };
    expect(updatedDefault.defaultBranch).toBe("develop");

    const deleteDefaultResponse = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/branches/develop", {
        method: "DELETE",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      env
    );
    expect(deleteDefaultResponse.status).toBe(409);

    const resetDefaultResponse = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/default-branch", {
        method: "PATCH",
        headers: {
          authorization: "Bearer session-ok",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          branchName: "main"
        })
      }),
      env
    );
    expect(resetDefaultResponse.status).toBe(200);

    const deleteResponse = await app.fetch(
      new Request("http://localhost/api/repos/alice/demo/branches/develop", {
        method: "DELETE",
        headers: {
          authorization: "Bearer session-ok"
        }
      }),
      env
    );
    expect(deleteResponse.status).toBe(200);
    const afterDelete = (await deleteResponse.json()) as {
      branches: Array<{ name: string }>;
      defaultBranch: string | null;
    };
    expect(afterDelete.defaultBranch).toBe("main");
    expect(afterDelete.branches.some((item) => item.name === "refs/heads/develop")).toBe(false);
  });

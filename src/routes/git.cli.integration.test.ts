import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../app";
import { AuthService } from "../services/auth-service";
import { PullRequestMergeService } from "../services/pull-request-merge-service";
import { StorageService } from "../services/storage-service";
import { createMockD1Database } from "../test-utils/mock-d1";
import { seedSampleRepositoryToR2 } from "../test-utils/git-fixture";
import { MockR2Bucket } from "../test-utils/mock-r2";
import type { AppEnv } from "../types";

const execFile = promisify(execFileCallback);

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
          id: "repo-public-1",
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

async function startAppServer(env: AppEnv["Bindings"]): Promise<{
  origin: string;
  close: () => Promise<void>;
}> {
  const toRequestHeaders = (req: IncomingMessage): Headers => {
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          headers.append(key, item);
        }
        continue;
      }
      headers.set(key, value);
    }
    return headers;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }

      const hasBody = chunks.length > 0;
      const url = `http://${req.headers.host ?? "127.0.0.1"}${req.url ?? "/"}`;
      const request = new Request(url, {
        method: req.method ?? "GET",
        headers: toRequestHeaders(req),
        body: hasBody ? Buffer.concat(chunks) : undefined,
        duplex: hasBody ? "half" : undefined
      });
      const response = await app.fetch(request, env);

      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });
      const body = Buffer.from(await response.arrayBuffer());
      res.end(body);
    } catch {
      res.statusCode = 500;
      res.end("internal server error");
    }
  };

  const server = createServer((req, res) => {
    void handle(req, res);
  });

  server.on("checkContinue", (req, res) => {
    res.writeContinue();
    void handle(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test HTTP server");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const result = await execFile("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0"
    },
    maxBuffer: 10 * 1024 * 1024
  });
  return result.stdout;
}

describe("Git smart-http compatibility with git CLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it(
    "supports git clone for public repositories",
    async () => {
      const bucket = new MockR2Bucket();
      await seedSampleRepositoryToR2(bucket, "alice", "demo");
      const db = createPublicRepositoryDb("alice", "demo");
      const env = createEnv(db, bucket as unknown as R2Bucket);
      const server = await startAppServer(env);
      const tempRoot = await mkdtemp(join(tmpdir(), "gits-cli-clone-"));
      const cloneDir = join(tempRoot, "clone");

      try {
        await runGit(["clone", `${server.origin}/alice/demo.git`, cloneDir], tempRoot);
        const readme = await readFile(join(cloneDir, "README.md"), "utf8");
        expect(readme).toContain("# Demo");
      } finally {
        await server.close();
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
    30_000
  );

  it(
    "supports authenticated git push to private repositories",
    async () => {
      const bucket = new MockR2Bucket();
      const storage = new StorageService(bucket as unknown as R2Bucket);
      await storage.initializeRepository("alice", "private-demo");
      const db = createPrivateOwnedRepositoryDb("alice", "private-demo");
      const env = createEnv(db, bucket as unknown as R2Bucket);
      const verifyTokenSpy = vi
        .spyOn(AuthService.prototype, "verifyAccessToken")
        .mockImplementation(async (token: string) => {
          if (token === "pat-ok") {
            return { id: "user-1", username: "alice" };
          }
          return null;
        });

      const server = await startAppServer(env);
      const tempRoot = await mkdtemp(join(tmpdir(), "gits-cli-push-"));
      const workDir = join(tempRoot, "work");

      try {
        await runGit(["init", "-b", "main", workDir], tempRoot);
        await runGit(["config", "user.name", "Alice"], workDir);
        await runGit(["config", "user.email", "alice@example.com"], workDir);
        await writeFile(join(workDir, "README.md"), "# private\n", "utf8");
        await runGit(["add", "README.md"], workDir);
        await runGit(["commit", "-m", "initial private commit"], workDir);
        const localCommit = (await runGit(["rev-parse", "HEAD"], workDir)).trim();
        const remoteUrl = `${server.origin.replace("http://", "http://alice:pat-ok@")}/alice/private-demo.git`;
        await runGit(["remote", "add", "origin", remoteUrl], workDir);
        await runGit(["push", "origin", "main"], workDir);

        expect(verifyTokenSpy).toHaveBeenCalled();
        const refs = await storage.listHeadRefs("alice", "private-demo");
        expect(refs).toHaveLength(1);
        expect(refs[0]?.name).toBe("refs/heads/main");
        expect(refs[0]?.oid).toBe(localCommit);
      } finally {
        await server.close();
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
    30_000
  );

  it(
    "supports authenticated git pull from private repositories",
    async () => {
      const bucket = new MockR2Bucket();
      await seedSampleRepositoryToR2(bucket, "alice", "private-pull");
      const db = createPrivateOwnedRepositoryDb("alice", "private-pull");
      const env = createEnv(db, bucket as unknown as R2Bucket);
      vi.spyOn(AuthService.prototype, "verifyAccessToken").mockImplementation(
        async (token: string) => {
          if (token === "pat-ok") {
            return { id: "user-1", username: "alice" };
          }
          return null;
        }
      );

      const server = await startAppServer(env);
      const tempRoot = await mkdtemp(join(tmpdir(), "gits-cli-pull-"));
      const workDir = join(tempRoot, "work");
      const mirrorDir = join(tempRoot, "mirror");

      try {
        const remoteUrl = `${server.origin.replace("http://", "http://alice:pat-ok@")}/alice/private-pull.git`;
        await runGit(["clone", remoteUrl, workDir], tempRoot);
        const beforePull = (await runGit(["rev-parse", "HEAD"], workDir)).trim();

        await runGit(["clone", remoteUrl, mirrorDir], tempRoot);
        await runGit(["config", "user.name", "Alice"], mirrorDir);
        await runGit(["config", "user.email", "alice@example.com"], mirrorDir);
        const readmePath = join(mirrorDir, "README.md");
        const readmeContent = await readFile(readmePath, "utf8");
        await writeFile(readmePath, `${readmeContent}\nupdate from mirror\n`, "utf8");
        await runGit(["add", "README.md"], mirrorDir);
        await runGit(["commit", "-m", "update from mirror"], mirrorDir);
        const pushedCommit = (await runGit(["rev-parse", "HEAD"], mirrorDir)).trim();
        await runGit(["push", "origin", "main"], mirrorDir);

        await runGit(["pull", "origin", "main"], workDir);
        const afterPull = (await runGit(["rev-parse", "HEAD"], workDir)).trim();
        const pulledReadme = await readFile(join(workDir, "README.md"), "utf8");

        expect(afterPull).not.toBe(beforePull);
        expect(afterPull).toBe(pushedCommit);
        expect(pulledReadme).toContain("update from mirror");
      } finally {
        await server.close();
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
    30_000
  );

  it(
    "supports git pull after a server-side squash merged pull request",
    async () => {
      const bucket = new MockR2Bucket();
      await seedSampleRepositoryToR2(bucket, "alice", "squash-pull");
      const storage = new StorageService(bucket as unknown as R2Bucket);
      const db = createPrivateOwnedRepositoryDb("alice", "squash-pull");
      const env = createEnv(db, bucket as unknown as R2Bucket);
      vi.spyOn(AuthService.prototype, "verifyAccessToken").mockImplementation(
        async (token: string) => {
          if (token === "pat-ok") {
            return { id: "user-1", username: "alice" };
          }
          return null;
        }
      );
      const server = await startAppServer(env);
      const tempRoot = await mkdtemp(join(tmpdir(), "gits-cli-squash-pull-"));
      const workDir = join(tempRoot, "work");
      const mirrorDir = join(tempRoot, "mirror");

      try {
        const remoteUrl = `${server.origin.replace("http://", "http://alice:pat-ok@")}/alice/squash-pull.git`;
        await runGit(["clone", remoteUrl, workDir], tempRoot);
        const beforePull = (await runGit(["rev-parse", "HEAD"], workDir)).trim();

        await runGit(["clone", remoteUrl, mirrorDir], tempRoot);
        await runGit(["checkout", "-b", "feature"], mirrorDir);
        await runGit(["config", "user.name", "Alice"], mirrorDir);
        await runGit(["config", "user.email", "alice@example.com"], mirrorDir);
        await writeFile(join(mirrorDir, "feature.txt"), "feature branch change\n", "utf8");
        await runGit(["add", "feature.txt"], mirrorDir);
        await runGit(["commit", "-m", "feature branch change"], mirrorDir);
        const featureHead = (await runGit(["rev-parse", "HEAD"], mirrorDir)).trim();
        await runGit(["push", "origin", "feature"], mirrorDir);

        const refs = await storage.listHeadRefs("alice", "squash-pull");
        const mainRef = refs.find((item) => item.name === "refs/heads/main");
        expect(mainRef).toBeTruthy();

        const mergeService = new PullRequestMergeService(storage);
        await mergeService.squashMergePullRequest({
          owner: "alice",
          repo: "squash-pull",
          pullRequest: {
            id: "pr-1",
            repository_id: "repo-public-1",
            number: 1,
            author_id: "user-1",
            author_username: "alice",
            title: "Add feature file",
            body: "Created on feature branch",
            state: "open",
            base_ref: "refs/heads/main",
            head_ref: "refs/heads/feature",
            base_oid: mainRef?.oid ?? "",
            head_oid: featureHead,
            merge_commit_oid: null,
            created_at: Date.now(),
            updated_at: Date.now(),
            closed_at: null,
            merged_at: null
          },
          mergedBy: {
            id: "user-1",
            username: "alice"
          }
        });

        await runGit(["pull", "origin", "main"], workDir);
        const afterPull = (await runGit(["rev-parse", "HEAD"], workDir)).trim();
        const featureFile = await readFile(join(workDir, "feature.txt"), "utf8");

        expect(afterPull).not.toBe(beforePull);
        expect(featureFile).toBe("feature branch change\n");
      } finally {
        await server.close();
        await rm(tempRoot, { recursive: true, force: true });
      }
    },
    30_000
  );
});

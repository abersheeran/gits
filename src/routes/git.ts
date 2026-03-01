import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { optionalSession, requireGitBasicAuth } from "../middleware/auth";
import { GitService } from "../services/git-service";
import { RepositoryService } from "../services/repository-service";
import { StorageService } from "../services/storage-service";
import type { AppEnv, GitServiceName } from "../types";

function parseService(raw: string | undefined): GitServiceName {
  if (raw !== "git-upload-pack" && raw !== "git-receive-pack") {
    throw new HTTPException(400, { message: "Invalid service query parameter" });
  }
  return raw;
}

function normalizeRepoName(raw: string): string {
  return raw.endsWith(".git") ? raw.slice(0, -4) : raw;
}

const MAX_UPLOAD_PACK_BODY_BYTES = 8 * 1024 * 1024;
const MAX_RECEIVE_PACK_BODY_BYTES = 32 * 1024 * 1024;

function uploadPackBodyLimit(c: { env: AppEnv["Bindings"] }): number {
  const raw = c.env.UPLOAD_PACK_MAX_BODY_BYTES;
  if (!raw) {
    return MAX_UPLOAD_PACK_BODY_BYTES;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || Number.isNaN(value) || value <= 0) {
    return MAX_UPLOAD_PACK_BODY_BYTES;
  }
  return value;
}

function receivePackBodyLimit(c: { env: AppEnv["Bindings"] }): number {
  const raw = c.env.RECEIVE_PACK_MAX_BODY_BYTES;
  if (!raw) {
    return MAX_RECEIVE_PACK_BODY_BYTES;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || Number.isNaN(value) || value <= 0) {
    return MAX_RECEIVE_PACK_BODY_BYTES;
  }
  return value;
}

async function readBodyWithLimit(
  c: {
    req: { header(name: string): string | undefined; arrayBuffer(): Promise<ArrayBuffer> };
    env: AppEnv["Bindings"];
  },
  maxBytes: number
): Promise<ArrayBuffer> {
  const contentLengthHeader = c.req.header("content-length");
  if (contentLengthHeader) {
    const value = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(value) && value > maxBytes) {
      throw new HTTPException(413, { message: "Request body too large" });
    }
  }

  const body = await c.req.arrayBuffer();
  if (body.byteLength > maxBytes) {
    throw new HTTPException(413, { message: "Request body too large" });
  }
  return body;
}

const router = new Hono<AppEnv>();

router.get("/:owner/:repo/info/refs", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = normalizeRepoName(c.req.param("repo"));
  const service = parseService(c.req.query("service"));
  const authHeader = c.req.header("authorization") ?? "";

  if (service === "git-receive-pack") {
    await requireGitBasicAuth(c, async () => undefined);
  } else if (authHeader.startsWith("Basic ")) {
    await requireGitBasicAuth(c, async () => undefined);
  }

  const user = c.get("basicAuthUser") ?? c.get("sessionUser");
  const serviceImpl = new GitService(
    new RepositoryService(c.env.DB),
    new StorageService(c.env.GIT_BUCKET)
  );

  const requestInput: {
    owner: string;
    repo: string;
    service: GitServiceName;
    user?: (typeof user);
  } = {
    owner,
    repo,
    service
  };
  if (user) {
    requestInput.user = user;
  }

  return serviceImpl.handleInfoRefs(requestInput);
});

router.post("/:owner/:repo/git-upload-pack", optionalSession, async (c) => {
  const owner = c.req.param("owner");
  const repo = normalizeRepoName(c.req.param("repo"));
  const authHeader = c.req.header("authorization") ?? "";
  const contentType = c.req.header("content-type")?.toLowerCase() ?? "";

  if (!contentType.startsWith("application/x-git-upload-pack-request")) {
    throw new HTTPException(415, { message: "Unsupported content type" });
  }

  if (authHeader.startsWith("Basic ")) {
    await requireGitBasicAuth(c, async () => undefined);
  }

  const serviceImpl = new GitService(
    new RepositoryService(c.env.DB),
    new StorageService(c.env.GIT_BUCKET)
  );
  const body = await readBodyWithLimit(c, uploadPackBodyLimit(c));

  const user = c.get("basicAuthUser") ?? c.get("sessionUser");
  const requestInput: {
    owner: string;
    repo: string;
    body: ArrayBuffer;
    user?: (typeof user);
  } = {
    owner,
    repo,
    body
  };
  if (user) {
    requestInput.user = user;
  }

  return serviceImpl.handleUploadPack(requestInput);
});

router.post("/:owner/:repo/git-receive-pack", requireGitBasicAuth, async (c) => {
  const owner = c.req.param("owner");
  const repo = normalizeRepoName(c.req.param("repo"));
  const contentType = c.req.header("content-type")?.toLowerCase() ?? "";

  if (!contentType.startsWith("application/x-git-receive-pack-request")) {
    throw new HTTPException(415, { message: "Unsupported content type" });
  }

  const serviceImpl = new GitService(
    new RepositoryService(c.env.DB),
    new StorageService(c.env.GIT_BUCKET)
  );
  const body = await readBodyWithLimit(c, receivePackBodyLimit(c));

  const user = c.get("basicAuthUser");
  const requestInput: {
    owner: string;
    repo: string;
    body: ArrayBuffer;
    user?: (typeof user);
  } = {
    owner,
    repo,
    body
  };
  if (user) {
    requestInput.user = user;
  }

  return serviceImpl.handleReceivePack(requestInput);
});

export default router;

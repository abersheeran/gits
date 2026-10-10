import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { optionalSession, requireGitBasicAuth } from "../middleware/auth";
import { createRepositoryObjectClient } from "../services/repository-object-client";
import { RepositoryService } from "../services/repository-service";
import type { AppEnv, AuthUser, GitServiceName, RepositoryRecord } from "../types";

function parseService(raw: string | undefined): GitServiceName {
  if (raw !== "git-upload-pack" && raw !== "git-receive-pack") {
    throw new HTTPException(400, { message: "Invalid service query parameter" });
  }
  return raw;
}

function normalizeRepoName(raw: string): string {
  return raw.endsWith(".git") ? raw.slice(0, -4) : raw;
}

function throwGitAuthChallenge(message: string): never {
  throw new HTTPException(401, {
    message,
    res: new Response("Authentication required", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Git service"'
      }
    })
  });
}

async function resolveGitRepositoryAccess(args: {
  repositoryService: RepositoryService;
  owner: string;
  repo: string;
  user?: AuthUser;
  write?: boolean;
}): Promise<RepositoryRecord> {
  const repository = await args.repositoryService.findRepository(args.owner, args.repo);
  if (!repository) {
    throw new HTTPException(404, { message: "Repository not found" });
  }

  const canRead = await args.repositoryService.canReadRepository(repository, args.user?.id);
  if (!canRead) {
    if (!args.user && repository.is_private !== 0) {
      throwGitAuthChallenge("Authentication required");
    }
    throw new HTTPException(404, { message: "Repository not found" });
  }

  if (args.write) {
    const canWrite = await args.repositoryService.canWriteRepository(repository, args.user?.id);
    if (!canWrite) {
      throw new HTTPException(403, { message: "Forbidden" });
    }
  }

  return repository;
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
  const repositoryService = new RepositoryService(c.env.DB);
  const repository = await resolveGitRepositoryAccess({
    repositoryService,
    owner,
    repo,
    ...(user ? { user } : {}),
    ...(service === "git-receive-pack" ? { write: true } : {})
  });

  return createRepositoryObjectClient(c.env).handleInfoRefs({
    repositoryId: repository.id,
    owner,
    repo,
    service
  });
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

  const repositoryService = new RepositoryService(c.env.DB);
  const body = await readBodyWithLimit(c, uploadPackBodyLimit(c));

  const user = c.get("basicAuthUser") ?? c.get("sessionUser");
  const repository = await resolveGitRepositoryAccess({
    repositoryService,
    owner,
    repo,
    ...(user ? { user } : {})
  });
  return createRepositoryObjectClient(c.env).handleUploadPack({
    repositoryId: repository.id,
    owner,
    repo,
    body
  });
});

router.post("/:owner/:repo/git-receive-pack", requireGitBasicAuth, async (c) => {
  const owner = c.req.param("owner");
  const repo = normalizeRepoName(c.req.param("repo"));
  const contentType = c.req.header("content-type")?.toLowerCase() ?? "";

  if (!contentType.startsWith("application/x-git-receive-pack-request")) {
    throw new HTTPException(415, { message: "Unsupported content type" });
  }

  const repositoryService = new RepositoryService(c.env.DB);
  const body = await readBodyWithLimit(c, receivePackBodyLimit(c));
  const user = c.get("basicAuthUser");
  const repository = await resolveGitRepositoryAccess({
    repositoryService,
    owner,
    repo,
    ...(user ? { user } : {}),
    write: true
  });
  return createRepositoryObjectClient(c.env).handleReceivePack({
    repositoryId: repository.id,
    owner,
    repo,
    body
  });
});

export default router;

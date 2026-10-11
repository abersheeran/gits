import { HTTPException } from "hono/http-exception";
import type { AuthUser, GitServiceName } from "../types";
import { ProtocolError } from "./git-errors";
import { buildInfoRefsResponse } from "./git-info-refs";
import { encodeProtocolError, parseUploadPackRequest } from "./git-protocol";
import { receivePack } from "./git-receive-pack";
import { ObjectStore } from "./git-store/object-store";
import { RefStore } from "./git-store/ref-store";
import { uploadPack } from "./git-upload-pack";
import { RepositoryService } from "./repository-service";

type RepoAccessArgs = { owner: string; repo: string; user?: AuthUser };
type RefsArgs = RepoAccessArgs & { service: GitServiceName };

export class GitService {
  constructor(
    private readonly store: ObjectStore,
    private readonly refs: RefStore,
    private readonly repositories?: RepositoryService
  ) {
  }
  private throwGitAuthChallenge(message: string): never {
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

  private async resolveRepo(args: RefsArgs | RepoAccessArgs, write = false) {
    const repo = await this.repositories!.findRepository(args.owner, args.repo);
    if (!repo) {
      throw new HTTPException(404, { message: "Repository not found" });
    }

    const canRead = await this.repositories!.canReadRepository(repo, args.user?.id);
    if (!canRead) {
      if (!args.user && repo.is_private !== 0) {
        this.throwGitAuthChallenge("Authentication required");
      }
      throw new HTTPException(404, { message: "Repository not found" });
    }

    if (write) {
      const canWrite = await this.repositories!.canWriteRepository(repo, args.user?.id);
      if (!canWrite) {
        throw new HTTPException(403, { message: "Forbidden" });
      }
    }

    return repo;
  }

  async handleInfoRefs(args: RefsArgs): Promise<Response> {
    if (this.repositories) {
      await this.resolveRepo(args, args.service === "git-receive-pack");
    }
    return buildInfoRefsResponse({
      service: args.service,
      refs: this.refs.listRefs(),
      storedHead: this.refs.getHead()
    });
  }

  async handleUploadPack(args: RepoAccessArgs & { body: ArrayBuffer }): Promise<Response> {
    if (this.repositories) {
      await this.resolveRepo(args);
    }
    let response: Response;
    try {
      response = await uploadPack(this.store, this.refs, args.body);
    } catch (error) {
      if (!(error instanceof ProtocolError)) {
        throw error;
      }
      let capabilities: Set<string> | undefined;
      try {
        capabilities = parseUploadPackRequest(args.body).capabilities;
      } catch {
        capabilities = undefined;
      }
      response = new Response(Uint8Array.from(encodeProtocolError(error.message, capabilities)));
    }
    response.headers.set("Content-Type", "application/x-git-upload-pack-result");
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  async handleReceivePack(
    args: RepoAccessArgs & { body: ReadableStream<Uint8Array> }
  ): Promise<Response> {
    if (this.repositories) {
      await this.resolveRepo(args, true);
    }
    return receivePack({ store: this.store, refs: this.refs, body: args.body });
  }
}

import { HTTPException } from "hono/http-exception";
import * as git from "isomorphic-git";
import {
  buildReceivePackReport,
  buildUploadPackNegotiationResponse,
  buildUploadPackResponse,
  encodeFlushPktLine,
  encodeProtocolError,
  encodeTextPktLine,
  isZeroOid,
  parseReceivePackRequest,
  parseUploadPackRequest
} from "./git-protocol";
import { loadRepositoryFromStorage, persistRepositoryToStorage } from "./git-repo-loader";
import { ProtocolError, UnsupportedFeatureError } from "./git-errors";
import {
  computeCommitSetForPack,
  computeObjectClosureForPack,
  findCommonHaves,
  resolveWants
} from "./git-upload-pack-negotiation";
import { RepositoryService } from "./repository-service";
import { StorageService } from "./storage-service";
import type { AuthUser, GitServiceName } from "../types";

type RefsArgs = {
  owner: string;
  repo: string;
  service: GitServiceName;
  user?: AuthUser;
};

type RepoAccessArgs = {
  owner: string;
  repo: string;
  user?: AuthUser;
};

type UploadPackArgs = RepoAccessArgs & {
  body: ArrayBuffer;
};

type ReceivePackArgs = RepoAccessArgs & {
  body: ArrayBuffer;
};

const MAX_DEEPEN = 10000;
const MAX_FILTER_BLOB_LIMIT = 50 * 1024 * 1024;

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function resolveHeadRef(
  refs: Array<{ name: string; oid: string }>,
  storedHead: string | null
): { headRef: string | null; headOid: string | null } {
  let headRef: string | null = null;
  if (storedHead?.startsWith("ref: ")) {
    const parsed = storedHead.slice("ref: ".length).trim();
    if (parsed.startsWith("refs/")) {
      headRef = parsed;
    }
  }

  if (!headRef) {
    const main = refs.find((item) => item.name === "refs/heads/main");
    headRef = main?.name ?? refs[0]?.name ?? null;
  }

  const headOid =
    (headRef && refs.find((item) => item.name === headRef)?.oid) ?? refs[0]?.oid ?? null;

  return { headRef, headOid };
}

function capabilityListFor(service: GitServiceName, headRef: string | null): string {
  if (service === "git-upload-pack") {
    const capabilities = [
      "multi_ack_detailed",
      "no-done",
      "side-band",
      "side-band-64k",
      "ofs-delta",
      "shallow",
      "filter",
      "agent=gits/0.1"
    ];
    if (headRef) {
      capabilities.unshift(`symref=HEAD:${headRef}`);
    }
    return capabilities.join(" ");
  }
  return "report-status side-band-64k delete-refs ofs-delta agent=gits/0.1";
}

type PackObjectFilter = {
  blobNone?: boolean;
  blobLimitBytes?: number;
};

function parsePackObjectFilter(filterSpec: string | undefined): PackObjectFilter | undefined {
  if (!filterSpec) {
    return undefined;
  }
  if (filterSpec === "blob:none") {
    return { blobNone: true };
  }
  if (filterSpec.startsWith("blob:limit=")) {
    const value = Number.parseInt(filterSpec.slice("blob:limit=".length), 10);
    if (!Number.isFinite(value) || Number.isNaN(value) || value < 0) {
      throw new ProtocolError("invalid blob:limit filter");
    }
    if (value > MAX_FILTER_BLOB_LIMIT) {
      throw new ProtocolError(`blob:limit exceeds maximum (${MAX_FILTER_BLOB_LIMIT})`);
    }
    return {
      blobLimitBytes: value
    };
  }
  throw new UnsupportedFeatureError("filter");
}

type MutableFs = {
  promises: {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    writeFile(path: string, data: Uint8Array | string): Promise<void>;
    readFile(path: string, options?: unknown): Promise<Uint8Array | string>;
    readdir(path: string): Promise<string[]>;
    lstat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>;
    rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>;
  };
};

export class GitService {
  constructor(
    private readonly repositories: RepositoryService,
    private readonly storage: StorageService
  ) {}

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
    const repo = await this.repositories.findRepository(args.owner, args.repo);
    if (!repo) {
      throw new HTTPException(404, { message: "Repository not found" });
    }

    const canRead = await this.repositories.canReadRepository(repo, args.user?.id);
    if (!canRead) {
      if (!args.user && repo.is_private !== 0) {
        this.throwGitAuthChallenge("Authentication required");
      }
      throw new HTTPException(404, { message: "Repository not found" });
    }

    if (write) {
      const canWrite = await this.repositories.canWriteRepository(repo, args.user?.id);
      if (!canWrite) {
        throw new HTTPException(403, { message: "Forbidden" });
      }
    }

    return repo;
  }

  private uploadPackResponse(payload: Uint8Array, status = 200): Response {
    const body = new Uint8Array(payload.byteLength);
    body.set(payload);
    return new Response(body.buffer, {
      status,
      headers: {
        "Content-Type": "application/x-git-upload-pack-result",
        "Cache-Control": "no-store"
      }
    });
  }

  private receivePackResponse(payload: Uint8Array, status = 200): Response {
    const body = new Uint8Array(payload.byteLength);
    body.set(payload);
    return new Response(body.buffer, {
      status,
      headers: {
        "Content-Type": "application/x-git-receive-pack-result",
        "Cache-Control": "no-store"
      }
    });
  }

  private async listFilesRecursive(fs: MutableFs, root: string): Promise<string[]> {
    let names: string[] = [];
    try {
      names = await fs.promises.readdir(root);
    } catch {
      return [];
    }

    const files: string[] = [];
    for (const name of names) {
      const fullPath = `${root}/${name}`;
      let stats: { isDirectory(): boolean; isFile(): boolean };
      try {
        stats = await fs.promises.lstat(fullPath);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        files.push(...(await this.listFilesRecursive(fs, fullPath)));
      } else if (stats.isFile()) {
        files.push(fullPath);
      }
    }
    return files;
  }

  private async ensureHeadAfterReceivePack(args: {
    fs: MutableFs;
    gitdir: string;
  }): Promise<void> {
    const refsRoot = `${args.gitdir}/refs/heads`;
    const files = await this.listFilesRecursive(args.fs, refsRoot);
    const branchRefs = files
      .map((file) => file.slice(args.gitdir.length + 1))
      .map((name) => name.replace(/^refs\/heads\//, "refs/heads/"))
      .sort();

    let currentHead: string | null = null;
    try {
      const headFile = await args.fs.promises.readFile(`${args.gitdir}/HEAD`, "utf8");
      const headText = typeof headFile === "string" ? headFile : new TextDecoder().decode(headFile);
      if (headText.startsWith("ref: ")) {
        currentHead = headText.slice("ref: ".length).trim();
      }
    } catch {
      currentHead = null;
    }

    if (currentHead && branchRefs.includes(currentHead)) {
      return;
    }

    const nextHead =
      (branchRefs.includes("refs/heads/main") ? "refs/heads/main" : branchRefs[0]) ??
      "refs/heads/main";
    await args.fs.promises.writeFile(`${args.gitdir}/HEAD`, `ref: ${nextHead}\n`);
  }

  async handleInfoRefs(args: RefsArgs): Promise<Response> {
    await this.resolveRepo(args, args.service === "git-receive-pack");

    const refs = await this.storage.listRefs(args.owner, args.repo, "refs/");
    const storedHead = await this.storage.readHead(args.owner, args.repo);
    const { headRef, headOid } = resolveHeadRef(refs, storedHead);
    const capabilities = capabilityListFor(args.service, headRef);
    const advertisedRefs =
      headOid !== null
        ? [{ name: "HEAD", oid: headOid }, ...refs]
        : refs;
    const chunks: Uint8Array[] = [
      encodeTextPktLine(`# service=${args.service}\n`),
      encodeFlushPktLine()
    ];

    if (advertisedRefs.length === 0) {
      chunks.push(
        encodeTextPktLine(
          `0000000000000000000000000000000000000000 capabilities^{}\0${capabilities}\n`
        )
      );
      chunks.push(encodeFlushPktLine());
    } else {
      advertisedRefs.forEach((ref, index) => {
        const suffix = index === 0 ? `\0${capabilities}` : "";
        chunks.push(encodeTextPktLine(`${ref.oid} ${ref.name}${suffix}\n`));
      });
      chunks.push(encodeFlushPktLine());
    }

    const payload = concatChunks(chunks);
    const body = new Uint8Array(payload.byteLength);
    body.set(payload);
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": `application/x-${args.service}-advertisement`,
        "Cache-Control": "no-store"
      }
    });
  }

  async handleUploadPack(args: UploadPackArgs): Promise<Response> {
    await this.resolveRepo(args, false);

    let capabilities: Set<string> | undefined;
    try {
      const request = parseUploadPackRequest(args.body);
      capabilities = request.capabilities;
      const packFilter = parsePackObjectFilter(request.filterSpec);
      if (request.deepen !== undefined && request.deepen > MAX_DEEPEN) {
        throw new ProtocolError(`deepen exceeds maximum (${MAX_DEEPEN})`);
      }

      const loaded = await loadRepositoryFromStorage(this.storage, args.owner, args.repo);
      const cache: Record<string, unknown> = {};
      const resolvedWants = await resolveWants({
        fs: loaded.fs,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        wants: request.wants,
        cache
      });
      const common = await findCommonHaves({
        fs: loaded.fs,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        wantCommits: resolvedWants.commitWants,
        haves: request.haves,
        cache
      });
      const supportsNoDone =
        request.capabilities.has("no-done") && request.capabilities.has("multi_ack_detailed");

      if (!request.done && (!supportsNoDone || common.length === 0)) {
        const negotiationPayload = buildUploadPackNegotiationResponse(common);
        return this.uploadPackResponse(negotiationPayload);
      }

      const commitSelection = await computeCommitSetForPack({
        fs: loaded.fs,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        wantCommits: resolvedWants.commitWants,
        commonOids: common,
        ...(request.deepen !== undefined ? { deepen: request.deepen } : {}),
        ...(request.deepenSince !== undefined ? { deepenSince: request.deepenSince } : {}),
        ...(request.deepenNot.length > 0 ? { deepenNot: request.deepenNot } : {}),
        cache
      });
      const packObjectOids = await computeObjectClosureForPack({
        fs: loaded.fs,
        dir: loaded.dir,
        gitdir: loaded.gitdir,
        commitOids: commitSelection.commitOids,
        extraOids: resolvedWants.extraObjectWants,
        ...(packFilter ? { filter: packFilter } : {}),
        cache
      });

      let packfile: Uint8Array | undefined;
      try {
        const pack = await git.packObjects({
          fs: loaded.fs as never,
          dir: loaded.dir,
          gitdir: loaded.gitdir,
          oids: packObjectOids,
          write: false,
          cache
        });
        packfile = pack.packfile;
      } catch {
        throw new ProtocolError("failed to create packfile");
      }
      if (!packfile) {
        throw new ProtocolError("Unable to produce packfile");
      }

      const payload = buildUploadPackResponse({
        capabilities: request.capabilities,
        ...(supportsNoDone && !request.done && common.length > 0
          ? {
              ackLines: [
                ...common.map((oid) => `ACK ${oid} common\n`),
                `ACK ${common.at(-1)} ready\n`,
                "NAK\n",
                `ACK ${common.at(-1)}\n`
              ]
            }
          : {}),
        ackOids: common,
        shallowOids: commitSelection.shallowOids,
        packfile,
        progressMessages: [`counting objects: ${packObjectOids.length}\n`, "pack complete\n"]
      });
      return this.uploadPackResponse(payload);
    } catch (error) {
      if (error instanceof ProtocolError) {
        const payload = encodeProtocolError(error.message, capabilities);
        return this.uploadPackResponse(payload);
      }
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(500, { message: "upload-pack failed" });
    }
  }

  async handleReceivePack(args: ReceivePackArgs): Promise<Response> {
    await this.resolveRepo(args, true);

    let capabilities: Set<string> | undefined;
    try {
      const request = parseReceivePackRequest(args.body);
      capabilities = request.capabilities;
      const loaded = await loadRepositoryFromStorage(this.storage, args.owner, args.repo);
      const fs = loaded.fs as MutableFs;

      const hasWriteCommand = request.commands.some((command) => !isZeroOid(command.newOid));
      if (hasWriteCommand) {
        if (!request.packfile || request.packfile.byteLength === 0) {
          throw new ProtocolError("missing packfile");
        }
        const packDir = `${loaded.gitdir}/objects/pack`;
        const packFilename = `pack-${crypto.randomUUID().replaceAll("-", "")}.pack`;
        const packPath = `${packDir}/${packFilename}`;
        const relativeGitdir = loaded.gitdir.startsWith(`${loaded.dir}/`)
          ? loaded.gitdir.slice(loaded.dir.length + 1)
          : ".git";
        const packFilepath = `${relativeGitdir}/objects/pack/${packFilename}`;

        await fs.promises.mkdir(packDir, { recursive: true });
        await fs.promises.writeFile(packPath, request.packfile);

        try {
          await git.indexPack({
            fs: loaded.fs as never,
            dir: loaded.dir,
            gitdir: loaded.gitdir,
            filepath: packFilepath
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : "unpack failed";
          const payload = buildReceivePackReport({
            capabilities: request.capabilities,
            unpackError: "error unpacking objects",
            refStatuses: request.commands.map((command) => ({
              refName: command.refName,
              ok: false,
              message: reason
            }))
          });
          return this.receivePackResponse(payload);
        }
      }

      const refStatuses: Array<{ refName: string; ok: boolean; message?: string }> = [];
      const seenRefs = new Set<string>();
      for (const command of request.commands) {
        if (seenRefs.has(command.refName)) {
          refStatuses.push({
            refName: command.refName,
            ok: false,
            message: "duplicate command"
          });
          continue;
        }
        seenRefs.add(command.refName);

        if (
          !command.refName.startsWith("refs/heads/") &&
          !command.refName.startsWith("refs/tags/")
        ) {
          refStatuses.push({
            refName: command.refName,
            ok: false,
            message: "ref not allowed"
          });
          continue;
        }

        let currentRefValue: string | null = null;
        try {
          currentRefValue = await git.resolveRef({
            fs: loaded.fs as never,
            dir: loaded.dir,
            gitdir: loaded.gitdir,
            ref: command.refName
          });
        } catch {
          currentRefValue = null;
        }

        const expectedRefValue = isZeroOid(command.oldOid) ? null : command.oldOid;
        if ((currentRefValue ?? null) !== expectedRefValue) {
          refStatuses.push({
            refName: command.refName,
            ok: false,
            message: "stale info"
          });
          continue;
        }

        if (!isZeroOid(command.newOid)) {
          try {
            const object = await git.readObject({
              fs: loaded.fs as never,
              dir: loaded.dir,
              gitdir: loaded.gitdir,
              oid: command.newOid
            });
            if (command.refName.startsWith("refs/heads/") && object.type !== "commit") {
              refStatuses.push({
                refName: command.refName,
                ok: false,
                message: "branch update must point to a commit"
              });
              continue;
            }
          } catch {
            refStatuses.push({
              refName: command.refName,
              ok: false,
              message: "missing object"
            });
            continue;
          }
        }

        refStatuses.push({
          refName: command.refName,
          ok: true
        });
      }

      if (refStatuses.some((status) => !status.ok)) {
        const payload = buildReceivePackReport({
          capabilities: request.capabilities,
          refStatuses
        });
        return this.receivePackResponse(payload);
      }

      for (const command of request.commands) {
        if (isZeroOid(command.newOid)) {
          await fs.promises.rm(`${loaded.gitdir}/${command.refName}`, { force: true });
          continue;
        }
        await git.writeRef({
          fs: loaded.fs as never,
          dir: loaded.dir,
          gitdir: loaded.gitdir,
          ref: command.refName,
          value: command.newOid,
          force: true
        });
      }

      await this.ensureHeadAfterReceivePack({
        fs,
        gitdir: loaded.gitdir
      });
      await persistRepositoryToStorage({
        storage: this.storage,
        fs,
        gitdir: loaded.gitdir,
        owner: args.owner,
        repo: args.repo
      });

      const payload = buildReceivePackReport({
        capabilities: request.capabilities,
        refStatuses
      });
      return this.receivePackResponse(payload);
    } catch (error) {
      if (error instanceof ProtocolError) {
        const payload = buildReceivePackReport({
          capabilities: capabilities ?? ["report-status"],
          unpackError: error.message,
          refStatuses: []
        });
        return this.receivePackResponse(payload);
      }
      if (error instanceof HTTPException) {
        throw error;
      }
      throw new HTTPException(500, { message: "receive-pack failed" });
    }
  }
}

import { describe, expect, it, vi } from "vitest";
import type { RepositoryRecord } from "../types";
import { GitService } from "./git-service";
import { RepositoryService } from "./repository-service";
import { StorageService } from "./storage-service";

const repoRecord: RepositoryRecord = {
  id: "repo-1",
  owner_id: "user-1",
  owner_username: "alice",
  name: "demo",
  description: "demo repo",
  is_private: 0,
  created_at: Date.now()
};

const MAIN_OID = "0123456789abcdef0123456789abcdef01234567";

function createService(options?: {
  repo?: RepositoryRecord | null;
  canRead?: boolean;
  canWrite?: boolean;
  refs?: Array<{ name: string; oid: string }>;
}) {
  const repoValue = options && "repo" in options ? options.repo : repoRecord;
  const repositoryService = {
    findRepository: vi.fn().mockResolvedValue(repoValue),
    canReadRepository: vi.fn().mockResolvedValue(options?.canRead ?? true),
    canWriteRepository: vi.fn().mockResolvedValue(options?.canWrite ?? true)
  } as unknown as RepositoryService;

  const storageService = {
    repoPrefix: vi.fn().mockImplementation((owner: string, repo: string) => `${owner}/${repo}`),
    listRefs: vi
      .fn()
      .mockResolvedValue(options?.refs ?? [{ name: "refs/heads/main", oid: MAIN_OID }]),
    listRepositoryKeys: vi.fn().mockResolvedValue([]),
    getBytes: vi.fn().mockResolvedValue(null),
    listHeadRefs: vi
      .fn()
      .mockResolvedValue(options?.refs ?? [{ name: "refs/heads/main", oid: MAIN_OID }]),
    readHead: vi.fn().mockResolvedValue("ref: refs/heads/main")
  } as unknown as StorageService;

  const service = new GitService(repositoryService, storageService);
  return {
    service,
    repositoryService: repositoryService as unknown as {
      findRepository: ReturnType<typeof vi.fn>;
      canReadRepository: ReturnType<typeof vi.fn>;
      canWriteRepository: ReturnType<typeof vi.fn>;
    },
    storageService: storageService as unknown as {
      listHeadRefs: ReturnType<typeof vi.fn>;
      readHead: ReturnType<typeof vi.fn>;
    }
  };
}

describe("GitService", () => {
  it("returns smart-http advertisement for info/refs", async () => {
    const { service } = createService();
    const response = await service.handleInfoRefs({
      owner: "alice",
      repo: "demo",
      service: "git-upload-pack"
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/x-git-upload-pack-advertisement");
    const payload = new TextDecoder().decode(await response.arrayBuffer());
    expect(payload).toContain("# service=git-upload-pack");
    expect(payload).toContain(`${MAIN_OID} refs/heads/main`);
  });

  it("advertises capability line for empty refs", async () => {
    const { service } = createService({ refs: [] });
    const response = await service.handleInfoRefs({
      owner: "alice",
      repo: "empty",
      service: "git-upload-pack"
    });

    expect(response.status).toBe(200);
    const payload = new TextDecoder().decode(await response.arrayBuffer());
    expect(payload).toContain("capabilities^{}");
  });

  it("throws 404 when repository does not exist", async () => {
    const { service } = createService({ repo: null });
    await expect(
      service.handleUploadPack({
        owner: "alice",
        repo: "missing",
        body: new TextEncoder().encode("0000").buffer
      })
    ).rejects.toHaveProperty("status", 404);
  });

  it("returns protocol ERR response for malformed upload-pack request", async () => {
    const { service } = createService();
    const response = await service.handleUploadPack({
      owner: "alice",
      repo: "demo",
      body: new TextEncoder().encode("0000").buffer
    });
    expect(response.status).toBe(200);
    const text = new TextDecoder().decode(await response.arrayBuffer());
    expect(text).toContain("ERR No want lines found");
  });

  it("throws 403 when user has no write permission", async () => {
    const { service } = createService({ canRead: true, canWrite: false });
    await expect(
      service.handleReceivePack({
        owner: "alice",
        repo: "demo",
        body: new TextEncoder().encode("0000").buffer,
        user: { id: "u2", username: "bob" }
      })
    ).rejects.toHaveProperty("status", 403);
  });
});

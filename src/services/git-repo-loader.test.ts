import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import {
  persistRepositoryToStorage,
  type MutableGitFs,
  type RepositorySnapshotStorage
} from "./git-repo-loader";
import { StorageService } from "./storage-service";

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "/" : path.slice(0, idx);
}

async function writeFileRecursive(
  fs: MutableGitFs,
  path: string,
  data: Uint8Array | string
): Promise<void> {
  await fs.promises.mkdir(dirname(path), { recursive: true });
  await fs.promises.writeFile(path, data);
}

function toUint8Array(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error("Expected binary value");
}

describe("persistRepositoryToStorage", () => {
  it("persists only explicit mutations without scanning stored keys", async () => {
    const volume = new Volume();
    const fs = createFsFromVolume(volume) as unknown as MutableGitFs;
    const gitdir = "/repo/.git";
    await fs.promises.mkdir(gitdir, { recursive: true });

    await writeFileRecursive(fs, `${gitdir}/HEAD`, "ref: refs/heads/main\n");
    await writeFileRecursive(
      fs,
      `${gitdir}/refs/heads/main`,
      "0123456789abcdef0123456789abcdef01234567\n"
    );
    await writeFileRecursive(fs, `${gitdir}/objects/pack/pack-demo.pack`, new Uint8Array([1, 2, 3]));
    await writeFileRecursive(fs, `${gitdir}/objects/pack/pack-demo.idx`, new Uint8Array([4, 5, 6]));

    const storage = {
      repoPrefix: vi.fn().mockReturnValue("alice/demo"),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
      listRepositoryKeys: vi.fn()
    } as unknown as StorageService & {
      repoPrefix: ReturnType<typeof vi.fn>;
      put: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      listRepositoryKeys: ReturnType<typeof vi.fn>;
    };
    const snapshotStorage = {
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(true),
      list: vi.fn()
    } as unknown as RepositorySnapshotStorage & {
      put: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
      list: ReturnType<typeof vi.fn>;
    };

    await persistRepositoryToStorage({
      storage,
      fs,
      gitdir,
      owner: "alice",
      repo: "demo",
      snapshotStorage,
      changedPaths: [
        "HEAD",
        "refs/heads/main",
        "objects/pack/pack-demo.pack",
        "objects/pack/pack-demo.idx"
      ],
      deletedPaths: ["refs/heads/old"]
    });

    expect(storage.listRepositoryKeys).not.toHaveBeenCalled();
    expect(snapshotStorage.list).not.toHaveBeenCalled();

    const storagePutEntries = new Map(
      storage.put.mock.calls.map(([key, value]: [string, unknown]) => [key, toUint8Array(value)])
    );
    expect([...storagePutEntries.keys()].sort()).toEqual([
      "alice/demo/HEAD",
      "alice/demo/objects/pack/pack-demo.idx",
      "alice/demo/objects/pack/pack-demo.pack",
      "alice/demo/refs/heads/main"
    ]);
    expect(new TextDecoder().decode(storagePutEntries.get("alice/demo/HEAD"))).toBe(
      "ref: refs/heads/main\n"
    );
    expect(storage.delete).toHaveBeenCalledWith("alice/demo/refs/heads/old");

    const snapshotPutEntries = new Map(
      snapshotStorage.put.mock.calls.map(([key, value]: [string, unknown]) => [key, value])
    );
    expect([...snapshotPutEntries.keys()].sort()).toEqual([
      "repository-snapshot/files/HEAD",
      "repository-snapshot/files/objects/pack/pack-demo.idx",
      "repository-snapshot/files/objects/pack/pack-demo.pack",
      "repository-snapshot/files/refs/heads/main",
      "repository-snapshot/meta"
    ]);
    expect(snapshotStorage.delete).toHaveBeenCalledWith("repository-snapshot/files/refs/heads/old");
  });
});

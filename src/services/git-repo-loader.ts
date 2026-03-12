import { Volume, createFsFromVolume } from "memfs";
import { StorageService } from "./storage-service";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const SNAPSHOT_VERSION = 1;
const SNAPSHOT_META_KEY = "repository-snapshot/meta";
const SNAPSHOT_FILE_PREFIX = "repository-snapshot/files/";

export type MutableGitFs = {
  promises: {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    writeFile(path: string, data: Uint8Array | string): Promise<void>;
    readFile(path: string, options?: unknown): Promise<Uint8Array | string>;
    readdir(path: string): Promise<string[]>;
    lstat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>;
    rm(path: string, options?: { force?: boolean; recursive?: boolean }): Promise<void>;
  };
};

export type LoadedRepository = {
  fs: unknown;
  dir: string;
  gitdir: string;
  head: string | null;
  headRefs: Array<{ name: string; oid: string }>;
};

export type RepositorySnapshotStorage = {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
};

type RepositorySnapshotMeta = {
  version: number;
};

type RepositoryMutationPaths = {
  changedPaths: string[];
  deletedPaths: string[];
};

function dirname(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) {
    return "/";
  }
  return path.slice(0, idx);
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function normalizeGitRelativePath(path: string): string | null {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized.length > 0 ? normalized : null;
}

function resolveRepositoryMutationPaths(args: {
  changedPaths?: string[];
  deletedPaths?: string[];
}): RepositoryMutationPaths {
  const changedPathSet = new Set<string>();
  for (const path of args.changedPaths ?? []) {
    const normalized = normalizeGitRelativePath(path);
    if (normalized) {
      changedPathSet.add(normalized);
    }
  }

  const deletedPathSet = new Set<string>();
  for (const path of args.deletedPaths ?? []) {
    const normalized = normalizeGitRelativePath(path);
    if (normalized && !changedPathSet.has(normalized)) {
      deletedPathSet.add(normalized);
    }
  }

  return {
    changedPaths: [...changedPathSet],
    deletedPaths: [...deletedPathSet]
  };
}

async function writeFileRecursive(
  fs: MutableGitFs,
  path: string,
  data: Uint8Array | string
): Promise<void> {
  await fs.promises.mkdir(dirname(path), { recursive: true });
  await fs.promises.writeFile(path, data);
}

async function listFilesRecursive(fs: MutableGitFs, root: string): Promise<string[]> {
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
      files.push(...(await listFilesRecursive(fs, fullPath)));
    } else if (stats.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function readTextFile(fs: MutableGitFs, path: string): Promise<string | null> {
  try {
    const content = await fs.promises.readFile(path, "utf8");
    return typeof content === "string" ? content : textDecoder.decode(content);
  } catch {
    return null;
  }
}

function createLoadedRepositoryFs(): {
  fs: MutableGitFs;
  dir: string;
  gitdir: string;
} {
  const volume = new Volume();
  const fs = createFsFromVolume(volume) as unknown as MutableGitFs;
  const dir = "/repo";
  const gitdir = "/repo/.git";
  return { fs, dir, gitdir };
}

function toUint8Array(value: string | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (typeof value === "string") {
    return textEncoder.encode(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

async function readFileBytes(fs: MutableGitFs, path: string): Promise<Uint8Array> {
  const content = await fs.promises.readFile(path);
  return toUint8Array(content);
}

async function persistRepositoryMutations(args: {
  fs: MutableGitFs;
  gitdir: string;
  changedPaths: string[];
  deletedPaths: string[];
  putFile: (relativePath: string, content: Uint8Array) => Promise<void>;
  deleteFile: (relativePath: string) => Promise<void>;
}): Promise<void> {
  for (const relativePath of args.changedPaths) {
    const content = await readFileBytes(args.fs, `${args.gitdir}/${relativePath}`);
    await args.putFile(relativePath, content);
  }

  for (const relativePath of args.deletedPaths) {
    await args.deleteFile(relativePath);
  }
}

function snapshotFileKey(relativePath: string): string {
  return `${SNAPSHOT_FILE_PREFIX}${relativePath.replaceAll("\\", "/")}`;
}

function normalizeSnapshotEntry(value: unknown): Uint8Array | null {
  if (typeof value === "string") {
    return textEncoder.encode(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

async function initializeGitdir(fs: MutableGitFs, gitdir: string): Promise<void> {
  await fs.promises.mkdir(gitdir, { recursive: true });
  await fs.promises.mkdir(`${gitdir}/objects`, { recursive: true });
  await fs.promises.mkdir(`${gitdir}/refs/heads`, { recursive: true });
}

async function loadRepositoryFromSnapshot(
  snapshotStorage: RepositorySnapshotStorage
): Promise<LoadedRepository | null> {
  const meta = await snapshotStorage.get<RepositorySnapshotMeta>(SNAPSHOT_META_KEY);
  if (!meta) {
    return null;
  }
  if (meta.version !== SNAPSHOT_VERSION) {
    await clearRepositorySnapshot(snapshotStorage);
    return null;
  }

  const entries = await snapshotStorage.list<unknown>({ prefix: SNAPSHOT_FILE_PREFIX });
  if (entries.size === 0) {
    return null;
  }

  const { fs, dir, gitdir } = createLoadedRepositoryFs();
  await initializeGitdir(fs, gitdir);

  for (const [key, value] of [...entries.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const relative = key.startsWith(SNAPSHOT_FILE_PREFIX)
      ? key.slice(SNAPSHOT_FILE_PREFIX.length)
      : key;
    if (!relative) {
      continue;
    }
    const bytes = normalizeSnapshotEntry(value);
    if (!bytes) {
      continue;
    }
    await writeFileRecursive(fs, `${gitdir}/${relative}`, bytes);
  }

  return syncLoadedRepositoryHeadState({
    fs,
    dir,
    gitdir,
    head: null,
    headRefs: []
  });
}

export async function listRepositoryRefsFromFs(args: {
  fs: MutableGitFs;
  gitdir: string;
  prefix?: string;
}): Promise<Array<{ name: string; oid: string }>> {
  const normalizedPrefix = (args.prefix ?? "refs/")
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");
  const rootPath = `${args.gitdir}/${normalizedPrefix}`;
  const files = await listFilesRecursive(args.fs, rootPath);
  const refs: Array<{ name: string; oid: string }> = [];

  for (const file of files) {
    const content = await readTextFile(args.fs, file);
    const oid = content?.trim() ?? null;
    if (!oid || !/^[0-9a-f]{40}$/i.test(oid)) {
      continue;
    }

    refs.push({
      name: file.slice(args.gitdir.length + 1).replaceAll("\\", "/"),
      oid: oid.toLowerCase()
    });
  }

  refs.sort((left, right) => left.name.localeCompare(right.name));
  return refs;
}

export async function syncLoadedRepositoryHeadState(
  loaded: LoadedRepository
): Promise<LoadedRepository> {
  const fs = loaded.fs as MutableGitFs;
  const headRaw = await readTextFile(fs, `${loaded.gitdir}/HEAD`);
  loaded.head = headRaw?.trim() ?? null;
  loaded.headRefs = await listRepositoryRefsFromFs({
    fs,
    gitdir: loaded.gitdir,
    prefix: "refs/heads"
  });
  return loaded;
}

export async function loadRepositoryFromStorage(
  storage: StorageService,
  owner: string,
  repo: string,
  snapshotStorage?: RepositorySnapshotStorage
): Promise<LoadedRepository> {
  if (snapshotStorage) {
    const snapshotLoaded = await loadRepositoryFromSnapshot(snapshotStorage);
    if (snapshotLoaded) {
      return snapshotLoaded;
    }
  }

  const { fs, dir, gitdir } = createLoadedRepositoryFs();
  await initializeGitdir(fs, gitdir);

  const repoPrefix = `${storage.repoPrefix(owner, repo)}/`;
  const repoKeys = await storage.listRepositoryKeys(owner, repo);
  for (const key of repoKeys) {
    const relative = key.startsWith(repoPrefix) ? key.slice(repoPrefix.length) : key;
    if (!relative) {
      continue;
    }
    const bytes = await storage.getBytes(key);
    if (!bytes) {
      continue;
    }
    await writeFileRecursive(fs, `${gitdir}/${relative}`, new Uint8Array(bytes));
  }

  const headRefs = await storage.listHeadRefs(owner, repo);

  const storedHead = await storage.readHead(owner, repo);
  let effectiveHead = storedHead;
  if (!effectiveHead) {
    const main = headRefs.find((item) => item.name === "refs/heads/main");
    if (main) {
      effectiveHead = "ref: refs/heads/main";
    } else if (headRefs[0]) {
      effectiveHead = `ref: ${headRefs[0].name}`;
    }
  }
  if (effectiveHead) {
    await writeFileRecursive(fs, `${gitdir}/HEAD`, ensureTrailingNewline(effectiveHead));
  }

  const loaded = await syncLoadedRepositoryHeadState({
    fs,
    dir,
    gitdir,
    head: effectiveHead ?? null,
    headRefs
  });
  if (snapshotStorage) {
    await persistRepositorySnapshot({
      snapshotStorage,
      fs,
      gitdir
    });
  }
  return loaded;
}

export async function clearRepositorySnapshot(
  snapshotStorage: RepositorySnapshotStorage
): Promise<void> {
  const keys = await snapshotStorage.list<unknown>({ prefix: SNAPSHOT_FILE_PREFIX });
  for (const key of keys.keys()) {
    await snapshotStorage.delete(key);
  }
  await snapshotStorage.delete(SNAPSHOT_META_KEY);
}

export async function persistRepositorySnapshot(args: {
  snapshotStorage: RepositorySnapshotStorage;
  fs: MutableGitFs;
  gitdir: string;
  changedPaths?: string[];
  deletedPaths?: string[];
}): Promise<void> {
  if (args.changedPaths !== undefined || args.deletedPaths !== undefined) {
    const mutationPaths = resolveRepositoryMutationPaths(args);
    await persistRepositoryMutations({
      fs: args.fs,
      gitdir: args.gitdir,
      changedPaths: mutationPaths.changedPaths,
      deletedPaths: mutationPaths.deletedPaths,
      putFile: async (relativePath, content) => {
        await args.snapshotStorage.put(snapshotFileKey(relativePath), content);
      },
      deleteFile: async (relativePath) => {
        await args.snapshotStorage.delete(snapshotFileKey(relativePath));
      }
    });

    await args.snapshotStorage.put(SNAPSHOT_META_KEY, {
      version: SNAPSHOT_VERSION
    } satisfies RepositorySnapshotMeta);
    return;
  }

  const files = await listFilesRecursive(args.fs, args.gitdir);
  const desiredKeys = new Set<string>();

  for (const file of files) {
    const relative = file.slice(args.gitdir.length + 1);
    const key = snapshotFileKey(relative);
    const content = await readFileBytes(args.fs, file);
    desiredKeys.add(key);
    await args.snapshotStorage.put(key, content);
  }

  const existing = await args.snapshotStorage.list<unknown>({ prefix: SNAPSHOT_FILE_PREFIX });
  for (const key of existing.keys()) {
    if (!desiredKeys.has(key)) {
      await args.snapshotStorage.delete(key);
    }
  }

  await args.snapshotStorage.put(SNAPSHOT_META_KEY, {
    version: SNAPSHOT_VERSION
  } satisfies RepositorySnapshotMeta);
}

export async function persistRepositoryToStorage(args: {
  storage: StorageService;
  fs: MutableGitFs;
  gitdir: string;
  owner: string;
  repo: string;
  snapshotStorage?: RepositorySnapshotStorage;
  changedPaths?: string[];
  deletedPaths?: string[];
}): Promise<void> {
  if (args.changedPaths !== undefined || args.deletedPaths !== undefined) {
    const mutationPaths = resolveRepositoryMutationPaths(args);
    const prefix = `${args.storage.repoPrefix(args.owner, args.repo)}/`;
    await persistRepositoryMutations({
      fs: args.fs,
      gitdir: args.gitdir,
      changedPaths: mutationPaths.changedPaths,
      deletedPaths: mutationPaths.deletedPaths,
      putFile: async (relativePath, content) => {
        await args.storage.put(`${prefix}${relativePath}`, content);
      },
      deleteFile: async (relativePath) => {
        await args.storage.delete(`${prefix}${relativePath}`);
      }
    });

    if (args.snapshotStorage) {
      await persistRepositorySnapshot({
        snapshotStorage: args.snapshotStorage,
        fs: args.fs,
        gitdir: args.gitdir,
        changedPaths: mutationPaths.changedPaths,
        deletedPaths: mutationPaths.deletedPaths
      });
    }
    return;
  }

  const files = await listFilesRecursive(args.fs, args.gitdir);
  const prefix = `${args.storage.repoPrefix(args.owner, args.repo)}/`;
  const desiredKeys = new Set<string>();

  for (const file of files) {
    const relative = file.slice(args.gitdir.length + 1);
    const key = `${prefix}${relative}`;
    const content = await readFileBytes(args.fs, file);
    desiredKeys.add(key);
    await args.storage.put(key, content);
  }

  const existing = await args.storage.listRepositoryKeys(args.owner, args.repo);
  for (const key of existing) {
    if (!desiredKeys.has(key)) {
      await args.storage.delete(key);
    }
  }

  if (args.snapshotStorage) {
    await persistRepositorySnapshot({
      snapshotStorage: args.snapshotStorage,
      fs: args.fs,
      gitdir: args.gitdir
    });
  }
}

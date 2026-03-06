import { Volume, createFsFromVolume } from "memfs";
import { StorageService } from "./storage-service";

export type MutableGitFs = {
  promises: {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    writeFile(path: string, data: Uint8Array | string): Promise<void>;
    readFile(path: string, options?: unknown): Promise<Uint8Array | string>;
    readdir(path: string): Promise<string[]>;
    lstat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>;
  };
};

export type LoadedRepository = {
  fs: unknown;
  dir: string;
  gitdir: string;
  head: string | null;
  headRefs: Array<{ name: string; oid: string }>;
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

export async function loadRepositoryFromStorage(
  storage: StorageService,
  owner: string,
  repo: string
): Promise<LoadedRepository> {
  const volume = new Volume();
  const fs = createFsFromVolume(volume) as unknown as MutableGitFs;
  const dir = "/repo";
  const gitdir = "/repo/.git";

  await fs.promises.mkdir(gitdir, { recursive: true });
  await fs.promises.mkdir(`${gitdir}/objects`, { recursive: true });
  await fs.promises.mkdir(`${gitdir}/refs/heads`, { recursive: true });

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

  return {
    fs,
    dir,
    gitdir,
    head: effectiveHead ?? null,
    headRefs
  };
}

export async function persistRepositoryToStorage(args: {
  storage: StorageService;
  fs: MutableGitFs;
  gitdir: string;
  owner: string;
  repo: string;
}): Promise<void> {
  const files = await listFilesRecursive(args.fs, args.gitdir);
  const prefix = `${args.storage.repoPrefix(args.owner, args.repo)}/`;
  const desiredKeys = new Set<string>();

  for (const file of files) {
    const relative = file.slice(args.gitdir.length + 1);
    const key = `${prefix}${relative}`;
    const content = await args.fs.promises.readFile(file);
    desiredKeys.add(key);
    await args.storage.put(key, content as ArrayBufferView | string);
  }

  const existing = await args.storage.listRepositoryKeys(args.owner, args.repo);
  for (const key of existing) {
    if (!desiredKeys.has(key)) {
      await args.storage.delete(key);
    }
  }
}

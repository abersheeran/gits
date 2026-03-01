import { Volume, createFsFromVolume } from "memfs";
import { StorageService } from "./storage-service";

type MutableFs = {
  promises: {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    writeFile(path: string, data: Uint8Array | string): Promise<void>;
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
  fs: MutableFs,
  path: string,
  data: Uint8Array | string
): Promise<void> {
  await fs.promises.mkdir(dirname(path), { recursive: true });
  await fs.promises.writeFile(path, data);
}

export async function loadRepositoryFromStorage(
  storage: StorageService,
  owner: string,
  repo: string
): Promise<LoadedRepository> {
  const volume = new Volume();
  const fs = createFsFromVolume(volume) as unknown as MutableFs;
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

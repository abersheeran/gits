import * as git from "isomorphic-git";
import { Volume, createFsFromVolume } from "memfs";
import { MockR2Bucket } from "./mock-r2";

type FsLike = {
  promises: {
    mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
    writeFile(path: string, data: string | Uint8Array): Promise<void>;
    readFile(path: string): Promise<Uint8Array>;
    readdir(path: string): Promise<string[]>;
    stat(path: string): Promise<{ isDirectory(): boolean }>;
  };
};

async function listFilesRecursive(fs: FsLike, root: string): Promise<string[]> {
  const entries = await fs.promises.readdir(root);
  const files: string[] = [];
  for (const name of entries) {
    const fullPath = `${root}/${name}`;
    const stat = await fs.promises.stat(fullPath);
    if (stat.isDirectory()) {
      files.push(...(await listFilesRecursive(fs, fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function relativePath(base: string, fullPath: string): string {
  return fullPath.startsWith(`${base}/`) ? fullPath.slice(base.length + 1) : fullPath;
}

export async function seedSampleRepositoryToR2(
  bucket: MockR2Bucket,
  owner: string,
  repo: string
): Promise<{ latestCommit: string; initialCommit: string }> {
  const volume = new Volume();
  const fs = createFsFromVolume(volume) as unknown as FsLike;
  const dir = "/repo";
  const gitdir = "/repo/.git";

  await fs.promises.mkdir(dir, { recursive: true });
  await git.init({
    fs: fs as never,
    dir,
    defaultBranch: "main"
  });

  await fs.promises.writeFile(`${dir}/README.md`, "# Demo\n");
  await git.add({
    fs: fs as never,
    dir,
    filepath: "README.md"
  });
  const initialCommit = await git.commit({
    fs: fs as never,
    dir,
    message: "initial commit",
    author: {
      name: "alice",
      email: "alice@example.com"
    }
  });

  await fs.promises.mkdir(`${dir}/src`, { recursive: true });
  await fs.promises.writeFile(`${dir}/README.md`, "# Demo\n\nUpdated\n");
  await fs.promises.writeFile(`${dir}/src/app.txt`, "console.log('hello')\n");
  await git.add({
    fs: fs as never,
    dir,
    filepath: "README.md"
  });
  await git.add({
    fs: fs as never,
    dir,
    filepath: "src/app.txt"
  });
  const latestCommit = await git.commit({
    fs: fs as never,
    dir,
    message: "second commit",
    author: {
      name: "alice",
      email: "alice@example.com"
    }
  });

  await git.branch({
    fs: fs as never,
    dir,
    ref: "feature"
  });

  const objectFiles = await listFilesRecursive(fs, `${gitdir}/objects`);
  const refFiles = await listFilesRecursive(fs, `${gitdir}/refs/heads`);
  const extraFiles = [`${gitdir}/HEAD`];

  for (const path of [...objectFiles, ...refFiles, ...extraFiles]) {
    const body = await fs.promises.readFile(path);
    const relative = relativePath(gitdir, path);
    await bucket.put(`${owner}/${repo}/${relative}`, body);
  }

  return {
    latestCommit,
    initialCommit
  };
}

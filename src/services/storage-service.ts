function ensureValidOid(oid: string): string {
  if (!/^[0-9a-f]{40}$/i.test(oid)) {
    throw new Error(`Invalid oid: ${oid}`);
  }
  return oid.toLowerCase();
}

function trimSlash(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

export class StorageService {
  constructor(private readonly bucket: R2Bucket) {}

  repoPrefix(owner: string, repo: string): string {
    return `${trimSlash(owner)}/${trimSlash(repo)}`;
  }

  objectKey(owner: string, repo: string, oid: string): string {
    const value = ensureValidOid(oid);
    return `${this.repoPrefix(owner, repo)}/objects/${value.slice(0, 2)}/${value.slice(2)}`;
  }

  refKey(owner: string, repo: string, refName: string): string {
    return `${this.repoPrefix(owner, repo)}/${trimSlash(refName)}`;
  }

  headKey(owner: string, repo: string): string {
    return `${this.repoPrefix(owner, repo)}/HEAD`;
  }

  async getText(key: string): Promise<string | null> {
    const object = await this.bucket.get(key);
    return object ? object.text() : null;
  }

  async getBytes(key: string): Promise<ArrayBuffer | null> {
    const object = await this.bucket.get(key);
    return object ? object.arrayBuffer() : null;
  }

  async put(
    key: string,
    body: string | ArrayBuffer | ArrayBufferView | ReadableStream
  ): Promise<void> {
    await this.bucket.put(key, body);
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async list(prefix: string, cursor?: string): Promise<R2Objects> {
    if (cursor) {
      return this.bucket.list({ prefix, cursor });
    }
    return this.bucket.list({ prefix });
  }

  async readRef(owner: string, repo: string, refName: string): Promise<string | null> {
    const refPath = this.refKey(owner, repo, refName);
    const value = await this.getText(refPath);
    return value?.trim() ?? null;
  }

  async readHead(owner: string, repo: string): Promise<string | null> {
    const value = await this.getText(this.headKey(owner, repo));
    return value?.trim() ?? null;
  }

  async writeRef(owner: string, repo: string, refName: string, oid: string): Promise<void> {
    const refPath = this.refKey(owner, repo, refName);
    await this.put(refPath, `${ensureValidOid(oid)}\n`);
  }

  async listHeadRefs(
    owner: string,
    repo: string
  ): Promise<Array<{ name: string; oid: string }>> {
    return this.listRefs(owner, repo, "refs/heads");
  }

  async listObjectKeys(owner: string, repo: string): Promise<string[]> {
    const prefix = `${this.repoPrefix(owner, repo)}/objects/`;
    const keys: string[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.list(prefix, cursor);
      for (const item of response.objects) {
        keys.push(item.key);
      }
      cursor = response.truncated ? response.cursor : undefined;
    } while (cursor);

    keys.sort();
    return keys;
  }

  async listRepositoryKeys(owner: string, repo: string): Promise<string[]> {
    const prefix = `${this.repoPrefix(owner, repo)}/`;
    const keys: string[] = [];
    let cursor: string | undefined;

    do {
      const response = await this.list(prefix, cursor);
      for (const item of response.objects) {
        keys.push(item.key);
      }
      cursor = response.truncated ? response.cursor : undefined;
    } while (cursor);

    keys.sort();
    return keys;
  }

  async listRefs(
    owner: string,
    repo: string,
    prefix = "refs/"
  ): Promise<Array<{ name: string; oid: string }>> {
    const refsPrefix = `${this.repoPrefix(owner, repo)}/${trimSlash(prefix)}/`;
    const refs: Array<{ name: string; oid: string }> = [];
    let cursor: string | undefined;

    do {
      const response = await this.list(refsPrefix, cursor);
      for (const object of response.objects) {
        const objectBody = await this.getText(object.key);
        if (!objectBody) {
          continue;
        }

        const oid = objectBody.trim();
        if (!/^[0-9a-f]{40}$/i.test(oid)) {
          continue;
        }

        refs.push({
          name: object.key.slice(this.repoPrefix(owner, repo).length + 1),
          oid: oid.toLowerCase()
        });
      }
      cursor = response.truncated ? response.cursor : undefined;
    } while (cursor);

    refs.sort((a, b) => a.name.localeCompare(b.name));
    return refs;
  }

  async writeHead(owner: string, repo: string, value: string): Promise<void> {
    await this.put(this.headKey(owner, repo), value.endsWith("\n") ? value : `${value}\n`);
  }

  async initializeRepository(owner: string, repo: string, defaultBranch = "main"): Promise<void> {
    await this.writeHead(owner, repo, `ref: refs/heads/${defaultBranch}`);
  }

  async deleteRepository(owner: string, repo: string): Promise<void> {
    const keys = await this.listRepositoryKeys(owner, repo);
    for (const key of keys) {
      await this.delete(key);
    }
  }

  async renameRepository(owner: string, fromRepo: string, toRepo: string): Promise<void> {
    if (fromRepo === toRepo) {
      return;
    }
    const targetKeys = await this.listRepositoryKeys(owner, toRepo);
    if (targetKeys.length > 0) {
      throw new Error("Target repository already has stored objects");
    }

    const sourceKeys = await this.listRepositoryKeys(owner, fromRepo);
    const sourcePrefix = `${this.repoPrefix(owner, fromRepo)}/`;
    const targetPrefix = `${this.repoPrefix(owner, toRepo)}/`;

    for (const key of sourceKeys) {
      const bytes = await this.getBytes(key);
      if (!bytes) {
        continue;
      }
      const suffix = key.startsWith(sourcePrefix) ? key.slice(sourcePrefix.length) : key;
      await this.put(`${targetPrefix}${suffix}`, bytes);
    }
    for (const key of sourceKeys) {
      await this.delete(key);
    }
  }
}

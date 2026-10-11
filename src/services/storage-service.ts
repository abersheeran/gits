function trimSlash(value: string): string {
  return value.replace(/^\/+|\/+$/g, "");
}

export class StorageService {
  constructor(private readonly bucket: R2Bucket) {
  }

  repoPrefix(owner: string, repo: string): string {
    return `${trimSlash(owner)}/${trimSlash(repo)}`;
  }

  async getText(key: string): Promise<string | null> {
    const object = await this.bucket.get(key);
    return object ? object.text() : null;
  }

  async getStream(key: string): Promise<ReadableStream<Uint8Array> | null> {
    const object = await this.bucket.get(key);
    return object ? object.body : null;
  }

  async list(prefix: string, cursor?: string): Promise<R2Objects> {
    return this.bucket.list({ prefix, ...(cursor ? { cursor } : {}) });
  }

  async readHead(owner: string, repo: string): Promise<string | null> {
    const value = await this.getText(`${this.repoPrefix(owner, repo)}/HEAD`);
    return value?.trim() ?? null;
  }

  async deleteRepository(owner: string, repo: string): Promise<void> {
    const prefix = `${this.repoPrefix(owner, repo)}/`;
    for (;;) {
      const page = await this.bucket.list({ prefix, limit: 1000 });
      const keys = page.objects.map((object) => object.key);
      if (keys.length) {
        await this.bucket.delete(keys);
      }
      if (!page.truncated) {
        return;
      }
    }
  }
}

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflate } from "pako";
import { createMockDurableObjectState } from "../../test-utils/mock-durable-object-state";
import { ObjectStore } from "./object-store";
import { packEntryHeader } from "./pack-writer";
import { ensureGitStoreSchema } from "./schema";

export function testStore() {
  const { storage } = createMockDurableObjectState();
  ensureGitStoreSchema(storage.sql);
  return { storage, store: new ObjectStore(storage.sql) };
}

export function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), "gits-store-"));
  const git = (args: string[], input?: Uint8Array | string) =>
    execFileSync("git", args, {
      cwd: dir,
      input,
      maxBuffer: 100 * 1024 * 1024,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_AUTHOR_NAME: "Tester",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Tester",
        GIT_COMMITTER_EMAIL: "test@example.com",
        GIT_AUTHOR_DATE: "2025-01-02T03:04:05+05:30",
        GIT_COMMITTER_DATE: "2025-01-02T03:04:05-07:00"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
  git(["init", "-b", "main"]);
  return {
    dir,
    git,
    write(path: string, data: string | Uint8Array) {
      writeFileSync(join(dir, path), data);
    },
    close() {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

export function allGitObjects(repo: ReturnType<typeof gitRepo>) {
  const batch = repo.git(["cat-file", "--batch-all-objects", "--batch"]);
  const objects: Array<{
    oid: string;
    type: string;
    content: Uint8Array;
  }> = [];
  let offset = 0;
  while (offset < batch.length) {
    const end = batch.indexOf(10, offset);
    const [oid, type, size] = batch.subarray(offset, end).toString().split(" ");
    offset = end + 1;
    objects.push({
      oid: oid!,
      type: type!,
      content: new Uint8Array(batch.subarray(offset, offset + Number(size)))
    });
    offset += Number(size) + 1;
  }
  return objects;
}

export async function* chunks(bytes: Uint8Array, size = 7919) {
  for (let offset = 0; offset < bytes.length; offset += size) {
    yield bytes.subarray(offset, offset + size);
  }
}

export function makePack(
  entries: Array<{
    type: number;
    content: Uint8Array;
    base?: Uint8Array;
  }>,
  version = 2
) {
  const header = Buffer.alloc(12);
  header.write("PACK");
  header.writeUInt32BE(version, 4);
  header.writeUInt32BE(entries.length, 8);
  const body = Buffer.concat([
    header,
    ...entries.flatMap((entry) => [
      packEntryHeader(entry.type, entry.content.length),
      entry.base ?? new Uint8Array(),
      deflate(entry.content)
    ])
  ]);
  return Buffer.concat([body, createHash("sha1").update(body).digest()]);
}

export function sizeVarint(size: number): number[] {
  const bytes: number[] = [];
  do {
    const byte = size % 128;
    size = Math.floor(size / 128);
    bytes.push(byte | (size ? 128 : 0));
  } while (size);
  return bytes;
}

export function insertDelta(sourceSize: number, target: Uint8Array): Uint8Array {
  const bytes = [...sizeVarint(sourceSize), ...sizeVarint(target.length)];
  for (let i = 0; i < target.length; i += 127) {
    bytes.push(Math.min(127, target.length - i), ...target.subarray(i, i + 127));
  }
  return Uint8Array.from(bytes);
}

import app from "../app";
import type { AppEnv } from "../types";
import { createMockD1Database } from "./mock-d1";
import { createMockRepositoryObjectNamespace } from "./mock-repository-object-namespace";

export function createEnv(db: D1Database, bucket: R2Bucket): AppEnv["Bindings"] {
  const env = {
    DB: db,
    GIT_BUCKET: bucket,
  } as AppEnv["Bindings"];
  env.REPOSITORY_OBJECTS = createMockRepositoryObjectNamespace(() => env);
  return env;
}

export function createPublicRepositoryDb(owner: string, repo: string): D1Database {
  return createMockD1Database([
    {
      when: "WHERE u.username = ? AND r.name = ?",
      first: (params) => {
        if (params[0] !== owner || params[1] !== repo) {
          return null;
        }
        return {
          id: "repo-1",
          owner_id: "user-1",
          owner_username: owner,
          name: repo,
          description: "demo repo",
          is_private: 0,
          created_at: Date.now()
        };
      }
    }
  ]);
}

export function createPrivateOwnedRepositoryDb(owner: string, repo: string): D1Database {
  return createMockD1Database([
    {
      when: "WHERE u.username = ? AND r.name = ?",
      first: (params) => {
        if (params[0] !== owner || params[1] !== repo) {
          return null;
        }
        return {
          id: "repo-private-1",
          owner_id: "user-1",
          owner_username: owner,
          name: repo,
          description: "private repo",
          is_private: 1,
          created_at: Date.now()
        };
      }
    }
  ]);
}

export function pktLine(payload: string): Uint8Array {
  const bytes = new TextEncoder().encode(payload);
  const total = bytes.length + 4;
  const out = new Uint8Array(total);
  out.set(new TextEncoder().encode(total.toString(16).padStart(4, "0")), 0);
  out.set(bytes, 4);
  return out;
}

export function concat(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function containsPackSignature(bytes: Uint8Array): boolean {
  for (let i = 0; i <= bytes.length - 4; i += 1) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x41 &&
      bytes[i + 2] === 0x43 &&
      bytes[i + 3] === 0x4b
    ) {
      return true;
    }
  }
  return false;
}

export function parsePktTextPrefix(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const header = new TextDecoder().decode(bytes.subarray(offset, offset + 4));
    if (!/^[0-9a-f]{4}$/i.test(header)) {
      break;
    }
    const length = Number.parseInt(header, 16);
    offset += 4;
    if (length === 0) {
      lines.push("FLUSH");
      continue;
    }
    const payloadLength = length - 4;
    if (payloadLength < 0 || offset + payloadLength > bytes.length) {
      break;
    }
    lines.push(new TextDecoder().decode(bytes.subarray(offset, offset + payloadLength)));
    offset += payloadLength;
  }
  return lines;
}

export async function collectRequestBody(
  body: AsyncIterableIterator<Uint8Array> | undefined
): Promise<Uint8Array | undefined> {
  if (!body) {
    return undefined;
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return concat(...chunks);
}

export function singleChunkBody(bytes: Uint8Array): AsyncIterableIterator<Uint8Array> {
  return (async function* generate() {
    if (bytes.byteLength > 0) {
      yield bytes;
    }
  })();
}

export function createIsomorphicGitHttpClient(env: AppEnv["Bindings"]) {
  return {
    request: async (request: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
      body?: AsyncIterableIterator<Uint8Array>;
    }) => {
      const requestBody = await collectRequestBody(request.body);
      const response = await app.fetch(
        new Request(request.url, {
          method: request.method ?? "GET",
          headers: request.headers ?? {},
          ...(requestBody ? { body: Uint8Array.from(requestBody) } : {})
        }),
        env
      );
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        url: request.url,
        method: request.method,
        statusCode: response.status,
        statusMessage: response.statusText,
        headers,
        body: singleChunkBody(bytes)
      };
    }
  };
}

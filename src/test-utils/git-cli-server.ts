import { execFile as execFileCallback } from "node:child_process";
import { once } from "node:events";
import { createServer, type IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { promisify } from "node:util";
import app from "../app";
import type { AppEnv } from "../types";

const execFile = promisify(execFileCallback);

export async function runGit(args: string[], cwd: string): Promise<string> {
  const result = await execFile("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null"
    },
    maxBuffer: 20 * 1024 * 1024
  });
  return result.stdout;
}

export async function startAppServer(
  env: AppEnv["Bindings"],
  options: {
    onRequest?: (request: IncomingMessage) => void;
    onPack?: (count: number) => void;
  } = {}
) {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        options.onRequest?.(req);
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              headers.append(name, item);
            }
          } else if (value !== undefined) {
            headers.set(name, value);
          }
        }
        const hasBody = req.method !== "GET" && req.method !== "HEAD";
        const init = {
          method: req.method ?? "GET",
          headers,
          duplex: "half" as const,
          ...(hasBody ? { body: Readable.toWeb(req) as ReadableStream<Uint8Array> } : {})
        };
        const request = new Request(`http://${req.headers.host}${req.url}`, init);
        const response = await app.fetch(request, env);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => res.setHeader(key, value));
        const reader = response.body?.getReader();
        let prefix = Buffer.alloc(0);
        let found = false;
        try {
          while (reader) {
            const next = await reader.read();
            if (next.done) {
              break;
            }
            if (!found && req.url?.endsWith("/git-upload-pack")) {
              const bytes = Buffer.concat([prefix, next.value.subarray(0, 128)]);
              const index = bytes.indexOf("PACK");
              if (index >= 0 && bytes.length >= index + 12) {
                options.onPack?.(bytes.readUInt32BE(index + 8));
                found = true;
              }
              prefix = bytes.subarray(-11);
            }
            if (!res.write(next.value)) {
              await once(res, "drain");
            }
          }
          res.end();
        } finally {
          await reader?.cancel().catch(() => {
          });
          reader?.releaseLock();
        }
      } catch (error) {
        res.statusCode = 500;
        res.end(error instanceof Error ? error.message : "internal server error");
      }
    })();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test HTTP server");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

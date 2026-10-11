import { spawn } from "node:child_process";
import { createServer } from "node:http";

export async function startGitHttpBackend(root: string) {
  const server = createServer((request, response) => {
    const url = new URL(request.url!, "http://localhost");
    const child = spawn("git", ["http-backend"], {
      env: {
        ...process.env,
        GIT_PROJECT_ROOT: root,
        GIT_HTTP_EXPORT_ALL: "1",
        REQUEST_METHOD: request.method,
        PATH_INFO: decodeURIComponent(url.pathname),
        QUERY_STRING: url.search.slice(1),
        CONTENT_TYPE: request.headers["content-type"] ?? "",
        CONTENT_LENGTH: request.headers["content-length"] ?? "",
        SERVER_PROTOCOL: "HTTP/1.1",
        REMOTE_USER: "test"
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    request.pipe(child.stdin);
    child.stdin.on("error", () => undefined);
    let header = Buffer.alloc(0);
    let headersSent = false;
    child.stdout.on("data", (chunk: Buffer) => {
      if (!headersSent) {
        header = Buffer.concat([header, chunk]);
        const end = header.indexOf("\r\n\r\n");
        if (end === -1) {
          return;
        }
        for (const line of header.subarray(0, end).toString().split("\r\n")) {
          const separator = line.indexOf(":");
          const name = line.slice(0, separator);
          const value = line.slice(separator + 1).trim();
          if (name.toLowerCase() === "status") {
            response.statusCode = Number.parseInt(value, 10);
          } else {
            response.setHeader(name, value);
          }
        }
        headersSent = true;
        chunk = header.subarray(end + 4);
        header = Buffer.alloc(0);
      }
      if (!response.write(chunk)) {
        child.stdout.pause();
        response.once("drain", () => child.stdout.resume());
      }
    });
    child.stderr.resume();
    child.on("close", () => response.end());
    child.on("error", () => {
      response.statusCode = 500;
      response.end();
    });
    response.on("close", () => child.kill());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind git test server");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  };
}

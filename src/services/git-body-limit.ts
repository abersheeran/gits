import { HTTPException } from "hono/http-exception";
import { GitPackTooLargeError } from "./git-store/object-format";

export function bodyLimit(raw: string | undefined, fallback?: number): number | undefined {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function limitGitBody(request: Request, maxBytes: number | undefined) {
  const encoding = request.headers.get("content-encoding")?.trim().toLowerCase();
  if (encoding && encoding !== "gzip") {
    throw new HTTPException(415, { message: "Unsupported content encoding" });
  }
  const length = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (!encoding && maxBytes !== undefined && length > maxBytes) {
    throw new HTTPException(413, { message: "Request body too large" });
  }
  const raw = request.body ?? new Response("").body!;
  const body = encoding === "gzip" ? raw.pipeThrough(new DecompressionStream("gzip")) : raw;
  let received = 0;
  let exceeded = false;
  const stream =
    maxBytes === undefined
      ? body
      : body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              received += chunk.length;
              if (received > maxBytes) {
                exceeded = true;
                throw new GitPackTooLargeError(maxBytes);
              }
              controller.enqueue(chunk);
            }
          })
        );
  return { stream, exceeded: () => exceeded };
}

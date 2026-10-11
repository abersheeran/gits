import { ApiError } from "./api-error";

type ApiRequestInit = RequestInit & {
  bodyJson?: unknown;
};

async function parseErrorMessage(response: Response): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const json = (await response.clone().json()) as {
        message?: string;
        error?: { message?: string };
      } | null;
      if (json?.message && typeof json.message === "string") {
        return json.message;
      }
      if (json?.error?.message && typeof json.error.message === "string") {
        return json.error.message;
      }
    } catch {
      // fall back to text
    }
  }

  const text = await response.text();
  return text || response.statusText || "Request failed";
}

export async function requestJson<T>(path: string, init: ApiRequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  if (init.bodyJson !== undefined) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers,
    body: init.bodyJson !== undefined ? JSON.stringify(init.bodyJson) : init.body
  });

  if (!response.ok) {
    throw new ApiError(response.status, await parseErrorMessage(response));
  }

  return (await response.json()) as T;
}

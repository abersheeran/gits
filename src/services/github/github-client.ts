import type { GithubHttpOptions, GithubInstallation, GithubOwner } from "./types";

export type GithubErrorKind =
  | "unauthorized" | "forbidden" | "rate_limited" | "not_found" | "other"
  | "installation_deleted" | "installation_suspended";

export class GithubError extends Error {
  constructor(
    readonly kind: GithubErrorKind,
    message: string,
    readonly resetAt: number | null = null
  ) {
    super(message);
  }
}

export function safeError(error: unknown, token = ""): string {
  let message = error instanceof Error ? error.message : "GitHub operation failed";
  if (token) {
    message = message.split(token).join("[redacted]");
  }
  return message.replace(/(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, "[redacted]").slice(0, 1000);
}

export type GithubRepository = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  private: boolean;
  visibility?: string;
  fork: boolean;
  archived: boolean;
  size: number;
  default_branch: string | null;
  pushed_at: string | null;
};

export class GithubClient {
  private readonly fetcher: typeof fetch;
  private readonly base: string;

  constructor(
    private readonly token: string,
    options: GithubHttpOptions = {},
    private readonly onUnauthorized?: () => void
  ) {
    this.fetcher = options.fetch ?? fetch.bind(globalThis);
    this.base = options.apiBaseUrl ?? "https://api.github.com";
  }

  private async request(path: string, method = "GET", body?: unknown): Promise<Response> {
    const url = new URL(path, this.base);
    if (url.origin !== new URL(this.base).origin) {
      throw new GithubError("other", "Invalid GitHub pagination URL");
    }
    let response: Response;
    const fetcher = this.fetcher;
    try {
      response = await fetcher(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "gits",
          ...(body === undefined ? {} : { "Content-Type": "application/json" })
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "manual"
      });
    } catch {
      throw new GithubError("other", "Cannot reach GitHub");
    }
    if (response.ok) {
      return response;
    }
    await response.body?.cancel();
    if (response.status >= 300 && response.status < 400) {
      throw new GithubError("other", "GitHub 返回了重定向");
    }
    if (response.status === 401) {
      this.onUnauthorized?.();
      throw new GithubError("unauthorized", "GitHub authorization expired or was revoked");
    }
    const retry = response.headers.get("retry-after");
    if ([403, 429].includes(response.status) &&
      (response.headers.get("x-ratelimit-remaining") === "0" || retry !== null)) {
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
      const retryAt = retry === null ? 0 : /^\d+$/.test(retry)
        ? Date.now() + Number(retry) * 1000 : Date.parse(retry);
      throw new GithubError("rate_limited", "GitHub rate limit exceeded",
        Math.max(reset || 0, retryAt || 0, Date.now() + 1000));
    }
    if (response.status === 404) {
      throw new GithubError("not_found", "GitHub resource is not accessible");
    }
    if (response.status === 403) {
      throw new GithubError("forbidden", "GitHub access is forbidden");
    }
    throw new GithubError("other", `GitHub request failed (${response.status})`);
  }

  private async json<T>(response: Response): Promise<T> {
    try {
      return await response.json<T>();
    } catch {
      throw new GithubError("other", "Invalid GitHub JSON response");
    }
  }

  async get<T>(path: string): Promise<T> {
    return this.json<T>(await this.request(path));
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.json<T>(await this.request(path, "POST", body));
  }

  async list<T>(path: string, key: string): Promise<T[]> {
    let next: string | null = path + (path.includes("?") ? "&" : "?") + "per_page=100";
    const items: T[] = [];
    const visited = new Set<string>();
    while (next) {
      if (visited.has(next)) {
        throw new GithubError("other", "Repeated GitHub pagination URL");
      }
      visited.add(next);
      const response = await this.request(next);
      const payload = await this.json<Record<string, T[]>>(response);
      const page = payload[key];
      if (!Array.isArray(page)) {
        throw new GithubError("other", "Invalid GitHub list response");
      }
      for (const item of page) {
        items.push(item);
      }
      next = response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    }
    return items;
  }

  user(): Promise<GithubOwner> {
    return this.get("/user");
  }

  installations(): Promise<GithubInstallation[]> {
    return this.list("/user/installations", "installations");
  }

  repositories(): Promise<GithubRepository[]> {
    return this.list("/installation/repositories", "repositories");
  }
}

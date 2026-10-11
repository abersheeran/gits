import type { GithubHttpOptions } from "./types";

export type GithubErrorKind =
  | "unauthorized" | "sso_required" | "rate_limited" | "not_found" | "other";

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

export type GithubOwner = { id: number; login: string; avatar_url: string | null };
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

  constructor(private readonly token: string, options: GithubHttpOptions = {}) {
    this.fetcher = (options.fetch ?? fetch).bind(globalThis);
    this.base = options.apiBaseUrl ?? "https://api.github.com";
  }

  private async request(path: string): Promise<Response> {
    const url = new URL(path, this.base);
    if (url.origin !== new URL(this.base).origin) {
      throw new GithubError("other", "Invalid GitHub pagination URL");
    }
    let response: Response;
    try {
      response = await this.fetcher(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "gits"
        },
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
      throw new GithubError("unauthorized", "GitHub token is invalid or expired");
    }
    if (response.status === 403 && response.headers.has("X-GitHub-SSO")) {
      throw new GithubError("sso_required", "Authorize this token for organization SAML SSO");
    }
    const retry = response.headers.get("retry-after");
    if ([403, 429].includes(response.status) &&
      (response.headers.get("x-ratelimit-remaining") === "0" || retry !== null)) {
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
      const retryAt = retry === null ? 0 : /^\d+$/.test(retry)
        ? Date.now() + Number(retry) * 1000 : Date.parse(retry);
      const resetAt = Math.max(reset || 0, retryAt || 0, Date.now() + 1000);
      throw new GithubError("rate_limited", "GitHub rate limit exceeded", resetAt);
    }
    if (response.status === 404) {
      throw new GithubError("not_found", "GitHub owner or repository is not accessible");
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

  private async list<T>(path: string): Promise<T[]> {
    let next: string | null = path + (path.includes("?") ? "&" : "?") + "per_page=100";
    const items: T[] = [];
    const visited = new Set<string>();
    while (next) {
      if (visited.has(next)) {
        throw new GithubError("other", "Repeated GitHub pagination URL");
      }
      visited.add(next);
      const response = await this.request(next);
      const page = await this.json<T[]>(response);
      if (!Array.isArray(page)) {
        throw new GithubError("other", "Invalid GitHub repository list");
      }
      for (const item of page) {
        items.push(item);
      }
      next = response.headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ?? null;
    }
    return items;
  }

  async user() {
    const response = await this.request("/user");
    const user = await this.json<GithubOwner>(response);
    const scopes = (response.headers.get("X-OAuth-Scopes") ?? "")
      .split(",").map((scope) => scope.trim()).filter(Boolean);
    return { user, scopes };
  }

  async validateToken() {
    const result = await this.user();
    const tokenKind = this.token.startsWith("github_pat_") ? "fine_grained" : "classic";
    if (tokenKind === "classic") {
      const missing = [];
      if (!result.scopes.includes("repo")) {
        missing.push("repo");
      }
      if (!["read:org", "write:org", "admin:org"].some((s) => result.scopes.includes(s))) {
        missing.push("read:org");
      }
      if (missing.length) {
        throw new GithubError("other", `GitHub token is missing scopes: ${missing.join(", ")}`);
      }
    }
    return { ...result, tokenKind } as const;
  }

  organizations(): Promise<GithubOwner[]> {
    return this.list("/user/orgs");
  }

  async organization(login: string): Promise<GithubOwner> {
    const path = `/orgs/${encodeURIComponent(login)}`;
    const response = await this.request(path);
    const owner = await this.json<GithubOwner>(response);
    const check = await this.request(`${path}/repos?per_page=1`);
    await check.body?.cancel();
    return owner;
  }

  repositories(type: "user" | "organization", login: string): Promise<GithubRepository[]> {
    return this.list(type === "user"
      ? "/user/repos?affiliation=owner&visibility=all"
      : `/orgs/${encodeURIComponent(login)}/repos?type=all`);
  }
}

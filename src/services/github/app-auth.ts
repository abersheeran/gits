import { SignJWT } from "jose";
import type { AppBindings } from "../../types";
import { GithubClient, GithubError } from "./github-client";
import { importAppPrivateKey } from "./private-key";
import type { GithubInstallation } from "./types";

const tokens = new Map<string, { token: string; expiresAt: number }>();

function cacheKey(env: AppBindings, installationId: number): string {
  return `${env.GITHUB_APP_CLIENT_ID}:${env.githubHttp?.apiBaseUrl ?? ""}:${installationId}`;
}

export function clearInstallationToken(env: AppBindings, id: number): void {
  tokens.delete(cacheKey(env, id));
}

export async function createAppJwt(env: AppBindings): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const key = await importAppPrivateKey(env.GITHUB_APP_PRIVATE_KEY ?? "");
  return new SignJWT().setProtectedHeader({ alg: "RS256" })
    .setIssuedAt(now - 60).setExpirationTime(now + 540)
    .setIssuer(env.GITHUB_APP_CLIENT_ID!).sign(key);
}

async function appRequest<T>(
  env: AppBindings, id: number, operation: (c: GithubClient) => Promise<T>
) {
  try {
    const client = new GithubClient(await createAppJwt(env), env.githubHttp);
    return await operation(client);
  } catch (error) {
    if (error instanceof GithubError) {
      if (["unauthorized", "not_found", "forbidden"].includes(error.kind)) {
        clearInstallationToken(env, id);
      }
      if (error.kind === "not_found") {
        throw new GithubError("installation_deleted", "GitHub App installation was deleted");
      }
      if (error.kind === "forbidden") {
        throw new GithubError("installation_suspended", "GitHub App installation is suspended");
      }
    }
    throw error;
  }
}

export async function getInstallation(env: AppBindings, id: number): Promise<GithubInstallation> {
  return appRequest(env, id, (client) => client.get(`/app/installations/${id}`));
}

export async function installationToken(env: AppBindings, id: number): Promise<string> {
  const key = cacheKey(env, id);
  const cached = tokens.get(key);
  if (cached && cached.expiresAt > Date.now() + 300000) {
    return cached.token;
  }
  tokens.delete(key);
  const result = await appRequest(env, id, (client) => client.post<{
    token: string; expires_at: string;
  }>(`/app/installations/${id}/access_tokens`, {}));
  const expiresAt = Date.parse(result.expires_at);
  if (!result.token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new GithubError("other", "Invalid GitHub installation token response");
  }
  if (tokens.size >= 1000) {
    tokens.clear();
  }
  tokens.set(key, { token: result.token, expiresAt });
  return result.token;
}

export async function installationClient(env: AppBindings, id: number): Promise<GithubClient> {
  return new GithubClient(await installationToken(env, id), env.githubHttp,
    () => clearInstallationToken(env, id));
}

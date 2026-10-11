import { hashToken, randomToken } from "../session-service";
import type { AppBindings } from "../../types";
import { githubWebBase } from "./config";
import { GithubClient, GithubError } from "./github-client";
import { bindInstallations } from "./oauth-binding";

const encoder = new TextEncoder();
export const OAUTH_COOKIE = "gits_github_oauth";

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function callbackUrl(origin: string): string {
  return `${origin}/api/github/oauth/callback`;
}

export async function authorizeGithub(env: AppBindings, origin: string, userId: string, sessionId: string) {
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest(
    "SHA-256", encoder.encode(verifier)
  )));
  const cookie = randomToken();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM github_oauth_states WHERE expires_at <= ?").bind(now),
    env.DB.prepare(`INSERT INTO github_oauth_states
      (token_hash, user_id, session_id, state, code_verifier, expires_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(await hashToken(cookie), userId, sessionId, state, verifier, now + 600_000)
  ]);
  const url = new URL(`${githubWebBase(env)}/login/oauth/authorize`);
  url.search = new URLSearchParams({
    client_id: env.GITHUB_APP_CLIENT_ID!, state, code_challenge: challenge,
    code_challenge_method: "S256", redirect_uri: callbackUrl(origin)
  }).toString();
  return { cookie, url: url.toString() };
}

export async function verifyOauthState(
  env: AppBindings, cookie: string | undefined,
  state: string | undefined, userId: string | undefined, sessionId: string | undefined
): Promise<string | null> {
  if (!cookie || !/^[a-f0-9]{64}$/.test(cookie) || !state || !userId || !sessionId) return null;
  // Consume atomically, so the callback cannot replay a previously accepted state.
  const row = await env.DB.prepare(`DELETE FROM github_oauth_states
    WHERE token_hash = ? AND state = ? AND user_id = ? AND session_id = ? AND expires_at > ?
    RETURNING code_verifier`)
    .bind(await hashToken(cookie), state, userId, sessionId, Date.now())
    .first<{ code_verifier: string }>();
  return row?.code_verifier ?? null;
}

export async function finishGithubOauth(
  env: AppBindings, origin: string, userId: string, code: string, verifier: string
) {
  let token: string;
  const fetcher = env.githubHttp?.fetch ?? fetch.bind(globalThis);
  try {
    const response = await fetcher(`${githubWebBase(env)}/login/oauth/access_token`, {
      method: "POST", redirect: "manual",
      headers: {
        Accept: "application/json", "Content-Type": "application/json", "User-Agent": "gits"
      },
      body: JSON.stringify({
        client_id: env.GITHUB_APP_CLIENT_ID, client_secret: env.GITHUB_APP_CLIENT_SECRET,
        code, code_verifier: verifier, redirect_uri: callbackUrl(origin)
      })
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error();
    }
    const result = await response.json<{ access_token?: string; error?: string }>();
    if (!result.access_token || result.error) {
      throw new Error();
    }
    token = result.access_token;
  } catch {
    throw new GithubError("other", "GitHub OAuth token exchange failed");
  }
  return bindInstallations(env, userId, new GithubClient(token, env.githubHttp));
}

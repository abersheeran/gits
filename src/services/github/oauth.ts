import { SignJWT, jwtVerify } from "jose";
import type { AppBindings } from "../../types";
import { githubWebBase } from "./config";
import { GithubClient, GithubError } from "./github-client";
import { bindInstallations } from "./oauth-binding";

const encoder = new TextEncoder();
const issuer = "gits-github-oauth";
export const OAUTH_COOKIE = "gits_github_oauth";

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function callbackUrl(origin: string): string {
  return `${origin}/api/github/oauth/callback`;
}

export async function authorizeGithub(env: AppBindings, origin: string, userId: string) {
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest(
    "SHA-256", encoder.encode(verifier)
  )));
  const cookie = await new SignJWT({ userId, state, code_verifier: verifier })
    .setProtectedHeader({ alg: "HS256" }).setIssuer(issuer).setIssuedAt()
    .setExpirationTime("10m").sign(encoder.encode(env.JWT_SECRET));
  const url = new URL(`${githubWebBase(env)}/login/oauth/authorize`);
  url.search = new URLSearchParams({
    client_id: env.GITHUB_APP_CLIENT_ID!, state, code_challenge: challenge,
    code_challenge_method: "S256", redirect_uri: callbackUrl(origin)
  }).toString();
  return { cookie, url: url.toString() };
}

export async function verifyOauthState(
  env: AppBindings, cookie: string | undefined,
  state: string | undefined, userId: string | undefined
): Promise<string | null> {
  if (!cookie || !state || !userId) {
    return null;
  }
  try {
    const { payload } = await jwtVerify(cookie, encoder.encode(env.JWT_SECRET), {
      algorithms: ["HS256"], issuer
    });
    if (payload.state !== state || payload.userId !== userId ||
      typeof payload.code_verifier !== "string") {
      return null;
    }
    return payload.code_verifier;
  } catch {
    return null;
  }
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

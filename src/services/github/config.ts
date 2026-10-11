import type { AppBindings } from "../../types";

export const APP_CONFIG_KEYS = [
  "GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET",
  "GITHUB_APP_PRIVATE_KEY", "GITHUB_APP_WEBHOOK_SECRET"
] as const;

export function githubConfigured(env: AppBindings): boolean {
  return APP_CONFIG_KEYS.every((key) => Boolean(env[key]?.trim()));
}

export function githubWebBase(env: AppBindings): string {
  return (env.githubHttp?.webBaseUrl ?? "https://github.com").replace(/\/$/, "");
}

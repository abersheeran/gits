import app from "../app";
import { AuthService } from "../services/auth-service";
import { githubFixture } from "./github-fixture";
import type { GithubRepository } from "../services/github/github-client";

export async function githubApiFixture(repos: GithubRepository[] = []) {
  const fixture = await githubFixture(repos);
  const auth = new AuthService(fixture.db);
  const alice = await auth.createSessionToken({ id: "user", username: "alice" });
  const bob = await auth.createSessionToken({ id: "other", username: "bob" });
  const pending: Promise<unknown>[] = [];
  const ctx = {
    props: {},
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    passThroughOnException() {
    }
  };
  async function flush() {
    while (pending.length) {
      await Promise.all(pending.splice(0));
    }
  }
  function request(path: string, options: {
    method?: string;
    body?: unknown;
    raw?: BodyInit;
    user?: "alice" | "bob" | null;
    headers?: Record<string, string>;
  } = {}) {
    const user = options.user === undefined ? "alice" : options.user;
    return app.fetch(new Request(`https://gits.test/api${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(user ? { authorization: `Bearer ${user === "alice" ? alice : bob}` } : {}),
        "Content-Type": "application/json", ...options.headers
      },
      ...(options.raw !== undefined ? { body: options.raw } : options.body !== undefined
        ? { body: JSON.stringify(options.body) } : {})
    }), fixture.env, ctx);
  }
  async function oauth() {
    const response = await request("/github/authorize");
    const url = new URL(response.headers.get("Location")!);
    const cookie = response.headers.get("Set-Cookie")!.split(";")[0]!;
    const state = url.searchParams.get("state")!;
    return { url, cookie, state };
  }
  return { ...fixture, request, flush, oauth, pending };
}

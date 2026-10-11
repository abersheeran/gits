import { jwtVerify, SignJWT } from "jose";
import { afterEach, expect, it, vi } from "vitest";
import { githubApiFixture } from "../../test-utils/github-api-fixture";
import { githubInstallation, oauthUserToken } from "../../test-utils/github-fixture";

const encoder = new TextEncoder();
afterEach(() => vi.restoreAllMocks());

it("uses state and PKCE to bind personal and administrator installations", async () => {
  const fixture = await githubApiFixture();
  const { env, sqlite, installations, request, flush, fetcher } = fixture;
  sqlite.exec("DELETE FROM github_installations");
  installations.push(githubInstallation(200, true), { ...githubInstallation(300), app_id: 999 });
  const { url, cookie, state } = await fixture.oauth();
  expect(url.origin).toBe("https://web.test");
  expect(url.searchParams.get("client_id")).toBe(env.GITHUB_APP_CLIENT_ID);
  expect(url.searchParams.get("redirect_uri")).toBe("https://gits.test/api/github/oauth/callback");
  expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  const { payload } = await jwtVerify(cookie.split("=")[1]!, encoder.encode(env.JWT_SECRET));
  expect(payload.userId).toBe("user");
  expect(payload.exp! - payload.iat!).toBe(600);
  const digest = await crypto.subtle.digest(
    "SHA-256", encoder.encode(payload.code_verifier as string)
  );
  expect(url.searchParams.get("code_challenge"))
    .toBe(Buffer.from(digest).toString("base64url"));
  const response = await request(`/github/oauth/callback?code=one-use&state=${state}`, {
    headers: { cookie }
  });
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/sync?bound=2");
  expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
  await flush();
  const rows = sqlite.prepare("SELECT * FROM github_installations ORDER BY installation_id").all();
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ name_prefix: "", linked_by_login: "upstream", user_id: "user" });
  expect(rows[1]).toMatchObject({ name_prefix: "team.", account_type: "organization" });
  expect(JSON.stringify(rows)).not.toContain(oauthUserToken);
  const exchange = fetcher.mock.calls.find(([input]) => String(input).endsWith("access_token"))!;
  expect(JSON.parse(exchange[1]!.body as string)).toMatchObject({
    code: "one-use", code_verifier: payload.code_verifier,
    redirect_uri: "https://gits.test/api/github/oauth/callback"
  });
});

it("reports not_owner, not_admin and taken, and ignores installations for other Apps", async () => {
  const fixture = await githubApiFixture();
  const { installations, sqlite, request, oauth, respond, fetcher, flush } = fixture;
  sqlite.exec("UPDATE github_installations SET user_id = 'other'");
  installations.push(githubInstallation(200, true), {
    ...githubInstallation(300),
    account: { id: 99, login: "someone", avatar_url: null, type: "User" }
  });
  fetcher.mockImplementation(async (input, init) => String(input).includes("memberships")
    ? Response.json({ state: "active", role: "member" }) : respond(input, init));
  const { cookie, state } = await oauth();
  const response = await request(`/github/oauth/callback?code=ok&state=${state}`, {
    headers: { cookie }
  });
  const result = new URL(response.headers.get("Location")!, "https://gits.test");
  expect(result.searchParams.get("bound")).toBe("0");
  expect(result.searchParams.getAll("skipped").sort())
    .toEqual(["someone:not_owner", "team:not_admin", "upstream:taken"]);
  expect(sqlite.prepare("SELECT COUNT(*) n FROM github_installations").get()!.n).toBe(1);
  await flush();
});

it.each(["mismatch", "expired", "session", "missing", "tampered"])(
  "rejects invalid OAuth state: %s", async (reason) => {
    const { env, request, oauth, fetcher } = await githubApiFixture();
    const auth = await oauth();
    let cookie = auth.cookie;
    if (reason === "expired") {
      const expired = await new SignJWT({
        userId: "user", state: auth.state, code_verifier: "verifier"
      }).setProtectedHeader({ alg: "HS256" }).setIssuer("gits-github-oauth")
        .setExpirationTime(Math.floor(Date.now() / 1000) - 1).sign(encoder.encode(env.JWT_SECRET));
      cookie = `gits_github_oauth=${expired}`;
    }
    if (reason === "tampered") {
      cookie += "broken";
    }
    const state = reason === "mismatch" ? "wrong" : auth.state;
    const response = await request(`/github/oauth/callback?code=ok&state=${state}`, {
      user: reason === "session" ? "bob" : "alice",
      headers: reason === "missing" ? {} : { cookie }
    });
    expect(response.headers.get("Location")).toBe("/sync?error=state");
    expect(fetcher).not.toHaveBeenCalled();
  }
);

it("maps denied and exchange errors without exposing or logging user tokens", async () => {
  const { request, oauth, fetcher, sqlite } = await githubApiFixture();
  const log = vi.spyOn(console, "error");
  expect((await request("/github/oauth/callback?error=access_denied"))
    .headers.get("Location")).toBe("/sync?error=denied");
  const { cookie, state } = await oauth();
  fetcher.mockResolvedValueOnce(new Response(oauthUserToken, { status: 500 }));
  const response = await request(`/github/oauth/callback?code=failed&state=${state}`, {
    headers: { cookie }
  });
  expect(response.headers.get("Location")).toBe("/sync?error=github");
  expect(JSON.stringify(sqlite.prepare("SELECT * FROM github_installations").all()))
    .not.toContain(oauthUserToken);
  expect(log).not.toHaveBeenCalled();
});

it("refreshes repeat bindings without resetting settings, owner or binder", async () => {
  const { installations, sqlite, oauth, request, flush } = await githubApiFixture();
  sqlite.exec(`UPDATE github_installations SET name_prefix = 'custom.', paused = 1,
    include_forks = 1, linked_by_login = 'original', created_at = 42`);
  installations[0]!.account = { ...installations[0]!.account, login: "renamed" };
  installations[0]!.repository_selection = "selected";
  const { cookie, state } = await oauth();
  expect((await request(`/github/oauth/callback?code=repeat&state=${state}`, {
    headers: { cookie }
  })).headers.get("Location")).toBe("/sync?bound=1");
  await flush();
  expect(sqlite.prepare("SELECT * FROM github_installations").get()).toMatchObject({
    id: "source", name_prefix: "custom.", paused: 1, include_forks: 1, linked_by_login: "original",
    created_at: 42, account_login: "renamed", repository_selection: "selected"
  });
});

it("handles setup and login/configuration redirects without trusting installation_id", async () => {
  const { request, env, fetcher } = await githubApiFixture();
  expect((await request("/github/setup?setup_action=request&installation_id=evil"))
    .headers.get("Location")).toBe("/sync?error=pending_approval");
  expect((await request("/github/setup?installation_id=evil"))
    .headers.get("Location")).toBe("/api/github/authorize");
  expect((await request("/github/setup", { user: null })).headers.get("Location")).toBe("/login");
  const anonymous = await request("/github/authorize", { user: null });
  expect(anonymous.headers.get("Location")).toBe("/login");
  const response = await request("/github/authorize");
  const cookie = response.headers.get("Set-Cookie")!;
  for (const attribute of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/api/github"]) {
    expect(cookie).toContain(attribute);
  }
  delete env.GITHUB_APP_ID;
  expect((await request("/github/authorize")).headers.get("Location"))
    .toBe("/sync?error=not_configured");
  expect(fetcher).not.toHaveBeenCalled();
});

import { workerdFetch } from "../../test-utils/workerd-fetch";
import { expect, it, vi } from "vitest";
import { GithubClient } from "./github-client";
import { decryptToken, encryptToken } from "./token-crypto";

it("encrypts with randomized IVs and rejects the wrong key or version", async () => {
  const token = "ghp_plaintext_example";
  const ciphertext = await encryptToken(token, "secret");
  expect(ciphertext).not.toContain(token);
  expect(await encryptToken(token, "secret")).not.toBe(ciphertext);
  expect(await decryptToken(ciphertext, "secret")).toBe(token);
  await expect(decryptToken(ciphertext, "wrong")).rejects.toThrow("Cannot decrypt");
  await expect(decryptToken(ciphertext.replace("v1:", "v2:"), "secret"))
    .rejects.toThrow("Cannot decrypt");
});

it("paginates with required headers and rejects off-origin links", async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json([{ id: 1 }], {
      headers: { Link: "<https://api.test/user/orgs?page=2>; rel=\"next\"" }
    }))
    .mockResolvedValueOnce(Response.json([{ id: 2 }]));
  const client = new GithubClient("secret", {
    fetch: workerdFetch(fetcher), apiBaseUrl: "https://api.test"
  });
  expect(await client.organizations()).toEqual([{ id: 1 }, { id: 2 }]);
  expect(fetcher.mock.calls[0]).toEqual([
    "https://api.test/user/orgs?per_page=100",
    expect.objectContaining({ headers: {
      Authorization: "Bearer secret", Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "gits"
    } })
  ]);
  fetcher.mockResolvedValueOnce(Response.json([], {
    headers: { Link: "<https://evil.test/leak>; rel=\"next\"" }
  }));
  await expect(client.organizations()).rejects.toThrow("Invalid GitHub pagination URL");
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it.each([
  [401, {}, "unauthorized"],
  [403, { "X-GitHub-SSO": "required" }, "sso_required"],
  [404, {}, "not_found"],
  [500, {}, "other"]
])("classifies HTTP %s", async (status, headers, kind) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status, headers }));
  await expect(new GithubClient("secret", { fetch: workerdFetch(fetcher) }).user())
    .rejects.toMatchObject({ kind });
});

it("preserves the rate limit reset and supports Retry-After", async () => {
  const reset = Math.ceil(Date.now() / 1000) + 1000;
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("", { status: 403, headers: {
      "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset)
    } }))
    .mockResolvedValueOnce(new Response("", { status: 429, headers: { "retry-after": "60" } }));
  const client = new GithubClient("secret", { fetch: workerdFetch(fetcher) });
  await expect(client.user()).rejects.toMatchObject({
    kind: "rate_limited", resetAt: reset * 1000
  });
  await expect(client.user()).rejects.toMatchObject({
    kind: "rate_limited", resetAt: expect.any(Number)
  });
});

it("checks classic scopes and supersets, skipping fine-grained scopes", async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ id: 1 }));
  await expect(new GithubClient("ghp_token", { fetch: workerdFetch(fetcher) }).validateToken())
    .rejects.toThrow("repo, read:org");
  await expect(new GithubClient("unknown", { fetch: workerdFetch(fetcher) }).validateToken())
    .rejects.toThrow("repo, read:org");
  const fineGrained = new GithubClient("github_pat_token", { fetch: workerdFetch(fetcher) });
  await expect(fineGrained.validateToken())
    .resolves.toMatchObject({ tokenKind: "fine_grained" });
  fetcher.mockResolvedValue(Response.json({ id: 1 }, {
    headers: { "X-OAuth-Scopes": "repo, admin:org" }
  }));
  await expect(new GithubClient("ghp_token", { fetch: workerdFetch(fetcher) }).validateToken())
    .resolves.toMatchObject({ tokenKind: "classic" });
});

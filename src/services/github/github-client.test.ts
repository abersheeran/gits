import { expect, it, vi } from "vitest";
import { workerdFetch } from "../../test-utils/workerd-fetch";
import { GithubClient } from "./github-client";

it("paginates with required headers and rejects off-origin links", async () => {
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ repositories: [{ id: 1 }] }, {
      headers: { Link: '<https://api.test/installation/repositories?page=2>; rel="next"' }
    }))
    .mockResolvedValueOnce(Response.json({ repositories: [{ id: 2 }] }));
  const client = new GithubClient("secret", {
    fetch: workerdFetch(fetcher), apiBaseUrl: "https://api.test"
  });
  expect(await client.repositories()).toEqual([{ id: 1 }, { id: 2 }]);
  expect(fetcher.mock.calls[0]).toEqual([
    "https://api.test/installation/repositories?per_page=100",
    expect.objectContaining({ redirect: "manual", headers: {
      Authorization: "Bearer secret", Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "gits"
    } })
  ]);
  fetcher.mockResolvedValueOnce(Response.json({ repositories: [] }, {
    headers: { Link: '<https://evil.test/leak>; rel="next"' }
  }));
  await expect(client.repositories()).rejects.toThrow("Invalid GitHub pagination URL");
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it.each([
  [401, "unauthorized"], [403, "forbidden"], [404, "not_found"], [500, "other"]
])("classifies HTTP %s", async (status, kind) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status }));
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

import { expect, it } from "vitest";
import { githubFixture, githubRepo } from "../../test-utils/github-fixture";
import { discoverSource } from "./discovery";
import { dispatchMirrorTasks, runScheduler } from "./scheduler";
import { suspendSource } from "./source-store";
import { processWebhook } from "./webhook";

it("rechecks suspended installations and recovers a missed unsuspend webhook", async () => {
  const { env, sqlite, installations, fetcher, remote } = await githubFixture([githubRepo()]);
  installations[0]!.suspended_at = new Date().toISOString();
  await suspendSource(env, "source");
  sqlite.exec("UPDATE github_installations SET next_discovery_at = 0");
  await runScheduler(env);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(sqlite.prepare("SELECT suspended, next_discovery_at FROM github_installations").get())
    .toMatchObject({ suspended: 1, next_discovery_at: expect.any(Number) });
  await runScheduler(env);
  expect(fetcher).toHaveBeenCalledOnce();
  installations[0]!.suspended_at = null;
  sqlite.exec("UPDATE github_installations SET next_discovery_at = 0");
  await runScheduler(env);
  expect(sqlite.prepare("SELECT suspended FROM github_installations").get()!.suspended).toBe(0);
  expect(remote().state).toBe("syncing");
});

it("keeps discovery requested by a concurrent webhook due for the next cron", async () => {
  const { env, sqlite, fetcher, respond, repos, remote } = await githubFixture([githubRepo()]);
  fetcher.mockImplementation(async (input, init) => {
    const response = await respond(input, init);
    if (new URL(String(input)).pathname === "/installation/repositories") {
      repos.push(githubRepo(2));
      await processWebhook(env, "installation_repositories", { installation: { id: 100 } });
    }
    return response;
  });
  await discoverSource(env, "source");
  expect(remote(2)).toBeUndefined();
  expect(sqlite.prepare("SELECT next_discovery_at FROM github_installations").get()!
    .next_discovery_at).toBe(0);
  fetcher.mockImplementation(respond);
  await runScheduler(env);
  expect(remote(2).state).toBe("syncing");
});

it("does not undo suspension received during the installation request", async () => {
  const { env, sqlite, fetcher, respond } = await githubFixture([githubRepo()]);
  fetcher.mockImplementation(async (input, init) => {
    const response = await respond(input, init);
    await suspendSource(env, "source");
    return response;
  });
  await discoverSource(env, "source");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(sqlite.prepare("SELECT suspended FROM github_installations").get()!.suspended).toBe(1);
  expect(sqlite.prepare("SELECT COUNT(*) n FROM github_repositories").get()!.n).toBe(0);
});

it("retains a concurrent discovery request even when the running discovery fails", async () => {
  const { env, sqlite, fetcher } = await githubFixture();
  fetcher.mockImplementation(async () => {
    await discoverSource(env, "source");
    return new Response("", { status: 500 });
  });
  await discoverSource(env, "source");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(sqlite.prepare("SELECT status, next_discovery_at FROM github_installations").get())
    .toMatchObject({ status: "failed", next_discovery_at: 0 });
});

it("does not recalculate repository metadata after losing the discovery claim", async () => {
  const { env, sqlite, fetcher, respond } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  fetcher.mockImplementation(async (input, init) => {
    const response = await respond(input, init);
    if (new URL(String(input)).pathname === "/installation/repositories") {
      sqlite.exec(`UPDATE github_installations SET claim_id = 'replacement',
        visibility_policy = 'private'`);
    }
    return response;
  });
  await discoverSource(env, "source");
  expect(sqlite.prepare("SELECT is_private FROM repositories").get()!.is_private).toBe(0);
  expect(sqlite.prepare("SELECT claim_id FROM github_installations").get()!.claim_id)
    .toBe("replacement");
});

it("holds discovery and mirror dispatch until the installation rate limit resets", async () => {
  const { env, sqlite, fetcher, respond, remote } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  const reset = Math.ceil(Date.now() / 1000) + 7200;
  fetcher.mockResolvedValueOnce(new Response("", { status: 403, headers: {
    "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset)
  } }));
  await discoverSource(env, "source");
  fetcher.mockClear();
  await processWebhook(env, "push", { installation: { id: 100 }, repository: { id: 1 } });
  await discoverSource(env, "source");
  await runScheduler(env);
  expect(fetcher).not.toHaveBeenCalled();
  expect(remote().state).toBe("queued");
  expect(sqlite.prepare("SELECT rate_limit_until FROM github_installations").get()!
    .rate_limit_until).toBe(reset * 1000);
  sqlite.exec("UPDATE github_installations SET rate_limit_until = 0, next_discovery_at = 0");
  fetcher.mockImplementation(respond);
  await runScheduler(env);
  expect(remote().state).toBe("syncing");
});

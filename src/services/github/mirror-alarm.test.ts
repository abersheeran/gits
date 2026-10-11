import { expect, it } from "vitest";
import { githubFixture, githubRepo } from "../../test-utils/github-fixture";
import { repositoryState } from "../../test-utils/mock-repository-object-namespace";
import { RepositoryObject } from "../repository-object";
import { clearInstallationToken, installationToken } from "./app-auth";
import { discoverSource } from "./discovery";
import { dispatchMirrorTasks } from "./scheduler";

it.each([403, 404])("handles token endpoint HTTP %s from inside the alarm", async (status) => {
  const { env, remote, fetcher, sqlite } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  const repositoryId = remote().repository_id!;
  const state = repositoryState(env.REPOSITORY_OBJECTS, repositoryId);
  clearInstallationToken(env, 100);
  fetcher.mockImplementation(async () => new Response("", { status }));
  await new RepositoryObject(state, env).alarm();
  if (status === 404) {
    expect(sqlite.prepare("SELECT * FROM github_installations").all()).toEqual([]);
    expect(sqlite.prepare("SELECT * FROM github_repositories").all()).toEqual([]);
    const repository = sqlite.prepare("SELECT * FROM repositories WHERE id = ?").get(repositoryId);
    expect(repository).toBeDefined();
    expect(await state.storage.getAlarm()).toBeNull();
  } else {
    expect(sqlite.prepare("SELECT suspended FROM github_installations").get()!.suspended).toBe(1);
    expect(remote()).toMatchObject({ state: "failed", lease_until: null });
  }
});

it("clears cached installation tokens when git returns 401", async () => {
  const { env, remote, fetcher, respond } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  const state = repositoryState(env.REPOSITORY_OBJECTS, remote().repository_id!);
  fetcher.mockResolvedValueOnce(new Response("", { status: 401 }));
  await new RepositoryObject(state, env).alarm();
  expect(remote().state).toBe("failed");
  fetcher.mockClear();
  fetcher.mockImplementation(respond);
  await installationToken(env, 100);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(String(fetcher.mock.calls[0]![0])).toContain("/access_tokens");
});

it("defers all new tasks when the alarm hits the installation token rate limit", async () => {
  const { env, sqlite, fetcher } = await githubFixture(
    Array.from({ length: 5 }, (_, index) => githubRepo(index + 1))
  );
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  const row = sqlite.prepare(
    "SELECT repository_id FROM github_repositories WHERE state = 'syncing' LIMIT 1"
  ).get()!;
  const state = repositoryState(env.REPOSITORY_OBJECTS, String(row.repository_id));
  clearInstallationToken(env, 100);
  const reset = Math.ceil(Date.now() / 1000) + 7200;
  fetcher.mockResolvedValue(new Response("", { status: 403, headers: {
    "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset)
  } }));
  await new RepositoryObject(state, env).alarm();
  expect(sqlite.prepare("SELECT rate_limit_until FROM github_installations").get()!
    .rate_limit_until).toBe(reset * 1000);
  expect(sqlite.prepare("SELECT COUNT(*) n FROM github_repositories WHERE state = 'queued'")
    .get()!.n).toBe(1);
});

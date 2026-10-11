import { expect, it, vi } from "vitest";
import { githubApiFixture } from "../../test-utils/github-api-fixture";
import { githubRepo } from "../../test-utils/github-fixture";
import { discoverSource } from "../../services/github/discovery";
import { dispatchMirrorTasks } from "../../services/github/scheduler";
import { completeTask } from "../../services/github/task-state";
import { MIRROR_TASK_KEY } from "../../services/github/mirror-alarm";
import type { MirrorTask } from "../../services/github/types";
import { repositoryState } from "../../test-utils/mock-repository-object-namespace";

async function sign(body: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {
    name: "HMAC", hash: "SHA-256"
  }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return "sha256=" + Buffer.from(bytes).toString("hex");
}

async function fixture(repos = [githubRepo()]) {
  const f = await githubApiFixture(repos);
  async function webhook(
    event: string, payload: unknown, secret = f.env.GITHUB_APP_WEBHOOK_SECRET!
  ) {
    const raw = JSON.stringify(payload);
    const response = await f.request("/github/webhook", {
      method: "POST", raw, user: null,
      headers: { "X-GitHub-Event": event, "X-Hub-Signature-256": await sign(raw, secret) }
    });
    await f.flush();
    return response;
  }
  return { ...f, webhook };
}

it("validates raw body signatures before parsing and accepts signed ping", async () => {
  const { request, webhook, env, fetcher } = await fixture();
  expect((await webhook("ping", {})).status).toBe(200);
  expect((await webhook("push", {}, "wrong")).status).toBe(401);
  expect((await request("/github/webhook", { method: "POST", raw: "not-json", user: null }))
    .status).toBe(401);
  const signature = await sign("not-json", env.GITHUB_APP_WEBHOOK_SECRET!);
  expect((await request("/github/webhook", {
    method: "POST", raw: "not-json", user: null, headers: { "X-Hub-Signature-256": signature }
  })).status).toBe(400);
  expect((await webhook("push", { installation: { id: 999 }, repository: { id: 1 } })).status)
    .toBe(202);
  expect(fetcher).not.toHaveBeenCalled();
});

it("bounds webhook bodies at 25 MiB", async () => {
  const { request } = await fixture();
  const raw = "x".repeat(25 * 1024 * 1024 + 1);
  expect((await request("/github/webhook", { method: "POST", raw, user: null,
    headers: { "X-Hub-Signature-256": "sha256=" + "0".repeat(64) }
  })).status).toBe(413);
});

it("queues pushes without mixing timestamps or losing requests during sync", async () => {
  const { env, sqlite, remote, webhook } = await fixture();
  await discoverSource(env, "source");
  const pushed = remote().pushed_at;
  const payload = { installation: { id: 100 }, repository: { id: 1, pushed_at: 1700000000 } };
  expect((await webhook("push", payload)).status).toBe(202);
  expect(remote().state).toBe("syncing");
  const state = repositoryState(env.REPOSITORY_OBJECTS, remote().repository_id!);
  const task = (await state.storage.get<MirrorTask>(MIRROR_TASK_KEY))!;
  const claim = remote().claim_id;
  await webhook("push", payload);
  await webhook("push", payload);
  expect(remote()).toMatchObject({ pushed_at: pushed, claim_id: claim, attempts: 1 });
  expect(remote().sync_requested_at).toBeGreaterThan(remote().claimed_at!);
  await completeTask(env, task);
  expect(remote()).toMatchObject({ state: "queued", claim_id: null });
  expect(sqlite.prepare("SELECT COUNT(*) n FROM repositories").get()!.n).toBe(1);
});

it("unbinds deleted installations idempotently and preserves local data", async () => {
  const { env, remote, sqlite, webhook } = await fixture();
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  const state = repositoryState(env.REPOSITORY_OBJECTS, remote().repository_id!);
  const payload = { installation: { id: 100 }, action: "deleted" };
  await webhook("installation", payload);
  await webhook("installation", payload);
  expect(await state.storage.getAlarm()).toBeNull();
  expect(sqlite.prepare("SELECT COUNT(*) n FROM github_installations").get()!.n).toBe(0);
  expect(sqlite.prepare("SELECT COUNT(*) n FROM github_repositories").get()!.n).toBe(0);
  expect(sqlite.prepare("SELECT COUNT(*) n FROM repositories").get()!.n).toBe(1);
});

it("suspends and resumes discovery and dispatch", async () => {
  const { env, sqlite, webhook, remote, fetcher, installations } = await fixture();
  installations[0]!.suspended_at = new Date().toISOString();
  await webhook("installation", { installation: { id: 100 }, action: "suspend" });
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(String(fetcher.mock.calls[0]![0])).toContain("/app/installations/100");
  expect(sqlite.prepare("SELECT suspended FROM github_installations").get()!.suspended).toBe(1);
  installations[0]!.suspended_at = null;
  await webhook("installation", { installation: { id: 100 }, action: "unsuspend" });
  expect(sqlite.prepare("SELECT suspended FROM github_installations").get()!.suspended).toBe(0);
  expect(remote().state).toBe("syncing");
});

it.each(["repository", "installation_repositories"])("discovers changes: %s", async (event) => {
  const { env, repos, remote, webhook } = await fixture();
  await discoverSource(env, "source");
  repos[0]!.full_name = "upstream/renamed";
  await webhook(event, { installation: { id: 100 }, action: "renamed", repository: { id: 1 } });
  expect(remote().full_name).toBe("upstream/renamed");
});

it("discovers new repositories on push and new permissions and safely handles errors", async () => {
  const { repos, webhook, remote, fetcher } = await fixture([]);
  repos.push(githubRepo());
  await webhook("push", { installation: { id: 100 }, repository: { id: 1 } });
  expect(remote().state).toBe("syncing");
  repos[0]!.description = "updated";
  await webhook("installation", { installation: { id: 100 }, action: "new_permissions_accepted" });
  expect(remote().description).toBe("updated");
  const count = fetcher.mock.calls.length;
  await webhook("installation", { installation: { id: 100 }, action: "created" });
  expect(fetcher).toHaveBeenCalledTimes(count);
});

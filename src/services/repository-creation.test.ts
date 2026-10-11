import { afterEach, expect, it, vi } from "vitest";
import { githubFixture } from "../test-utils/github-fixture";
import { createInitializedRepository } from "./repository-creation";
import { RepositoryObjectClient } from "./repository-object-client";

afterEach(() => vi.restoreAllMocks());

it("rolls D1 and DO initialization back together on failure", async () => {
  const { env, sqlite } = await githubFixture();
  vi.spyOn(RepositoryObjectClient.prototype, "initializeRepository")
    .mockRejectedValue(new Error("initialization failed"));
  const deleted = vi.spyOn(RepositoryObjectClient.prototype, "deleteRepository")
    .mockResolvedValue();
  await expect(createInitializedRepository(env, {
    ownerId: "user", owner: "alice", name: "new", isPrivate: true
  })).rejects.toThrow("initialization failed");
  expect(sqlite.prepare("SELECT COUNT(*) n FROM repositories").get()!.n).toBe(0);
  expect(deleted).toHaveBeenCalledOnce();
});

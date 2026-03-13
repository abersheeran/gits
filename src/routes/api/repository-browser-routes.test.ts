import { afterEach, describe, expect, it, vi } from "vitest";
import { RepositoryObjectClient } from "../../services/repository-object";
import { createMockD1Database } from "../../test-utils/mock-d1";
import { buildRepositoryRow, createApp, createBaseEnv } from "./test-helpers";

describe("API repository browser routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns branch list for readable repository", async () => {
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () =>
          buildRepositoryRow({
            owner_id: "user-1",
            is_private: 0
          })
      }
    ]);
    const listBranchesSpy = vi
      .spyOn(RepositoryObjectClient.prototype, "listHeadRefs")
      .mockResolvedValue([
        {
          name: "refs/heads/main",
          oid: "0123456789abcdef0123456789abcdef01234567"
        }
      ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/branches"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    expect(listBranchesSpy).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      owner: "alice",
      repo: "demo"
    });
    expect((await response.json()) as { branches: Array<{ name: string; oid: string }> }).toEqual({
      branches: [
        {
          name: "refs/heads/main",
          oid: "0123456789abcdef0123456789abcdef01234567"
        }
      ]
    });
  });

  it("returns 404 for private repository without session", async () => {
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () =>
          buildRepositoryRow({
            id: "repo-2",
            owner_id: "user-2",
            owner_username: "private_owner",
            name: "secret",
            description: null
          })
      }
    ]);

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/private_owner/secret/branches"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(404);
  });

  it("passes commit pagination options to repository object client", async () => {
    const db = createMockD1Database([
      {
        when: "WHERE u.username = ? AND r.name = ?",
        first: () =>
          buildRepositoryRow({
            owner_id: "user-1",
            is_private: 0
          })
      }
    ]);
    const listCommitHistorySpy = vi
      .spyOn(RepositoryObjectClient.prototype, "listCommitHistory")
      .mockResolvedValue({
        ref: "refs/heads/main",
        commits: [],
        pagination: {
          page: 2,
          perPage: 10,
          hasNextPage: true
        }
      });

    const response = await createApp().fetch(
      new Request("http://localhost/api/repos/alice/demo/commits?limit=10&page=2"),
      createBaseEnv(db)
    );

    expect(response.status).toBe(200);
    expect(listCommitHistorySpy).toHaveBeenCalledWith({
      repositoryId: "repo-1",
      owner: "alice",
      repo: "demo",
      limit: 10,
      page: 2
    });
    expect(await response.json()).toEqual({
      ref: "refs/heads/main",
      commits: [],
      pagination: {
        page: 2,
        perPage: 10,
        hasNextPage: true
      }
    });
  });
});

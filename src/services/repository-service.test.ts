import { describe, expect, it } from "vitest";
import { createMockD1Database } from "../test-utils/mock-d1";
import type { RepositoryRecord } from "../types";
import { RepositoryService } from "./repository-service";

const baseRepo: RepositoryRecord = {
  id: "repo-1",
  owner_id: "owner-1",
  owner_username: "alice",
  name: "demo",
  description: null,
  is_private: 1,
  created_at: Date.now()
};

describe("RepositoryService permissions", () => {
  it("allows owner as admin", async () => {
    const service = new RepositoryService(createMockD1Database([]));
    await expect(service.canAdminRepository(baseRepo, "owner-1")).resolves.toBe(true);
  });

  it("grants admin for admin collaborator only", async () => {
    const db = createMockD1Database([
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "admin" })
      }
    ]);
    const service = new RepositoryService(db);
    await expect(service.canAdminRepository(baseRepo, "user-2")).resolves.toBe(true);
  });

  it("does not treat write collaborator as admin", async () => {
    const db = createMockD1Database([
      {
        when: "FROM repository_collaborators",
        first: () => ({ permission: "write" })
      }
    ]);
    const service = new RepositoryService(db);
    await expect(service.canAdminRepository(baseRepo, "user-2")).resolves.toBe(false);
  });

  it("returns repositories from owned and collaborated set query", async () => {
    const db = createMockD1Database([
      {
        when: /SELECT DISTINCT[\s\S]*LEFT JOIN repository_collaborators/,
        all: () => [
          {
            ...baseRepo
          },
          {
            ...baseRepo,
            id: "repo-2",
            owner_id: "owner-2",
            owner_username: "bob",
            name: "shared"
          }
        ]
      }
    ]);
    const service = new RepositoryService(db);
    const repos = await service.listRepositoriesForUser("owner-1");
    expect(repos.map((item) => item.name)).toEqual(["demo", "shared"]);
  });
});

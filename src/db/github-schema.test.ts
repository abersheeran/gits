import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { githubFixture, githubRepo } from "../test-utils/github-fixture";
import { discoverSource } from "../services/github/discovery";
import { dispatchMirrorTasks } from "../services/github/scheduler";

it("applies all migrations with the same tables and indexes as schema.sql", () => {
  const migrated = new DatabaseSync(":memory:", { enableDoubleQuotedStringLiterals: true });
  const schema = new DatabaseSync(":memory:", { enableDoubleQuotedStringLiterals: true });
  for (const filename of ["0001_init.sql", "0002_github_sync.sql", "0003_user_sessions.sql"]) {
    migrated.exec(readFileSync(new URL(`./migrations/${filename}`, import.meta.url), "utf8"));
  }
  schema.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  const query = "SELECT type, name, sql FROM sqlite_master ORDER BY type, name";
  expect(migrated.prepare(query).all()).toEqual(schema.prepare(query).all());
  migrated.close();
  schema.close();
});

it("enforces uniqueness, cascades users, and nulls deleted repository links", async () => {
  const { env, sqlite, remote } = await githubFixture([githubRepo()]);
  await discoverSource(env, "source");
  await dispatchMirrorTasks(env);
  expect(() => sqlite.exec(`INSERT INTO github_installations
    (id, installation_id, user_id, account_id, account_login, account_type,
     repository_selection, linked_by_github_id, linked_by_login,
     next_discovery_at, created_at, updated_at)
    VALUES ('duplicate', 100, 'user', 10, 'upstream', 'user', 'all', 10, 'upstream', 0, 0, 0)`))
    .toThrow();
  sqlite.prepare("DELETE FROM repositories WHERE id = ?").run(remote().repository_id!);
  expect(remote().repository_id).toBeNull();
  sqlite.exec("DELETE FROM users WHERE id = 'user'");
  for (const table of ["github_installations", "github_repositories"]) {
    expect(sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n).toBe(0);
  }
});

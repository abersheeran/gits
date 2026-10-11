import * as git from "isomorphic-git";
import fs from "node:fs";
import { afterEach, expect, it } from "vitest";
import { RepositoryBrowserService } from "../repository-browser-service";
import { oidToBytes } from "./oid";
import { ingestPack } from "./pack-ingest";
import { RefStore } from "./ref-store";
import { RepositoryGraph } from "./repository-graph";
import { chunks, gitRepo, testStore } from "./test-helpers";

const repos: ReturnType<typeof gitRepo>[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.close();
  }
});

it("matches per-path history through merges, deletion and re-addition", async () => {
  const repo = gitRepo();
  repos.push(repo);
  const tips: string[] = [];
  const save = (message: string) => {
    repo.git(["add", "."]);
    repo.git(["commit", "-m", message]);
    tips.push(repo.git(["rev-parse", "HEAD"]).toString().trim());
  };
  fs.mkdirSync(`${repo.dir}/nested`);
  repo.write("LICENSE", "stable");
  repo.write("changed", "original");
  repo.write("restored", "original");
  repo.write("deleted", "original");
  repo.write("nested/file", "original");
  save("root");
  repo.git(["checkout", "-b", "side"]);
  repo.write("side", "branch");
  repo.write("nested/file", "side changed");
  save("side");
  repo.git(["checkout", "main"]);
  repo.git(["rm", "restored", "deleted"]);
  repo.write("changed", "updated");
  save("delete");
  repo.write("restored", "re-added");
  save("re-add");
  repo.git(["merge", "--no-ff", "side", "-m", "merge"]);
  tips.push(repo.git(["rev-parse", "HEAD"]).toString().trim());
  const { store, storage } = testStore();
  await ingestPack(store, chunks(repo.git(["pack-objects", "--stdout", "--all"])));
  const refs = new RefStore(storage);
  const graph = new RepositoryGraph(store, refs);
  const paths = ["LICENSE", "changed", "restored", "deleted", "nested/file", "side", "missing"];
  for (const tip of tips) {
    const together = graph.latestCommits(tip, paths);
    for (const path of paths) {
      let single = null;
      try {
        single = graph.log(tip, 1, path)[0] ?? null;
      } catch {
        single = null;
      }
      const oracle = await git
        .log({ fs, dir: repo.dir, ref: tip, depth: 1, filepath: path })
        .then((commits) => commits[0] ?? null)
        .catch(() => null);
      expect(single).toEqual(oracle);
      expect(together.get(path)).toEqual(single);
    }
  }
  refs.updateRefs([{ name: "refs/heads/main", oldOid: null, newOid: tips.at(-1)! }], {
    head: "ref: refs/heads/main"
  });
  const browser = new RepositoryBrowserService(store, refs);
  const listing = await browser.browseRepositoryContents({ owner: "a", repo: "b" });
  for (const entry of listing.entries) {
    expect(entry.latestCommit?.oid ?? null).toBe(graph.log("main", 1, entry.path)[0]?.oid ?? null);
  }
});

it("caps path traversal at 10,000 commits and returns only confirmed history", async () => {
  const { store, storage } = testStore();
  const encoder = new TextEncoder();
  const original = store.writeFullObject("blob", encoder.encode("old"));
  const changed = store.writeFullObject("blob", encoder.encode("new"));
  function tree(recent: string): string {
    return store.writeFullObject(
      "tree",
      Buffer.concat([
        encoder.encode("100644 LICENSE\0"),
        oidToBytes(original),
        encoder.encode("100644 recent\0"),
        oidToBytes(recent)
      ])
    );
  }
  const oldTree = tree(original);
  const newTree = tree(changed);
  const commits: string[] = [];
  for (let index = 0; index < 10002; index++) {
    const parent = commits.at(-1);
    commits.push(
      store.writeFullObject(
        "commit",
        encoder.encode(
          [
            `tree ${index === 10001 ? newTree : oldTree}`,
            ...(parent ? [`parent ${parent}`] : []),
            `author A <a@a> ${index} +0000`,
            `committer A <a@a> ${index} +0000`,
            "",
            `commit ${index}`,
            ""
          ].join("\n")
        )
      )
    );
  }
  const refs = new RefStore(storage);
  const tip = commits.at(-1)!;
  refs.updateRefs([{ name: "refs/heads/main", oldOid: null, newOid: tip }], {
    head: "ref: refs/heads/main"
  });
  const graph = new RepositoryGraph(store, refs);
  expect(graph.latestCommits(tip, ["LICENSE", "recent"]).get("LICENSE")).toBe(null);
  expect(graph.latestCommits(commits[9999]!, ["LICENSE"]).get("LICENSE")?.oid).toBe(commits[0]);
  expect(graph.log(tip, 20, "recent").map((commit) => commit.oid)).toEqual([tip]);
  expect(graph.log(tip, 1, "LICENSE")).toEqual([]);
  expect(graph.log(tip, 10002)).toHaveLength(10002);
  const browser = new RepositoryBrowserService(store, refs);
  const input = { owner: "a", repo: "b" };
  const listing = await browser.browseRepositoryContents(input);
  expect(listing.entries.find((entry) => entry.name === "LICENSE")?.latestCommit).toBe(null);
  expect(listing.entries.find((entry) => entry.name === "recent")?.latestCommit?.oid).toBe(tip);
  expect(
    (await browser.browseRepositoryContents({ ...input, path: "LICENSE" })).file?.latestCommit
  ).toBe(null);
  expect(
    (await browser.listPathHistory({ ...input, path: "recent" })).commits.map(
      (commit) => commit.oid
    )
  ).toEqual([tip]);
}, 30000);

import * as git from "isomorphic-git";
import fs from "node:fs";
import { afterEach, expect, it } from "vitest";
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

it("matches commit ordering and path history across a CLI-created merge", async () => {
  const repo = gitRepo();
  repos.push(repo);
  repo.write("file", "first\n");
  repo.git(["add", "."]);
  repo.git(["commit", "-m", "root"]);
  repo.git(["checkout", "-b", "side"]);
  repo.write("side", "side\n");
  repo.git(["add", "."]);
  repo.git(["commit", "-m", "side"]);
  repo.git(["checkout", "main"]);
  repo.write("file", "second\n");
  repo.git(["add", "."]);
  repo.git(["commit", "-m", "main"]);
  repo.git(["merge", "--no-ff", "side", "-m", "merge"]);
  const tip = repo.git(["rev-parse", "HEAD"]).toString().trim();
  const { store, storage } = testStore();
  await ingestPack(store, chunks(repo.git(["pack-objects", "--stdout", "--all"])));
  const refs = new RefStore(storage);
  refs.updateRefs([{ name: "refs/heads/main", oldOid: null, newOid: tip }], {
    head: "ref: refs/heads/main"
  });
  const graph = new RepositoryGraph(store, refs);
  const expected = await git.log({ fs, dir: repo.dir, ref: "main", depth: 20 });
  expect(graph.log("main", 20)).toEqual(expected);
  expect(graph.log("main", 20, "file")).toEqual(
    await git.log({
      fs,
      dir: repo.dir,
      ref: "main",
      filepath: "file",
      depth: 20
    })
  );
  expect(graph.resolveRef("HEAD")).toBe(tip);
  expect(graph.resolveRef("refs/heads/main")).toBe(tip);
});

it("preserves Git ref precedence, detached HEAD and annotated tag peeling", () => {
  const { store, storage } = testStore();
  const refs = new RefStore(storage);
  const tree = store.writeFullObject("tree", new Uint8Array());
  const commit = store.writeFullObject(
    "commit",
    new TextEncoder().encode(
      `tree ${tree}\nauthor A <a@a> 1 +0000\ncommitter A <a@a> 1 +0000\n\ncommit\n`
    )
  );
  const tag = store.writeFullObject(
    "tag",
    new TextEncoder().encode(
      `object ${commit}\ntype commit\ntag same\ntagger A <a@a> 1 +0000\n\ntag\n`
    )
  );
  refs.updateRefs(
    [
      { name: "refs/heads/same", oldOid: null, newOid: commit },
      { name: "refs/tags/same", oldOid: null, newOid: tag }
    ],
    { head: commit }
  );
  const graph = new RepositoryGraph(store, refs);
  expect(graph.resolveRef("same")).toBe(tag);
  expect(graph.resolveRef("HEAD")).toBe(commit);
  expect(graph.resolveRef(commit.toUpperCase())).toBe(commit);
  expect(graph.readCommit(tag).oid).toBe(commit);
  expect(graph.readTree(tag).oid).toBe(tree);
});

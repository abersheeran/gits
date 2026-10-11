import * as git from "isomorphic-git";
import fs from "node:fs";
import { afterEach, expect, it } from "vitest";
import type { ObjectType } from "./object-format";
import { allGitObjects, gitRepo, testStore } from "./test-helpers";

const repos: ReturnType<typeof gitRepo>[] = [];

afterEach(() => {
  for (const repo of repos.splice(0)) {
    repo.close();
  }
});

it(
  "matches isomorphic-git for CLI merge commits, signed " +
    "commits/tags, submodules and non-UTC identities",
  async () => {
    const repo = gitRepo();
    repos.push(repo);
    repo.write("a.txt", "first\n");
    repo.git(["add", "."]);
    repo.git(["commit", "-m", "initial\n\nmultiple lines"]);
    const initial = repo.git(["rev-parse", "HEAD"]).toString().trim();
    repo.git(["checkout", "-b", "feature"]);
    repo.write("feature", "feature");
    repo.git(["add", "."]);
    repo.git(["commit", "-m", "feature"]);
    repo.git(["checkout", "main"]);
    repo.write("main", "main");
    repo.git(["add", "."]);
    repo.git(["commit", "-m", "main"]);
    repo.git(["merge", "--no-ff", "feature", "-m", "merge\n\nbody"]);
    repo.git(["update-index", "--add", "--cacheinfo", `160000,${initial},submodule`]);
    repo.git(["commit", "-m", "submodule"]);
    repo.git(["tag", "-a", "v1", "-m", "release\n\nnotes"]);
    const tree = repo.git(["rev-parse", "HEAD^{tree}"]).toString().trim();
    const signed =
      "tree " +
      tree +
      "\nparent " +
      initial +
      "\nauthor A <a@a> 1735787045 +0530\ncommitter C <c@c> 1735787045 " +
      "-0700\ngpgsig -----BEGIN PGP SIGNATURE-----\n fake signature\n " +
      "multiline\n -----END PGP SIGNATURE-----\n\nA signed message\n\nsecond " +
      "paragraph\n\n";
    repo.git(["hash-object", "-t", "commit", "-w", "--stdin"], signed);
    repo.git(
      ["hash-object", "-t", "tag", "-w", "--stdin"],
      "object " +
        initial +
        "\ntype commit\ntag signed\ntagger A <a@a> 1735787045 " +
        "-0000\n\nnotes\n-----BEGIN PGP SIGNATURE-----\nfake\n-----END PGP " +
        "SIGNATURE-----\n"
    );
    const { store } = testStore();
    for (const object of allGitObjects(repo)) {
      store.writeFullObject(object.type as ObjectType, object.content);
      const args = { fs, dir: repo.dir, oid: object.oid };
      if (object.type === "commit") {
        expect(store.readCommit(object.oid)).toEqual(await git.readCommit(args));
      }
      if (object.type === "tree") {
        expect(store.readTree(object.oid)).toEqual(await git.readTree(args));
      }
      if (object.type === "tag") {
        expect(store.readTag(object.oid)).toEqual(await git.readTag(args));
      }
      if (object.type === "blob") {
        expect(store.readBlob(object.oid)).toEqual(await git.readBlob(args));
      }
    }
    expect(
      store.readCommit(repo.git(["rev-parse", "HEAD~1"]).toString().trim()).commit.parent
    ).toHaveLength(2);
    expect(store.readTree(tree).tree.find((entry) => entry.path === "submodule")?.type).toBe(
      "commit"
    );
  }
);

it(
  "matches objects created by isomorphic-git, including empty and " + "normalized messages",
  async () => {
    const repo = gitRepo();
    repos.push(repo);
    await git.init({ fs, dir: repo.dir, defaultBranch: "main" });
    await fs.promises.writeFile(`${repo.dir}/file`, "contents");
    await git.add({ fs, dir: repo.dir, filepath: "file" });
    const oid = await git.commit({
      fs,
      dir: repo.dir,
      message: "\nMessage\r\n\n",
      author: { name: "Example", email: "e@e", timestamp: 123456, timezoneOffset: -480 }
    });
    await git.annotatedTag({
      fs,
      dir: repo.dir,
      ref: "test",
      message: "tag",
      tagger: { name: "Tagger", email: "t@t", timestamp: 123456, timezoneOffset: 420 }
    });
    const { store } = testStore();
    const commit = await git.readCommit({ fs, dir: repo.dir, oid });
    const tree = await git.readTree({ fs, dir: repo.dir, oid: commit.commit.tree });
    const tagOid = await git.resolveRef({ fs, dir: repo.dir, ref: "refs/tags/test" });
    for (const id of [oid, commit.commit.tree, tree.tree[0]!.oid, tagOid]) {
      const raw = await git.readObject({ fs, dir: repo.dir, oid: id, format: "content" });
      store.writeFullObject(raw.type as ObjectType, raw.object as Uint8Array);
    }
    expect(store.readCommit(oid)).toEqual(commit);
    expect(store.readTree(tree.oid)).toEqual(tree);
    expect(store.readTag(tagOid)).toEqual(await git.readTag({ fs, dir: repo.dir, oid: tagOid }));
    expect(store.readBlob(tree.tree[0]!.oid)).toEqual(
      await git.readBlob({ fs, dir: repo.dir, oid: tree.tree[0]!.oid })
    );
  }
);

it("normalizes legacy tree modes like isomorphic-git's tree writer", async () => {
  const repo = gitRepo();
  repos.push(repo);
  const { store } = testStore();
  const blob = repo.git(["hash-object", "-w", "--stdin"], "content").toString().trim();
  const empty = repo.git(["mktree"], "").toString().trim();
  const entries = [
    { mode: "100664", path: "a", oid: blob, type: "blob" },
    { mode: "100600", path: "b", oid: blob, type: "blob" },
    { mode: "100700", path: "c", oid: blob, type: "blob" },
    { mode: "120000", path: "link", oid: blob, type: "blob" },
    { mode: "40000", path: "dir", oid: empty, type: "tree" },
    { mode: "160000", path: "module", oid: "a".repeat(40), type: "commit" }
  ] as const;
  const canonical = await git.writeTree({
    fs,
    dir: repo.dir,
    tree: entries.map((entry) => ({ ...entry }))
  });
  const expected = await git.readTree({ fs, dir: repo.dir, oid: canonical });
  const raw = Buffer.concat(
    entries.flatMap((entry) => [
      Buffer.from(`${entry.mode} ${entry.path}\0`),
      Buffer.from(entry.oid, "hex")
    ])
  );
  const oid = store.writeFullObject("tree", raw);
  expect(store.readTree(oid)).toEqual({ ...expected, oid });
});

it("accepts backslashes in tree names and rejects empty, slash or NUL names", () => {
  const { store } = testStore();
  const child = Buffer.from("a".repeat(40), "hex");
  const oid = store.writeFullObject(
    "tree",
    Buffer.concat([Buffer.from("100664 folder\\name\0"), child])
  );
  expect(store.readTree(oid).tree).toEqual([
    { mode: "100644", path: "folder\\name", oid: child.toString("hex"), type: "blob" }
  ]);
  for (const path of ["", "folder/name", "bad\0name"]) {
    const invalid = store.writeFullObject(
      "tree",
      Buffer.concat([Buffer.from(`100644 ${path}\0`), child])
    );
    expect(() => store.readTree(invalid)).toThrow();
  }
});

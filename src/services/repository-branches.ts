import { HTTPException } from "hono/http-exception";
import { ObjectStore } from "./git-store/object-store";
import { RefStore, validateRefName } from "./git-store/ref-store";

export function branchRef(value: unknown, field = "branchName"): string {
  if (typeof value !== "string") {
    throw new HTTPException(400, { message: `Field '${field}' must be a string` });
  }
  const branch = value.trim();
  if (!branch) {
    throw new HTTPException(400, { message: `Field '${field}' is required` });
  }
  const ref = branch.startsWith("refs/") ? branch : `refs/heads/${branch}`;
  try {
    validateRefName(ref);
    if (!ref.startsWith("refs/heads/")) {
      throw new Error("Not a branch");
    }
  } catch {
    throw new HTTPException(400, { message: `Field '${field}' must be a valid branch name` });
  }
  return ref;
}

export class RepositoryBranches {
  constructor(
    private readonly store: ObjectStore,
    private readonly refs: RefStore
  ) {
  }

  result() {
    const branches = this.refs.listRefs("refs/heads/");
    const head = this.refs.getHead();
    return {
      branches,
      defaultBranch: head?.startsWith("ref: ")
        ? head.slice(5).replace(/^refs\/heads\//, "")
        : (branches[0]?.name.slice(11) ?? null)
    };
  }

  create(value: unknown, source: unknown) {
    const name = branchRef(value);
    if (typeof source !== "string" || !/^[0-9a-f]{40}$/i.test(source.trim())) {
      throw new HTTPException(400, {
        message: "Field 'sourceOid' must be a 40-character commit oid"
      });
    }
    const oid = source.trim().toLowerCase();
    const header = this.store.readHeader(oid);
    if (!header) {
      throw new HTTPException(404, { message: "Source commit not found" });
    }
    if (header.type !== "commit") {
      throw new HTTPException(400, { message: "Source revision must point to a commit" });
    }
    const result = this.refs.updateRefs([{ name, oldOid: null, newOid: oid }]);
    if (result[0]?.status !== "ok") {
      throw new HTTPException(409, {
        message: "Branch already exists or conflicts with a branch path"
      });
    }
    return this.result();
  }

  setDefault(value: unknown) {
    const name = branchRef(value);
    const oid = this.refs.getRef(name);
    if (!oid) {
      throw new HTTPException(404, { message: "Branch not found" });
    }
    this.refs.updateRefs([{ name, oldOid: oid, newOid: oid }], { head: `ref: ${name}` });
    return this.result();
  }

  delete(value: unknown) {
    const name = branchRef(value);
    const oid = this.refs.getRef(name);
    if (!oid) {
      throw new HTTPException(404, { message: "Branch not found" });
    }
    const branches = this.refs.listRefs("refs/heads/");
    const head = this.refs.getHead();
    const selected =
      branches.find((ref) => head === `ref: ${ref.name}`) ??
      branches.find((ref) => ref.name === "refs/heads/main") ??
      branches[0];
    if (selected?.name === name) {
      throw new HTTPException(409, { message: "Default branch cannot be deleted" });
    }
    if (branches.length <= 1) {
      throw new HTTPException(409, { message: "Repository must keep at least one branch" });
    }
    this.refs.updateRefs([{ name, oldOid: oid, newOid: null }]);
    return this.result();
  }
}

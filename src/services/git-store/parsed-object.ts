import type { ObjectType } from "./object-format";

export type GitIdentity = {
  name: string;
  email: string;
  timestamp: number;
  timezoneOffset: number;
};

export type CommitObject = {
  message: string;
  tree: string;
  parent: string[];
  author: GitIdentity;
  committer: GitIdentity;
  gpgsig?: string | undefined;
};

export type TagObject = {
  object: string;
  type: ObjectType;
  tag: string;
  tagger: GitIdentity;
  message: string;
  gpgsig?: string | undefined;
};

export type TreeEntry = {
  mode: string;
  path: string;
  oid: string;
  type: "commit" | "blob" | "tree";
};

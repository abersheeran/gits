import { bytesToOid, oidToBytes } from "./oid";
import type { GitStorage } from "./schema";

export type RefUpdate = {
  name: string;
  oldOid: string | null | undefined;
  newOid: string | null;
};

export type RefStatus = {
  name: string;
  status: "ok" | "stale info" | "atomic update failed" | "refname conflict";
};

export function validateRefName(name: string): void {
  const value = name.replace(/^refs\/(heads|tags)\//, "");
  if (
    value === name ||
    !value ||
    value.includes("..") ||
    value.includes("\\") ||
    value.includes("@{") ||
    value
      .split("/")
      .some(
        (part) =>
          !part ||
          part.startsWith(".") ||
          part.endsWith(".") ||
          part.endsWith(".lock") ||
          /[\u0000-\u001f\u007f ~^:?*\[]/.test(part)
      )
  ) {
    throw new Error(`Invalid reference name: ${name}`);
  }
}

function normalizeOid(oid: string): string {
  return bytesToOid(oidToBytes(oid));
}

function validateHead(value: string): void {
  if (value.startsWith("ref: ")) {
    validateRefName(value.slice(5));
  } else {
    oidToBytes(value);
  }
}

export class RefStore {
  constructor(private readonly storage: GitStorage) {
  }

  listRefs(prefix = ""): Array<{
    name: string;
    oid: string;
  }> {
    return this.storage.sql
      .exec<{
        name: string;
        oid: string;
      }>(
        "SELECT name, oid FROM refs WHERE substr(name, 1, ?) = ? ORDER BY name",
        prefix.length,
        prefix
      )
      .toArray();
  }

  getRef(name: string): string | null {
    return (
      this.storage.sql
        .exec<{
          oid: string;
        }>("SELECT oid FROM refs WHERE name = ?", name)
        .toArray()[0]?.oid ?? null
    );
  }

  getHead(): string | null {
    return (
      this.storage.sql
        .exec<{
          value: string;
        }>("SELECT value FROM meta WHERE key = 'head'")
        .toArray()[0]?.value ?? null
    );
  }

  setHead(value: string): void {
    validateHead(value);
    this.storage.sql
      .exec(
        "INSERT INTO meta (key, value) VALUES ('head', ?) ON CONFLICT(key) " +
          "DO UPDATE SET value = excluded.value",
        value
      )
      .toArray();
  }

  updateRefs(
    updates: RefUpdate[],
    options?: {
      head?: string;
      meta?: Record<string, string>;
    }
  ): RefStatus[] {
    const names = new Set<string>();
    const normalized = updates.map((update) => {
      validateRefName(update.name);
      if (names.has(update.name)) {
        throw new Error("Duplicate reference update");
      }
      names.add(update.name);
      return {
        ...update,
        oldOid: update.oldOid == null ? update.oldOid : normalizeOid(update.oldOid),
        newOid: update.newOid === null ? null : normalizeOid(update.newOid)
      };
    });
    if (options?.head !== undefined) {
      validateHead(options.head);
    }
    return this.storage.transactionSync(() => {
      const finalNames = new Set(this.listRefs().map((ref) => ref.name));
      for (const update of normalized) {
        if (update.newOid === null) {
          finalNames.delete(update.name);
        } else {
          finalNames.add(update.name);
        }
      }
      const statuses: RefStatus[] = normalized.map((update) => {
        if (update.oldOid !== undefined && this.getRef(update.name) !== update.oldOid) {
          return { name: update.name, status: "stale info" };
        }
        if (
          update.newOid !== null &&
          [...finalNames].some(
            (name) => name.startsWith(update.name + "/") || update.name.startsWith(name + "/")
          )
        ) {
          return { name: update.name, status: "refname conflict" };
        }
        return { name: update.name, status: "ok" };
      });
      if (statuses.some((item) => item.status !== "ok")) {
        return statuses.map((item) =>
          item.status === "ok" ? { ...item, status: "atomic update failed" } : item
        );
      }
      for (const update of normalized) {
        if (update.newOid === null) {
          this.storage.sql.exec("DELETE FROM refs WHERE name = ?", update.name).toArray();
        } else {
          this.storage.sql
            .exec(
              "INSERT INTO refs (name, oid) VALUES (?, ?) ON CONFLICT(name) DO " +
                "UPDATE SET oid = excluded.oid",
              update.name,
              update.newOid
            )
            .toArray();
        }
      }
      if (options?.head !== undefined) {
        this.setHead(options.head);
      }
      for (const [key, value] of Object.entries(options?.meta ?? {})) {
        this.storage.sql
          .exec(
            `INSERT INTO meta (key, value) VALUES (?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
            key,
            value
          )
          .toArray();
      }
      return statuses;
    });
  }
}

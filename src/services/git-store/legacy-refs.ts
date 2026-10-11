import { RefStore, validateRefName } from "./ref-store";

export type SkippedLegacyRef = {
  name: string;
  value: string;
  reason: "unsupported namespace" | "invalid name" | "symbolic ref" | "invalid oid";
};

export class LegacyRefs {
  private readonly values = new Map<string, string>();
  private readonly looseNames = new Set<string>();
  readonly skippedRefs: SkippedLegacyRef[] = [];

  add(name: string, value: string, loose = true): void {
    if (!loose && this.looseNames.has(name)) {
      return;
    }
    if (loose) {
      this.looseNames.add(name);
    }
    value = value.trim();
    const reason = this.skipReason(name, value);
    if (reason) {
      this.skippedRefs.push({ name, value, reason });
      return;
    }
    this.values.set(name, value.toLowerCase());
  }

  private skipReason(name: string, value: string): SkippedLegacyRef["reason"] | null {
    if (!/^refs\/(heads|tags)\//.test(name)) {
      return "unsupported namespace";
    }
    try {
      validateRefName(name);
    } catch {
      return "invalid name";
    }
    if (value.startsWith("ref:")) {
      return "symbolic ref";
    }
    if (!/^[0-9a-f]{40}$/i.test(value)) {
      return "invalid oid";
    }
    return null;
  }

  addPacked(text: string): void {
    for (const line of text.split("\n")) {
      if (!line.trim() || line.startsWith("#") || line.startsWith("^")) {
        continue;
      }
      const match = /^(\S+)\s+(.+)$/.exec(line.trim());
      if (match) {
        this.add(match[2]!, match[1]!, false);
      } else {
        this.skippedRefs.push({ name: "packed-refs", value: line, reason: "invalid oid" });
      }
    }
  }

  entries(): Array<[string, string]> {
    return [...this.values];
  }

  selectHead(head: string | null): string {
    if (head?.startsWith("ref: ")) {
      const name = head.slice(5);
      try {
        validateRefName(name);
        if (!this.skippedRefs.some((ref) => ref.name === name)) {
          return head;
        }
      } catch {
        // Unsupported HEAD targets use the same branch fallback as a missing HEAD.
      }
      this.skippedRefs.push({ name: "HEAD", value: head, reason: "symbolic ref" });
    } else if (head && /^[0-9a-f]{40}$/i.test(head)) {
      return head.toLowerCase();
    } else if (head) {
      this.skippedRefs.push({ name: "HEAD", value: head, reason: "invalid oid" });
    }
    const branches = [...this.values.keys()].filter((name) => name.startsWith("refs/heads/"));
    branches.sort();
    const selected = branches.includes("refs/heads/main") ? "refs/heads/main" : branches[0];
    return `ref: ${selected ?? "refs/heads/main"}`;
  }

  publish(refs: RefStore, head: string, cleanupPending = false): void {
    const statuses = refs.updateRefs(
      this.entries().map(([name, oid]) => ({ name, oldOid: undefined, newOid: oid })),
      {
        head,
        meta: { initialized: "1", ...(cleanupPending ? { legacy_cleanup: "1" } : {}) }
      }
    );
    if (statuses.some((status) => status.status !== "ok")) {
      throw new Error("Invalid legacy references");
    }
  }
}

import { buildReceivePackReport, isZeroOid } from "./git-protocol";
import { parseReceivePackStream, type ReceivePackCommand } from "./git-receive-request";
import { findMissingObject } from "./git-store/connectivity";
import { GitPackTooLargeError } from "./git-store/object-format";
import { ObjectStore } from "./git-store/object-store";
import { ingestPack } from "./git-store/pack-ingest";
import { RefStore, validateRefName } from "./git-store/ref-store";

type Status = { refName: string; ok: boolean; message?: string };

function checkCommands(store: ObjectStore, commands: ReceivePackCommand[]): Status[] {
  const seen = new Set<string>();
  return commands.map((command) => {
    let message: string | undefined;
    if (seen.has(command.refName)) {
      message = "duplicate command";
    } else {
      seen.add(command.refName);
      try {
        validateRefName(command.refName);
      } catch {
        message = "ref not allowed";
      }
      if (!message && !isZeroOid(command.newOid)) {
        const header = store.readHeader(command.newOid);
        if (!header) {
          message = "missing object";
        } else if (command.refName.startsWith("refs/heads/") && header.type !== "commit") {
          message = "branch update must point to a commit";
        }
      }
    }
    return message
      ? { refName: command.refName, ok: false, message }
      : { refName: command.refName, ok: true };
  });
}

function nextHead(refs: RefStore, commands: ReceivePackCommand[]): string {
  const names = new Set(refs.listRefs("refs/heads/").map((ref) => ref.name));
  for (const command of commands) {
    if (!command.refName.startsWith("refs/heads/")) {
      continue;
    }
    if (isZeroOid(command.newOid)) {
      names.delete(command.refName);
    } else {
      names.add(command.refName);
    }
  }
  const head = refs.getHead();
  if (head?.startsWith("ref: ") && names.has(head.slice(5))) {
    return head;
  }
  return `ref: ${
    names.has("refs/heads/main") ? "refs/heads/main" : ([...names].sort()[0] ?? "refs/heads/main")
  }`;
}

export async function receivePack(args: {
  store: ObjectStore;
  refs: RefStore;
  body: ReadableStream<Uint8Array>;
}) {
  let request: Awaited<ReturnType<typeof parseReceivePackStream>> | undefined;
  let unpackError: string | undefined;
  let statuses: Status[] = [];
  let tooLarge = false;
  try {
    request = await parseReceivePackStream(args.body);
    let startRowid = args.store.maxRowid();
    try {
      if (request.commands.some((command) => !isZeroOid(command.newOid))) {
        const result = await ingestPack(args.store, request.pack);
        startRowid = result.startRowid;
      } else {
        for await (const chunk of request.pack) {
          void chunk;
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "error unpacking objects";
      unpackError = reason;
      tooLarge = error instanceof GitPackTooLargeError;
      statuses = request.commands.map((command) => ({
        refName: command.refName,
        ok: false,
        message: reason
      }));
    }
    if (!unpackError) {
      statuses = checkCommands(args.store, request.commands);
      if (statuses.every((status) => status.ok)) {
        const tips = request.commands
          .filter((command) => !isZeroOid(command.newOid))
          .map((command) => command.newOid);
        const missing = findMissingObject(args.store, startRowid, tips);
        if (missing) {
          statuses = statuses.map((status) => ({
            ...status,
            ok: false,
            message: "missing necessary objects"
          }));
        } else {
          const updated = args.refs.updateRefs(
            request.commands.map((command) => ({
              name: command.refName,
              oldOid: isZeroOid(command.oldOid) ? null : command.oldOid,
              newOid: isZeroOid(command.newOid) ? null : command.newOid
            })),
            { head: nextHead(args.refs, request.commands) }
          );
          statuses = updated.map((item) =>
            item.status === "ok"
              ? { refName: item.name, ok: true }
              : { refName: item.name, ok: false, message: item.status }
          );
        }
      } else {
        statuses = statuses.map((status) =>
          status.ok ? { ...status, ok: false, message: "atomic update failed" } : status
        );
      }
    }
  } catch (error) {
    unpackError = error instanceof Error ? error.message : "receive-pack failed";
    tooLarge = error instanceof GitPackTooLargeError;
    statuses =
      request?.commands.map((command) => ({
        refName: command.refName,
        ok: false,
        message: unpackError!
      })) ?? [];
  } finally {
    await request?.close();
  }
  const payload = buildReceivePackReport({
    capabilities: request?.capabilities ?? ["report-status"],
    refStatuses: statuses,
    ...(unpackError ? { unpackError } : {})
  });
  return new Response(Uint8Array.from(payload), {
    status: tooLarge ? 413 : 200,
    headers: {
      "Content-Type": "application/x-git-receive-pack-result",
      "Cache-Control": "no-store"
    }
  });
}

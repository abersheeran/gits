import { ProtocolError } from "./git-errors";
import { PackReader } from "./git-store/pack-input";

const textDecoder = new TextDecoder();
const MAX_REQUEST_PKT_LINES = 20000;
function normalizeOid(value: string, label: string): string {
  if (!/^[0-9a-f]{40}$/i.test(value)) {
    throw new ProtocolError(`Invalid ${label} oid`);
  }
  return value.toLowerCase();
}

export type ReceivePackCommand = {
  oldOid: string;
  newOid: string;
  refName: string;
};

function parseCommand(
  payload: Uint8Array,
  commands: ReceivePackCommand[],
  capabilities: Set<string>
): void {
  let line = textDecoder.decode(payload).replace(/\n$/, "");
  if (!line) {
    return;
  }

  if (commands.length === 0) {
    const parts = line.split("\0", 2);
    line = parts[0] ?? "";
    const caps = parts[1];
    if (caps) {
      for (const capability of caps.split(/\s+/).filter(Boolean)) {
        capabilities.add(capability);
      }
    }
  }

  const match = /^([0-9a-f]{40}) ([0-9a-f]{40}) ([^\s]+)$/i.exec(line);
  if (!match) {
    throw new ProtocolError("Malformed receive-pack command");
  }

  const oldOid = normalizeOid(match[1] ?? "", "old");
  const newOid = normalizeOid(match[2] ?? "", "new");
  const refName = (match[3] ?? "").trim();
  if (!refName.startsWith("refs/")) {
    throw new ProtocolError("Invalid ref name");
  }

  commands.push({
    oldOid,
    newOid,
    refName
  });
}

export async function parseReceivePackStream(body: ReadableStream<Uint8Array>) {
  const reader = new PackReader(body);
  const commands: ReceivePackCommand[] = [];
  const capabilities = new Set<string>();
  try {
    for (let count = 0; ; count++) {
      if (count >= MAX_REQUEST_PKT_LINES) {
        throw new ProtocolError("Too many pkt-lines");
      }
      const prefix = await reader.bytes(4, false);
      const length = Number.parseInt(textDecoder.decode(prefix), 16);
      if (!Number.isFinite(length)) {
        throw new ProtocolError("Invalid pkt-line length");
      }
      if (length === 0) {
        break;
      }
      if (length < 4 || length > 0xfff0) {
        throw new ProtocolError("Invalid pkt-line length value");
      }
      parseCommand(await reader.bytes(length - 4, false), commands, capabilities);
    }
    if (!commands.length) {
      throw new ProtocolError("No receive-pack commands found");
    }
  } catch (error) {
    await reader.close();
    throw error;
  }
  async function* pack() {
    try {
      for (;;) {
        const bytes = await reader.peek();
        if (!bytes.length) {
          return;
        }
        reader.consume(bytes.length, false);
        yield bytes;
      }
    } finally {
      await reader.close();
    }
  }
  return { commands, capabilities, pack: pack(), close: () => reader.close() };
}

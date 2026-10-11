import { PackReader } from "./git-store/pack-input";
import { validateRefName } from "./git-store/ref-store";

export async function* readPackets(body: ReadableStream<Uint8Array>, maxBytes?: number) {
  const reader = new PackReader(body, maxBytes);
  try {
    while ((await reader.peek()).length) {
      const prefix = new TextDecoder().decode(await reader.bytes(4, false));
      if (!/^[0-9a-f]{4}$/i.test(prefix)) {
        throw new Error("Invalid Git pkt-line header");
      }
      const size = Number.parseInt(prefix, 16);
      if (size === 0) {
        continue;
      }
      if (size < 4 || size > 65520) {
        throw new Error("Invalid Git pkt-line size");
      }
      yield await reader.bytes(size - 4, false);
    }
  } finally {
    await reader.close();
  }
}

export function allowedRef(name: string): boolean {
  try {
    validateRefName(name);
    return true;
  } catch {
    console.warn("Skipping invalid remote reference");
    return false;
  }
}

export async function readAdvertisement(body: ReadableStream<Uint8Array>) {
  const refs = new Map<string, string>();
  let head: string | undefined;
  for await (const bytes of readPackets(body, 32 * 1024 * 1024)) {
    const line = new TextDecoder().decode(bytes).replace(/\n$/, "");
    if (line.startsWith("# service=")) {
      if (line !== "# service=git-upload-pack") {
        throw new Error("Unexpected Git service");
      }
      continue;
    }
    const [reference = "", capabilities = ""] = line.split("\0");
    const symref = capabilities.split(" ").find((item) => item.startsWith("symref=HEAD:"));
    if (symref) {
      const name = symref.slice("symref=HEAD:".length);
      if (name.startsWith("refs/heads/") && allowedRef(name)) {
        head = `ref: ${name}`;
      }
    }
    const match = reference.match(/^([0-9a-f]{40}) (.+)$/i);
    if (!match) {
      throw new Error("Invalid Git reference advertisement");
    }
    const [, oid, name] = match as [string, string, string];
    if (name.endsWith("^{}") || !/^refs\/(heads|tags)\//.test(name)) {
      continue;
    }
    if (allowedRef(name) && !/^0{40}$/.test(oid)) {
      refs.set(name, oid.toLowerCase());
    }
  }
  return { refs, head };
}

export async function* unpackSideband(body: ReadableStream<Uint8Array>) {
  for await (const packet of readPackets(body)) {
    if (packet[0] === 1) {
      yield packet.subarray(1);
    } else if (packet[0] === 3) {
      throw new Error(`GitHub git error: ${new TextDecoder().decode(packet.subarray(1))}`);
    } else if (packet[0] !== 2) {
      const line = new TextDecoder().decode(packet);
      if (!/^(ACK [0-9a-f]{40}(?: [a-z]+)?|NAK)\n$/.test(line)) {
        throw new Error("Unexpected Git upload-pack response");
      }
    }
  }
}

import { ProtocolError } from "./git-errors";
import {
  concatBytes,
  encodeFlushPktLine,
  encodePktLine,
  encodeTextPktLine,
  parsePktLines
} from "./git-pkt-line";
export { concatBytes, encodeFlushPktLine, encodePktLine, encodeTextPktLine } from "./git-pkt-line";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const OID_REGEX = /^[0-9a-f]{40}$/i;
const ZERO_OID = "0000000000000000000000000000000000000000";
// side-band payload limits subtract 4-byte pkt header and 1-byte channel marker.
const SIDE_BAND_PAYLOAD_SIZE = 995;
const SIDE_BAND_64K_PAYLOAD_SIZE = 65515;

function normalizeOid(oid: string, label: string): string {
  const trimmed = oid.trim();
  if (!OID_REGEX.test(trimmed)) {
    throw new ProtocolError(`Invalid ${label} oid`);
  }
  return trimmed.toLowerCase();
}

function parsePositiveInteger(raw: string, label: string): number {
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value) || Number.isNaN(value) || value <= 0) {
    throw new ProtocolError(`Invalid ${label}`);
  }
  return value;
}

function parseNonNegativeInteger(raw: string, label: string): number {
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(value) || Number.isNaN(value) || value < 0) {
    throw new ProtocolError(`Invalid ${label}`);
  }
  return value;
}

type UploadPackRequest = {
  wants: string[];
  haves: string[];
  done: boolean;
  capabilities: Set<string>;
  deepen?: number;
  deepenSince?: number;
  deepenNot: string[];
  filterSpec?: string;
  clientShallows: string[];
};

export function parseUploadPackRequest(body: ArrayBuffer): UploadPackRequest {
  const lines = parsePktLines(new Uint8Array(body));
  const wants: string[] = [];
  const haves: string[] = [];
  const capabilities = new Set<string>();
  const deepenNot: string[] = [];
  const clientShallows: string[] = [];
  let deepen: number | undefined;
  let deepenSince: number | undefined;
  let filterSpec: string | undefined;
  let done = false;

  for (const lineBytes of lines) {
    const line = textDecoder.decode(lineBytes).replace(/\n$/, "");

    if (!line) {
      continue;
    }
    if (line === "done") {
      done = true;
      continue;
    }
    if (line.startsWith("want ")) {
      const value = line.slice("want ".length);
      const [head, nullCaps] = value.split("\0", 2);
      const tokens = (head ?? "").trim().split(/\s+/).filter(Boolean);
      if (tokens.length === 0) {
        throw new ProtocolError("Malformed want line");
      }
      const oid = normalizeOid(tokens[0] ?? "", "want");
      wants.push(oid);

      for (const capability of tokens.slice(1)) {
        capabilities.add(capability);
      }
      if (nullCaps) {
        for (const capability of nullCaps.split(/\s+/).filter(Boolean)) {
          capabilities.add(capability);
        }
      }
      continue;
    }
    if (line.startsWith("have ")) {
      haves.push(normalizeOid(line.slice("have ".length), "have"));
      continue;
    }
    if (line.startsWith("shallow ")) {
      clientShallows.push(normalizeOid(line.slice("shallow ".length), "shallow"));
      continue;
    }
    if (line.startsWith("deepen ")) {
      deepen = parsePositiveInteger(line.slice("deepen ".length), "deepen");
      continue;
    }
    if (line.startsWith("deepen-since ")) {
      deepenSince = parseNonNegativeInteger(line.slice("deepen-since ".length), "deepen-since");
      continue;
    }
    if (line.startsWith("deepen-not ")) {
      const value = line.slice("deepen-not ".length).trim();
      if (!value) {
        throw new ProtocolError("Invalid deepen-not");
      }
      deepenNot.push(value);
      continue;
    }
    if (line.startsWith("filter ")) {
      const spec = line.slice("filter ".length).trim();
      if (!spec) {
        throw new ProtocolError("Invalid filter");
      }
      filterSpec = spec;
      continue;
    }
  }

  if (wants.length === 0) {
    throw new ProtocolError("No want lines found");
  }

  const unique = <T,>(items: T[]) => [...new Set(items)];
  const response: UploadPackRequest = {
    wants: unique(wants),
    haves: unique(haves),
    done,
    capabilities,
    deepenNot: unique(deepenNot),
    clientShallows: unique(clientShallows)
  };
  if (deepen !== undefined) {
    response.deepen = deepen;
  }
  if (deepenSince !== undefined) {
    response.deepenSince = deepenSince;
  }
  if (filterSpec !== undefined) {
    response.filterSpec = filterSpec;
  }
  return response;
}

type ReceivePackRefStatus = {
  refName: string;
  ok: boolean;
  message?: string;
};

export function buildReceivePackReport(args: {
  capabilities: Iterable<string>;
  refStatuses: ReceivePackRefStatus[];
  unpackError?: string;
}): Uint8Array {
  const capabilities = new Set(args.capabilities);
  const parts: Uint8Array[] = [];
  if (args.unpackError) {
    parts.push(encodeTextPktLine(`unpack ${args.unpackError}\n`));
  } else {
    parts.push(encodeTextPktLine("unpack ok\n"));
  }

  for (const status of args.refStatuses) {
    if (status.ok) {
      parts.push(encodeTextPktLine(`ok ${status.refName}\n`));
      continue;
    }
    const message = status.message?.trim() || "failed";
    parts.push(encodeTextPktLine(`ng ${status.refName} ${message}\n`));
  }
  parts.push(encodeFlushPktLine());
  const plainPayload = concatBytes(parts);
  if (supportsSideBand(capabilities)) {
    const maxPayload = sideBandChunkSize(capabilities);
    const multiplexed = [
      ...encodeSideBandChunks(1, plainPayload, maxPayload),
      encodeFlushPktLine()
    ];
    return concatBytes(multiplexed);
  }
  return plainPayload;
}

export function isZeroOid(oid: string): boolean {
  return oid.toLowerCase() === ZERO_OID;
}

export function supportsSideBand(capabilities: Set<string>): boolean {
  return capabilities.has("side-band") || capabilities.has("side-band-64k");
}

export function sideBandChunkSize(capabilities: Set<string>): number {
  if (capabilities.has("side-band-64k")) {
    return SIDE_BAND_64K_PAYLOAD_SIZE;
  }
  return SIDE_BAND_PAYLOAD_SIZE;
}

export function encodeSideBandChunks(
  channel: 1 | 2 | 3,
  payload: Uint8Array,
  maxPayload: number
): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let offset = 0; offset < payload.length; offset += maxPayload) {
    const chunk = payload.subarray(offset, offset + maxPayload);
    const sideBandPayload = new Uint8Array(chunk.length + 1);
    sideBandPayload[0] = channel;
    sideBandPayload.set(chunk, 1);
    out.push(encodePktLine(sideBandPayload));
  }
  return out;
}

export function encodeAckNak(ackOids: string[]): Uint8Array[] {
  const uniqueAcks = [...new Set(ackOids.map((oid) => oid.toLowerCase()))].filter((oid) =>
    OID_REGEX.test(oid)
  );
  if (uniqueAcks.length === 0) {
    return [encodeTextPktLine("NAK\n")];
  }
  return [encodeTextPktLine(`ACK ${uniqueAcks[0]}\n`)];
}

export function buildUploadPackNegotiationResponse(ackOids: string[]): Uint8Array {
  return concatBytes(encodeAckNak(ackOids));
}

export function encodeShallowLines(shallowOids: string[]): Uint8Array[] {
  return [...new Set(shallowOids.map((oid) => oid.toLowerCase()))]
    .filter((oid) => OID_REGEX.test(oid))
    .map((oid) => encodeTextPktLine(`shallow ${oid}\n`));
}

export function encodeProtocolError(message: string, capabilities?: Iterable<string>): Uint8Array {
  const normalizedCapabilities = new Set(capabilities ?? []);
  const parts: Uint8Array[] = [];
  if (supportsSideBand(normalizedCapabilities)) {
    const maxPayload = sideBandChunkSize(normalizedCapabilities);
    parts.push(...encodeSideBandChunks(3, textEncoder.encode(`ERR ${message}\n`), maxPayload));
  } else {
    parts.push(encodeTextPktLine(`ERR ${message}\n`));
  }
  parts.push(encodeFlushPktLine());
  return concatBytes(parts);
}

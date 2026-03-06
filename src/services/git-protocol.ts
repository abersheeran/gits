import { ProtocolError } from "./git-errors";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const OID_REGEX = /^[0-9a-f]{40}$/i;
const ZERO_OID = "0000000000000000000000000000000000000000";
// Git pkt-line length field caps at 0xfff0 (65520), not 0xffff.
const MAX_PKT_LINE_LENGTH = 0xfff0;
const MAX_REQUEST_PKT_LINES = 20000;
// side-band payload limits subtract 4-byte pkt header and 1-byte channel marker.
const SIDE_BAND_PAYLOAD_SIZE = 995;
const SIDE_BAND_64K_PAYLOAD_SIZE = 65515;

function encodeLength(length: number): Uint8Array {
  return textEncoder.encode(length.toString(16).padStart(4, "0"));
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function encodePktLine(payload: Uint8Array): Uint8Array {
  const totalLength = payload.length + 4;
  if (totalLength > MAX_PKT_LINE_LENGTH) {
    throw new ProtocolError("pkt-line payload too large");
  }
  const line = new Uint8Array(totalLength);
  line.set(encodeLength(totalLength), 0);
  line.set(payload, 4);
  return line;
}

export function encodeTextPktLine(payload: string): Uint8Array {
  return encodePktLine(textEncoder.encode(payload));
}

export function encodeFlushPktLine(): Uint8Array {
  return textEncoder.encode("0000");
}

function parsePktLines(rawBody: Uint8Array): Uint8Array[] {
  const lines: Uint8Array[] = [];
  let offset = 0;
  let lineCount = 0;

  while (offset < rawBody.length) {
    lineCount += 1;
    if (lineCount > MAX_REQUEST_PKT_LINES) {
      throw new ProtocolError("Too many pkt-lines");
    }

    if (offset + 4 > rawBody.length) {
      throw new ProtocolError("Malformed pkt-line header");
    }

    const lengthHex = textDecoder.decode(rawBody.subarray(offset, offset + 4));
    const length = Number.parseInt(lengthHex, 16);
    if (!Number.isFinite(length) || Number.isNaN(length)) {
      throw new ProtocolError("Invalid pkt-line length");
    }

    offset += 4;
    if (length === 0) {
      continue;
    }
    if (length < 4) {
      throw new ProtocolError("Invalid pkt-line length value");
    }

    const payloadLength = length - 4;
    if (offset + payloadLength > rawBody.length) {
      throw new ProtocolError("Malformed pkt-line payload");
    }

    lines.push(rawBody.subarray(offset, offset + payloadLength));
    offset += payloadLength;
  }

  return lines;
}

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

export type UploadPackRequest = {
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
      deepenSince = parseNonNegativeInteger(
        line.slice("deepen-since ".length),
        "deepen-since"
      );
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

  const unique = <T>(items: T[]) => [...new Set(items)];
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

export type ReceivePackCommand = {
  oldOid: string;
  newOid: string;
  refName: string;
};

export type ReceivePackRequest = {
  commands: ReceivePackCommand[];
  capabilities: Set<string>;
  packfile?: Uint8Array;
};

export function parseReceivePackRequest(body: ArrayBuffer): ReceivePackRequest {
  const bytes = new Uint8Array(body);
  const capabilities = new Set<string>();
  const commands: ReceivePackCommand[] = [];
  let offset = 0;
  let lineCount = 0;
  let sawFlush = false;

  while (offset < bytes.length) {
    lineCount += 1;
    if (lineCount > MAX_REQUEST_PKT_LINES) {
      throw new ProtocolError("Too many pkt-lines");
    }
    if (offset + 4 > bytes.length) {
      throw new ProtocolError("Malformed pkt-line header");
    }

    const lengthHex = textDecoder.decode(bytes.subarray(offset, offset + 4));
    const length = Number.parseInt(lengthHex, 16);
    if (!Number.isFinite(length) || Number.isNaN(length)) {
      throw new ProtocolError("Invalid pkt-line length");
    }
    offset += 4;

    if (length === 0) {
      sawFlush = true;
      break;
    }
    if (length < 4) {
      throw new ProtocolError("Invalid pkt-line length value");
    }

    const payloadLength = length - 4;
    if (offset + payloadLength > bytes.length) {
      throw new ProtocolError("Malformed pkt-line payload");
    }

    const payload = bytes.subarray(offset, offset + payloadLength);
    offset += payloadLength;
    let line = textDecoder.decode(payload).replace(/\n$/, "");
    if (!line) {
      continue;
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

  if (!sawFlush) {
    throw new ProtocolError("Missing command flush-pkt");
  }
  if (commands.length === 0) {
    throw new ProtocolError("No receive-pack commands found");
  }

  const request: ReceivePackRequest = {
    commands,
    capabilities
  };
  const packBytes = bytes.subarray(offset);
  if (packBytes.byteLength > 0) {
    request.packfile = packBytes;
  }
  return request;
}

export type ReceivePackRefStatus = {
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

function supportsSideBand(capabilities: Set<string>): boolean {
  return capabilities.has("side-band") || capabilities.has("side-band-64k");
}

function sideBandChunkSize(capabilities: Set<string>): number {
  if (capabilities.has("side-band-64k")) {
    return SIDE_BAND_64K_PAYLOAD_SIZE;
  }
  return SIDE_BAND_PAYLOAD_SIZE;
}

function encodeSideBandChunks(
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
  return uniqueAcks.map((oid) => encodeTextPktLine(`ACK ${oid}\n`));
}

export function encodeShallowLines(shallowOids: string[]): Uint8Array[] {
  return [...new Set(shallowOids.map((oid) => oid.toLowerCase()))]
    .filter((oid) => OID_REGEX.test(oid))
    .map((oid) => encodeTextPktLine(`shallow ${oid}\n`));
}

export function encodeProtocolError(
  message: string,
  capabilities?: Iterable<string>
): Uint8Array {
  const normalizedCapabilities = new Set(capabilities ?? []);
  const parts: Uint8Array[] = [];
  if (supportsSideBand(normalizedCapabilities)) {
    const maxPayload = sideBandChunkSize(normalizedCapabilities);
    parts.push(
      ...encodeSideBandChunks(3, textEncoder.encode(`ERR ${message}\n`), maxPayload)
    );
  } else {
    parts.push(encodeTextPktLine(`ERR ${message}\n`));
  }
  parts.push(encodeFlushPktLine());
  return concatBytes(parts);
}

export type UploadPackResponseArgs = {
  capabilities: Iterable<string>;
  ackOids?: string[];
  shallowOids?: string[];
  packfile?: Uint8Array;
  progressMessages?: string[];
  errorMessage?: string;
};

export function buildUploadPackResponse(args: UploadPackResponseArgs): Uint8Array {
  const capabilities = new Set(args.capabilities);
  const useSideBand = supportsSideBand(capabilities);
  const parts: Uint8Array[] = [];

  parts.push(...(args.packfile ? [encodeTextPktLine("NAK\n")] : encodeAckNak(args.ackOids ?? [])));
  parts.push(...encodeShallowLines(args.shallowOids ?? []));

  if (args.errorMessage) {
    if (useSideBand) {
      const maxPayload = sideBandChunkSize(capabilities);
      parts.push(
        ...encodeSideBandChunks(3, textEncoder.encode(`ERR ${args.errorMessage}\n`), maxPayload)
      );
    } else {
      parts.push(encodeTextPktLine(`ERR ${args.errorMessage}\n`));
    }
    parts.push(encodeFlushPktLine());
    return concatBytes(parts);
  }

  if (!args.packfile) {
    parts.push(encodeFlushPktLine());
    return concatBytes(parts);
  }

  if (!useSideBand) {
    parts.push(args.packfile);
    return concatBytes(parts);
  }

  const maxPayload = sideBandChunkSize(capabilities);
  for (const message of args.progressMessages ?? []) {
    parts.push(...encodeSideBandChunks(2, textEncoder.encode(message), maxPayload));
  }
  parts.push(...encodeSideBandChunks(1, args.packfile, maxPayload));
  parts.push(encodeFlushPktLine());
  return concatBytes(parts);
}

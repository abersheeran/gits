import { ProtocolError } from "./git-errors";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const MAX_PKT_LINE_LENGTH = 0xfff0;
const MAX_REQUEST_PKT_LINES = 20000;

function encodeLength(length: number): Uint8Array {
  return textEncoder.encode(length.toString(16).padStart(4, "0"));
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
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

export function parsePktLines(rawBody: Uint8Array): Uint8Array[] {
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

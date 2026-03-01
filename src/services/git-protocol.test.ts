import { describe, expect, it } from "vitest";
import {
  buildReceivePackReport,
  buildUploadPackResponse,
  encodeAckNak,
  encodeProtocolError,
  parseReceivePackRequest,
  parseUploadPackRequest
} from "./git-protocol";

function pktLine(line: string): Uint8Array {
  const bytes = new TextEncoder().encode(line);
  const total = bytes.length + 4;
  const out = new Uint8Array(total);
  out.set(new TextEncoder().encode(total.toString(16).padStart(4, "0")), 0);
  out.set(bytes, 4);
  return out;
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

type ParsedPktLine =
  | { kind: "flush" }
  | {
      kind: "data";
      payload: Uint8Array;
    };

function parsePktLines(raw: Uint8Array): ParsedPktLine[] {
  const lines: ParsedPktLine[] = [];
  let offset = 0;
  while (offset < raw.length) {
    const header = new TextDecoder().decode(raw.subarray(offset, offset + 4));
    const length = Number.parseInt(header, 16);
    offset += 4;
    if (length === 0) {
      lines.push({ kind: "flush" });
      continue;
    }
    const payloadLength = length - 4;
    const payload = raw.subarray(offset, offset + payloadLength);
    lines.push({ kind: "data", payload });
    offset += payloadLength;
  }
  return lines;
}

describe("git-protocol", () => {
  it("parses upload-pack request lines and options", () => {
    const req = concat(
      pktLine(
        "want 0123456789abcdef0123456789abcdef01234567 side-band-64k ofs-delta\n"
      ),
      pktLine("shallow bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n"),
      pktLine("deepen 1\n"),
      pktLine("filter blob:none\n"),
      pktLine("have aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"),
      pktLine("done\n"),
      new TextEncoder().encode("0000")
    );

    const parsed = parseUploadPackRequest(req.buffer);
    expect(parsed.wants).toEqual(["0123456789abcdef0123456789abcdef01234567"]);
    expect(parsed.haves).toEqual(["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    expect(parsed.done).toBe(true);
    expect(parsed.capabilities.has("side-band-64k")).toBe(true);
    expect(parsed.deepen).toBe(1);
    expect(parsed.filterSpec).toBe("blob:none");
    expect(parsed.clientShallows).toEqual(["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"]);
  });

  it("encodes ACK lines and side-band response with pack payload", () => {
    const ack = encodeAckNak(["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    expect(new TextDecoder().decode(ack[0])).toContain("ACK aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");

    const pack = new Uint8Array([1, 2, 3, 4, 5]);
    const response = buildUploadPackResponse({
      capabilities: ["side-band-64k"],
      ackOids: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      packfile: pack,
      progressMessages: ["packing objects\n"]
    });
    const lines = parsePktLines(response);
    expect(lines[0]?.kind).toBe("data");
    if (lines[0]?.kind !== "data") {
      throw new Error("expected data line");
    }
    expect(new TextDecoder().decode(lines[0].payload)).toBe(
      "ACK aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"
    );
    const sideBandLines = lines.filter(
      (line) => line.kind === "data" && (line.payload[0] === 1 || line.payload[0] === 2)
    );
    expect(sideBandLines.length).toBeGreaterThan(0);
    const firstData = sideBandLines.find(
      (line): line is Extract<ParsedPktLine, { kind: "data" }> =>
        line.kind === "data" && line.payload[0] === 1
    );
    expect(firstData).toBeTruthy();
    expect(firstData?.payload.subarray(1, 6)).toEqual(pack);
    expect(lines.at(-1)?.kind).toBe("flush");
  });

  it("encodes protocol ERR packet with side-band channel 3", () => {
    const payload = encodeProtocolError("filter unsupported", ["side-band-64k"]);
    const lines = parsePktLines(payload);
    const errLine = lines.find(
      (line): line is Extract<ParsedPktLine, { kind: "data" }> =>
        line.kind === "data" && line.payload[0] === 3
    );
    expect(errLine).toBeTruthy();
    const message = new TextDecoder().decode(errLine?.payload.subarray(1));
    expect(message).toContain("ERR filter unsupported");
  });

  it("throws when upload-pack request has no wants", () => {
    const req = concat(pktLine("done\n"), new TextEncoder().encode("0000"));
    expect(() => parseUploadPackRequest(req.buffer)).toThrow("No want lines found");
  });

  it("parses receive-pack command list and packfile bytes", () => {
    const commandLine =
      "0000000000000000000000000000000000000000 " +
      "0123456789abcdef0123456789abcdef01234567 refs/heads/main\0report-status delete-refs\n";
    const packBytes = new Uint8Array([0x50, 0x41, 0x43, 0x4b, 0x00, 0x01]);
    const req = concat(pktLine(commandLine), new TextEncoder().encode("0000"), packBytes);

    const parsed = parseReceivePackRequest(req.buffer);
    expect(parsed.commands).toHaveLength(1);
    expect(parsed.commands[0]?.refName).toBe("refs/heads/main");
    expect(parsed.capabilities.has("report-status")).toBe(true);
    expect(parsed.packfile).toEqual(packBytes);
  });

  it("encodes receive-pack report-status response", () => {
    const payload = buildReceivePackReport({
      capabilities: ["report-status"],
      refStatuses: [
        { refName: "refs/heads/main", ok: true },
        { refName: "refs/tags/v1.0.0", ok: false, message: "missing object" }
      ]
    });
    const text = new TextDecoder().decode(payload);
    expect(text).toContain("unpack ok\n");
    expect(text).toContain("ok refs/heads/main\n");
    expect(text).toContain("ng refs/tags/v1.0.0 missing object\n");
  });

  it("rejects requests with too many pkt-lines", () => {
    const chunks: Uint8Array[] = [pktLine("want 0123456789abcdef0123456789abcdef01234567\n")];
    for (let i = 0; i < 20000; i += 1) {
      chunks.push(pktLine("have aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n"));
    }
    chunks.push(pktLine("done\n"));
    chunks.push(new TextEncoder().encode("0000"));
    const req = concat(...chunks);

    expect(() => parseUploadPackRequest(req.buffer)).toThrow("Too many pkt-lines");
  });
});

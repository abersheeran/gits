import type { GitServiceName } from "../types";
import { encodeFlushPktLine, encodeTextPktLine } from "./git-protocol";

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function resolveHeadRef(
  refs: Array<{ name: string; oid: string }>,
  storedHead: string | null
): { headRef: string | null; headOid: string | null } {
  let headRef: string | null = null;
  if (storedHead?.startsWith("ref: ")) {
    const parsed = storedHead.slice("ref: ".length).trim();
    if (parsed.startsWith("refs/")) {
      headRef = parsed;
    }
  }

  if (!headRef) {
    const main = refs.find((item) => item.name === "refs/heads/main");
    headRef = main?.name ?? refs[0]?.name ?? null;
  }

  const headOid =
    (headRef && refs.find((item) => item.name === headRef)?.oid) ?? refs[0]?.oid ?? null;

  return { headRef, headOid };
}

function capabilityListFor(service: GitServiceName, headRef: string | null): string {
  if (service === "git-upload-pack") {
    const capabilities = [
      "multi_ack_detailed",
      "no-done",
      "side-band",
      "side-band-64k",
      "ofs-delta",
      "shallow",
      "filter",
      "allow-reachable-sha1-in-want",
      "agent=gits/0.1"
    ];
    if (headRef) {
      capabilities.unshift(`symref=HEAD:${headRef}`);
    }
    return capabilities.join(" ");
  }
  return "report-status side-band-64k delete-refs ofs-delta agent=gits/0.1";
}

export function buildInfoRefsResponse(args: {
  service: GitServiceName;
  refs: Array<{ name: string; oid: string }>;
  storedHead: string | null;
}): Response {
  const { headRef, headOid } = resolveHeadRef(args.refs, args.storedHead);
  const capabilities = capabilityListFor(args.service, headRef);
  const advertisedRefs =
    headOid !== null ? [{ name: "HEAD", oid: headOid }, ...args.refs] : args.refs;
  const chunks: Uint8Array[] = [
    encodeTextPktLine(`# service=${args.service}\n`),
    encodeFlushPktLine()
  ];

  if (advertisedRefs.length === 0) {
    chunks.push(
      encodeTextPktLine(
        `0000000000000000000000000000000000000000 capabilities^{}\0${capabilities}\n`
      )
    );
    chunks.push(encodeFlushPktLine());
  } else {
    advertisedRefs.forEach((ref, index) => {
      const suffix = index === 0 ? `\0${capabilities}` : "";
      chunks.push(encodeTextPktLine(`${ref.oid} ${ref.name}${suffix}\n`));
    });
    chunks.push(encodeFlushPktLine());
  }

  const payload = concatChunks(chunks);
  const body = new Uint8Array(payload.byteLength);
  body.set(payload);
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": `application/x-${args.service}-advertisement`,
      "Cache-Control": "no-store"
    }
  });
}

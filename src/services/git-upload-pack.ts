import { NegotiationLimitError, ProtocolError } from "./git-errors";
import { parsePackObjectFilter } from "./git-pack-filter";
import {
  buildUploadPackNegotiationResponse,
  concatBytes,
  encodeFlushPktLine,
  encodeShallowLines,
  parseUploadPackRequest
} from "./git-protocol";
import { ObjectStore } from "./git-store/object-store";
import { createPackStream, type PackSelection } from "./git-store/pack-writer";
import { RefStore } from "./git-store/ref-store";
import {
  computeCommitSetForPack,
  computeObjectClosureForPack,
  findCommonHaves,
  resolveWants
} from "./git-upload-pack-negotiation";
import { createUploadPackResponse } from "./git-upload-response";

export async function uploadPack(store: ObjectStore, refs: RefStore, body: ArrayBuffer) {
  const request = parseUploadPackRequest(body);
  const filter = parsePackObjectFilter(request.filterSpec);
  if (request.deepen !== undefined && request.deepen > 10000) {
    throw new ProtocolError("deepen exceeds maximum (10000)");
  }
  const resolved = await resolveWants({ store, refs, wants: request.wants });
  const common = await findCommonHaves({
    store,
    refs,
    wantCommits: resolved.commitWants,
    haves: request.haves
  });
  const noDone =
    request.capabilities.has("no-done") && request.capabilities.has("multi_ack_detailed");
  const deepen =
    request.deepen !== undefined ||
    request.deepenSince !== undefined ||
    request.deepenNot.length > 0;
  const commitArgs = {
    store,
    refs,
    wantCommits: resolved.commitWants,
    commonOids: common,
    ...(request.deepen !== undefined ? { deepen: request.deepen } : {}),
    ...(request.deepenSince !== undefined ? { deepenSince: request.deepenSince } : {}),
    ...(request.deepenNot.length ? { deepenNot: request.deepenNot } : {})
  };
  const shallowSelection = deepen ? await computeCommitSetForPack(commitArgs) : undefined;
  const preamble = shallowSelection
    ? [...encodeShallowLines(shallowSelection.shallowOids), encodeFlushPktLine()]
    : [];
  if (!request.done && (!noDone || !common.length)) {
    const negotiation =
      deepen && request.haves.length === 0 ? [] : [buildUploadPackNegotiationResponse(common)];
    return new Response(Uint8Array.from(concatBytes([...preamble, ...negotiation])));
  }
  const all: PackSelection = {
    kind: "all",
    maxRowid: store.maxRowid(),
    ...(filter?.blobNone ? { excludeBlobs: true } : {}),
    ...(filter?.blobLimitBytes !== undefined ? { blobMaxSize: filter.blobLimitBytes } : {})
  };
  let selection: PackSelection = all;
  let shallowOids: string[] = [];
  if (common.length || deepen || request.clientShallows.length || !resolved.commitWants.length) {
    try {
      const commits = shallowSelection ?? (await computeCommitSetForPack(commitArgs));
      shallowOids = commits.shallowOids;
      const oids = await computeObjectClosureForPack({
        store,
        refs,
        commitOids: commits.commitOids,
        commonOids: common,
        clientShallows: request.clientShallows,
        extraOids: resolved.extraObjectWants,
        ...(filter ? { filter } : {})
      });
      selection = { kind: "oids", oids };
    } catch (error) {
      if (!(error instanceof NegotiationLimitError) || deepen) {
        throw error;
      }
      selection = all;
      shallowOids = [];
    }
  }
  const pack = createPackStream(store, selection);
  const response = createUploadPackResponse({
    capabilities: request.capabilities,
    ackOids: common,
    shallowOids: deepen ? [] : shallowOids,
    preamble,
    pack: pack.stream,
    ...(noDone && !request.done && common.length
      ? {
          ackLines: [
            ...common.map((oid) => `ACK ${oid} common\n`),
            `ACK ${common.at(-1)} ready\n`,
            "NAK\n",
            `ACK ${common.at(-1)}\n`
          ]
        }
      : {}),
    progressMessages: [`counting objects: ${pack.count}\n`, "pack complete\n"]
  });
  return new Response(response);
}

import { gzip } from "pako";
import { afterEach, expect, it, vi } from "vitest";
import app from "../app";
import { AuthService } from "../services/auth-service";
import { objectHash } from "../services/git-store/object-format";
import { RefStore } from "../services/git-store/ref-store";
import { makePack } from "../services/git-store/test-helpers";
import { seedSampleRepositoryToR2 } from "../test-utils/git-fixture";
import {
  concat,
  createEnv,
  createPublicRepositoryDb,
  pktLine,
  containsPackSignature
} from "../test-utils/git-integration-fixture";
import { MockR2Bucket } from "../test-utils/mock-r2";
import { repositoryState } from "../test-utils/mock-repository-object-namespace";

const encoder = new TextEncoder();
const flush = encoder.encode("0000");
const auth = `Basic ${Buffer.from("alice:pat-ok").toString("base64")}`;
afterEach(() => {
  vi.restoreAllMocks();
});

async function fixture() {
  const bucket = new MockR2Bucket();
  const seeded = await seedSampleRepositoryToR2(bucket, "alice", "demo");
  const env = createEnv(createPublicRepositoryDb("alice", "demo"), bucket as unknown as R2Bucket);
  vi.spyOn(AuthService.prototype, "verifyAccessToken").mockResolvedValue({
    id: "user-1",
    username: "alice"
  });
  const upload = concat(pktLine(`want ${seeded.latestCommit}\n`), pktLine("done\n"), flush);
  const content = encoder.encode("a new tagged blob");
  const oid = objectHash("blob", content);
  const receive = concat(
    pktLine(`${"0".repeat(40)} ${oid} refs/tags/new\0report-status\n`),
    flush,
    makePack([{ type: 3, content }])
  );
  return { env, upload, receive, oid };
}

function request(service: string, bytes: Uint8Array, encoding = "gzip") {
  return new Request(`http://localhost/alice/demo/git-${service}-pack`, {
    method: "POST",
    headers: {
      authorization: auth,
      "content-type": `application/x-git-${service}-pack-request`,
      "content-encoding": encoding,
      "content-length": String(bytes.byteLength)
    },
    body: Uint8Array.from(bytes)
  });
}

it("decodes gzip upload-pack and receive-pack bodies before parsing Git commands", async () => {
  const { env, upload, receive, oid } = await fixture();
  const fetched = await app.fetch(request("upload", gzip(upload)), env);
  expect(fetched.status).toBe(200);
  expect(containsPackSignature(new Uint8Array(await fetched.arrayBuffer()))).toBe(true);
  const pushed = await app.fetch(request("receive", gzip(receive), "GZip"), env);
  expect(pushed.status).toBe(200);
  expect(await pushed.text()).toContain("ok refs/tags/new\n");
  const refs = new RefStore(repositoryState(env.REPOSITORY_OBJECTS, "repo-1").storage);
  expect(refs.getRef("refs/tags/new")).toBe(oid);
});

it.each(["upload", "receive"])(
  "limits decompressed %s-pack bytes rather than compressed length",
  async (service) => {
    const { env, upload, receive } = await fixture();
    const decoded = concat(service === "upload" ? upload : receive, new Uint8Array(20000));
    const compressed = gzip(decoded);
    expect(compressed.length).toBeLessThan(512);
    env.UPLOAD_PACK_MAX_BODY_BYTES = "512";
    env.RECEIVE_PACK_MAX_BODY_BYTES = "512";
    const response = await app.fetch(request(service, compressed), env);
    expect(response.status).toBe(413);
  }
);

it("does not apply the decoded limit to gzip's larger wire Content-Length", async () => {
  const { env } = await fixture();
  const decoded = encoder.encode("0000");
  const compressed = gzip(decoded);
  expect(compressed.length).toBeGreaterThan(decoded.length);
  env.UPLOAD_PACK_MAX_BODY_BYTES = String(decoded.length);
  const response = await app.fetch(request("upload", compressed), env);
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("ERR No want lines found");
});

it.each(["upload", "receive"])(
  "rejects unsupported %s-pack Content-Encoding with 415",
  async (service) => {
    const { env, upload, receive } = await fixture();
    for (const encoding of ["br", "deflate", "gzip, br", "identity"]) {
      const response = await app.fetch(
        request(service, service === "upload" ? upload : receive, encoding),
        env
      );
      expect(response.status).toBe(415);
    }
  }
);

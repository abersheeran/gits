import { createPrivateKey } from "node:crypto";
import { jwtVerify } from "jose";
import { afterEach, expect, it, vi } from "vitest";
import { githubAppKeys } from "../../test-utils/github-app-keys";
import { githubFixture } from "../../test-utils/github-fixture";
import {
  clearInstallationToken, createAppJwt, getInstallation, installationClient, installationToken
} from "./app-auth";
import { importAppPrivateKey } from "./private-key";

afterEach(() => vi.useRealTimers());

it("imports PKCS#8, PKCS#1 and base64 PEM and signs verifiable JWTs", async () => {
  const { env } = await githubFixture();
  const { privateKey, publicKey } = await githubAppKeys();
  const pkcs1 = createPrivateKey(privateKey).export({ format: "pem", type: "pkcs1" }).toString();
  const inputs = [privateKey, pkcs1, btoa(privateKey), btoa(pkcs1)];
  vi.useFakeTimers();
  const now = Math.floor(Date.now() / 1000);
  for (const input of inputs) {
    env.GITHUB_APP_PRIVATE_KEY = input;
    const token = await createAppJwt(env);
    const { payload, protectedHeader } = await jwtVerify(token, publicKey);
    expect(protectedHeader.alg).toBe("RS256");
    expect(payload).toEqual({ iss: env.GITHUB_APP_CLIENT_ID, iat: now - 60, exp: now + 540 });
    expect(await importAppPrivateKey(input)).toBe(await importAppPrivateKey(input));
  }
  await expect(importAppPrivateKey("invalid secret contents")).rejects.toThrow(
    "Invalid GitHub App private key"
  );
});

it("caches tokens, refreshes five minutes before expiry and clears rejected tokens", async () => {
  const { env, fetcher, respond } = await githubFixture();
  vi.useFakeTimers();
  const now = Date.now();
  await installationToken(env, 100);
  await installationToken(env, 100);
  expect(fetcher).toHaveBeenCalledOnce();
  vi.setSystemTime(now + 55 * 60000);
  await installationToken(env, 100);
  expect(fetcher).toHaveBeenCalledTimes(2);
  const client = await installationClient(env, 100);
  fetcher.mockResolvedValueOnce(new Response("", { status: 401 }));
  await expect(client.repositories()).rejects.toMatchObject({ kind: "unauthorized" });
  await installationToken(env, 100);
  expect(fetcher).toHaveBeenCalledTimes(4);
  clearInstallationToken(env, 100);
  fetcher.mockResolvedValueOnce(new Response("", { status: 401 }));
  await expect(installationToken(env, 100)).rejects.toMatchObject({ kind: "unauthorized" });
  fetcher.mockImplementation(respond);
  await installationToken(env, 100);
  expect(fetcher).toHaveBeenCalledTimes(6);
});

it.each([[404, "installation_deleted"], [403, "installation_suspended"]])(
  "classifies installation HTTP %s", async (status, kind) => {
    const { env, fetcher } = await githubFixture();
    fetcher.mockImplementation(async () => new Response("", { status }));
    await expect(installationToken(env, 100)).rejects.toMatchObject({ kind });
    await expect(getInstallation(env, 100)).rejects.toMatchObject({ kind });
  }
);

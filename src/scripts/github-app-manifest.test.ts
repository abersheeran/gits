import { expect, it } from "vitest";
import { appManifest, conversionSecrets, updateEnv } from "../../scripts/github-app-manifest.mjs";

it("creates the exact public App manifest with callback, setup, hooks and read permissions", () => {
  expect(appManifest("https://gits.example/", "http://127.0.0.1:1234/callback")).toEqual({
    name: "gits-gits.example", url: "https://gits.example",
    hook_attributes: { url: "https://gits.example/api/github/webhook" },
    redirect_url: "http://127.0.0.1:1234/callback",
    callback_urls: ["https://gits.example/api/github/oauth/callback"],
    setup_url: "https://gits.example/api/github/setup", setup_on_update: true, public: true,
    default_permissions: { contents: "read", metadata: "read", members: "read" },
    default_events: ["push", "repository"], request_oauth_on_install: false
  });
  expect(() => appManifest("https://user:secret@gits.example", "callback")).toThrow();
});

it("maps conversion results to six secrets and updates env while preserving other settings", () => {
  const secrets = conversionSecrets({
    id: 1, slug: "gits-example", client_id: "client", client_secret: "secret$&",
    webhook_secret: "hook", pem: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----"
  });
  expect(Object.keys(secrets)).toHaveLength(6);
  expect(secrets.GITHUB_APP_ID).toBe("1");
  expect(secrets.GITHUB_APP_PRIVATE_KEY).not.toContain("\n");
  expect(Buffer.from(secrets.GITHUB_APP_PRIVATE_KEY, "base64").toString())
    .toContain("BEGIN PRIVATE KEY");
  const current = "OTHER_SECRET=keep\r\nGITHUB_APP_CLIENT_SECRET=old\r\n";
  const updated = updateEnv(current, secrets);
  expect(updated).toContain("OTHER_SECRET=keep\n");
  expect(updated).toContain("GITHUB_APP_CLIENT_SECRET=secret$&\n");
  expect(updated.match(/^GITHUB_APP_CLIENT_SECRET=/gm)).toHaveLength(1);
  expect(updateEnv(updated, secrets)).toBe(updated);
  expect(() => conversionSecrets({ id: 0 })).toThrow("Invalid GitHub App conversion response");
});

it("keeps the default App name within GitHub's limit for tunnel hostnames", () => {
  const origin = "https://ceiling-clouds-facing-fluid.trycloudflare.com";
  const manifest = appManifest(origin, "http://127.0.0.1:1234/callback");
  expect(manifest.name).toHaveLength(34);
  expect(manifest.url).toBe(origin);
  expect(manifest.callback_urls).toEqual([`${origin}/api/github/oauth/callback`]);
});

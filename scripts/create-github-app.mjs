import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { appManifest, conversionSecrets, updateEnv } from "./github-app-manifest.mjs";

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function openBrowser(url) {
  const command = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "explorer.exe" : "xdg-open";
  const child = spawn(command, [url], { stdio: "ignore", detached: true });
  child.on("error", () => {
    console.log("Open the printed local URL in your browser to continue.");
  });
  child.unref();
}

async function saveSecrets(target, secrets) {
  if (target === "dev") {
    let current = "";
    try {
      current = await readFile(".env", "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw new Error("Cannot read .env");
      }
    }
    await writeFile(".env", updateEnv(current, secrets), { mode: 0o600 });
    return;
  }
  for (const [name, value] of Object.entries(secrets)) {
    await new Promise((resolve, reject) => {
      const child = spawn("npx", ["wrangler", "secret", "put", name], {
        stdio: ["pipe", "ignore", "ignore"],
        shell: process.platform === "win32"
      });
      child.once("error", () => reject(new Error(`Cannot set ${name}`)));
      child.once("exit", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Cannot set ${name}`));
        }
      });
      child.stdin.on("error", () => reject(new Error(`Cannot set ${name}`)));
      child.stdin.end(value + "\n");
    });
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    url: { type: "string" }, target: { type: "string" }, org: { type: "string" },
    "no-open": { type: "boolean", default: false }
  } });
  if (!values.url || !["prod", "dev"].includes(values.target)) {
    throw new Error("Expected --url <origin> --target <prod|dev> [--org <org>]");
  }
  appManifest(values.url, "http://127.0.0.1/callback");
  const state = crypto.randomUUID();
  let manifest;
  let used = false;
  let finish;
  const finished = new Promise((resolve) => {
    finish = resolve;
  });
  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url, "http://127.0.0.1");
      response.setHeader("Cache-Control", "no-store");
      if (request.method === "GET" && url.pathname === "/") {
        const path = values.org
          ? `/organizations/${encodeURIComponent(values.org)}/settings/apps/new`
          : "/settings/apps/new";
        const action = `https://github.com${path}?state=${state}`;
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(`<!doctype html><title>Register GitHub App</title>
          <form method="post" action="${escapeHtml(action)}">
          <input type="hidden" name="manifest" value="${escapeHtml(JSON.stringify(manifest))}">
          <button>Register GitHub App</button></form><script>document.forms[0].submit()</script>`);
        return;
      }
      if (url.pathname !== "/callback" || url.searchParams.get("state") !== state ||
        !url.searchParams.get("code") || used || request.method !== "GET") {
        response.writeHead(400).end("Invalid or expired registration callback");
        return;
      }
      used = true;
      const code = encodeURIComponent(url.searchParams.get("code"));
      const conversion = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
        method: "POST", redirect: "manual",
        headers: { Accept: "application/vnd.github+json", "User-Agent": "gits",
          "X-GitHub-Api-Version": "2022-11-28" }
      });
      if (!conversion.ok) {
        await conversion.body?.cancel();
        throw new Error("GitHub App registration conversion failed");
      }
      const secrets = conversionSecrets(await conversion.json());
      await saveSecrets(values.target, secrets);
      console.log(`App registered: https://github.com/apps/${secrets.GITHUB_APP_SLUG}`);
      console.log("Next: install the App on GitHub, select repositories, then return to gits.");
      response.end("GitHub App registered. Return to the terminal for next steps.");
      finish();
    })().catch(() => {
      response.writeHead(500).end("Registration failed. Check the terminal and try again.");
      console.error("App registration failed; verify GitHub and Wrangler access, then retry.");
      process.exitCode = 1;
      finish();
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  manifest = appManifest(values.url, `${origin}/callback`);
  console.log(`Open ${origin} to register the GitHub App.`);
  if (!values["no-open"]) openBrowser(origin);
  const timer = setTimeout(() => {
    console.error("GitHub App registration timed out. Run the command again to retry.");
    process.exitCode = 1;
    finish();
  }, 10 * 60 * 1000);
  await finished;
  clearTimeout(timer);
  await new Promise((resolve) => server.close(resolve));
}

main().catch(() => {
  console.error("Cannot register GitHub App. Check --url, --target and --org, then retry.");
  process.exitCode = 1;
});

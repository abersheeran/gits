# gits

A personal Git repository host built on Cloudflare Workers, focused on Git storage, repository management, and code browsing.

## Features

- **Git hosting** — Smart HTTP clone, fetch, and push, with shallow clone and object filters. Each repository stores Git objects and refs in its Durable Object SQLite database; packs stream in and out without loading the entire repository. R2 is used only to import legacy repositories.
- **GitHub sync** — Install a GitHub App to mirror personal or organization repositories, with Webhook updates. Mirrors are read-only until you stop synchronization.
- **Authentication** — Register, login, logout, revocable server-side sessions and login device management, and Personal Access Tokens (PAT). Git Basic Auth uses a username and PAT.
- **Repositories** — Create, rename, update visibility and description, delete, and manage collaborators with `read / write / admin` permissions.
- **Branches** — Owners can create and delete branches and set the default branch through the web UI or API.
- **Code browsing** — README, directory trees, text files, paginated commits, commit details with diffs, and path history.

Repositories belong to individuals. Git access is HTTP only and file browsing is read-only. GitHub organization repositories can sync into a personal namespace. Issues, pull requests, CI, SSH, Git LFS, code search, and branch protection are out of scope; see the [scope definition](prd/README.md#2-功能边界).

## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | Cloudflare Workers |
| Backend | Hono, TypeScript |
| Metadata | Cloudflare D1 (SQLite) |
| Git storage | Per-repository Durable Object SQLite; R2 for legacy import only |
| Repository state | `RepositoryObject` Durable Object, SQLite refs and bounded object cache |
| Frontend | React 19, React Router v7, Vite |
| UI | shadcn/ui, Tailwind CSS, Monaco Editor |
| Git | SQLite object store, streaming pack processing with pako |

Repository data is read on demand; clone and push stream pack data. Full object resolution is
limited to 32 MiB, while previews of full objects read only a prefix. Storage remains subject to
the SQLite Durable Object capacity limit of 10 GB per repository, and request CPU time is
configured to 300,000 ms.

## Quick Start

Use Node.js 22.12+ with npm and Git.

```bash
npm install
npm --prefix web install
cp .env.example .env
npm run build:web
npm run dev
```

`npm run dev` applies local D1 migrations and starts the Worker with `.env`. The initial build supplies the static assets configured in `wrangler.jsonc`.

In another terminal:

```bash
npm run dev:web
```

Open the URL printed by Vite. Its proxy sends API, health, and Git requests to `http://127.0.0.1:8787`; keep the Worker on that port for this setup.

## Configuration

### Environment Variables

The local `.env` template contains:

```dotenv
ALLOW_USER_REGISTRATION=true
```

| Variable | Behavior |
| --- | --- |
| `GITHUB_APP_ID` | GitHub App numeric ID |
| `GITHUB_APP_SLUG` | GitHub App URL slug |
| `GITHUB_APP_CLIENT_ID` | App OAuth client ID and JWT issuer |
| `GITHUB_APP_CLIENT_SECRET` | App OAuth client secret |
| `GITHUB_APP_PRIVATE_KEY` | PKCS#1 or PKCS#8 PEM, or base64-encoded PEM |
| `GITHUB_APP_WEBHOOK_SECRET` | Webhook HMAC verification secret |
| `ALLOW_USER_REGISTRATION` | `true` (case-insensitive) enables registration; any other value or unset disables it |
| `UPLOAD_PACK_MAX_BODY_BYTES` | Fetch request body limit; defaults to 8 MiB |
| `RECEIVE_PACK_MAX_BODY_BYTES` | Optional push request body limit; unset means platform limits only |

Local `.env` values are loaded by the development script. Configure production variables separately. Login sessions do not require a signing secret. All six GitHub App settings are required to enable synchronization.

### Cloudflare Bindings

| Binding | Configuration |
| --- | --- |
| `DB` | Production D1 `gits`; Preview D1 `gits-preview`; IDs configured in [wrangler.jsonc](wrangler.jsonc) |
| `GIT_BUCKET` | Legacy import only; production R2 `gits`, Preview R2 `gits-preview` |
| `REPOSITORY_OBJECTS` | `RepositoryObject`; each Preview gets its own namespace and storage |
| `ASSETS` | Frontend build from `web/dist` |

## Deployment

### Resources and One-off Secrets

Create separate production and Preview resources:

```bash
npx wrangler login
# Production
npm run d1:create:remote
npx wrangler r2 bucket create gits
# Previews
npx wrangler d1 create gits-preview
npx wrangler r2 bucket create gits-preview
```

Copy the returned production D1 ID into `wrangler.jsonc` → `d1_databases[0].database_id`. Copy the Preview D1 ID into both `wrangler.jsonc` → `previews.d1_databases[0].database_id` and `wrangler.preview-migrations.jsonc` → `d1_databases[0].database_id`; both Preview entries must point at the same database.

Login uses random, server-side sessions stored in D1. When upgrading, apply migration
`0003_user_sessions.sql` before deploying the new Worker (the deploy scripts do this automatically).
Existing JWT sessions are invalidated; users must log in again. Existing PATs remain valid.
`JWT_SECRET` is no longer used. GitHub App authentication still uses GitHub's required App JWTs.

### Workers Builds + Worker Previews

Connect this repository to the `gits` Worker in Workers Builds, select the production branch, and enable **Preview builds** for all other branches. Use the repository root and these commands:

| Setting | Command |
| --- | --- |
| Build | `npm ci && npm --prefix web ci && npm run build` |
| Deploy (production branch) | `npm run deploy` |
| Preview (all other branches) | `npm run preview` |

Worker Previews require the project's Wrangler dependency to be at least 4.135.0; a global installation is not used. Preview URLs use `<branch>-gits.<subdomain>.workers.dev`.

`npm run preview` first migrates the preview D1 database using `wrangler.preview-migrations.jsonc`, then runs `wrangler preview`. All branches share the preview D1/R2 resources, isolated from production; DO storage is separate per Preview. The `previews` block explicitly sets `DB`, `GIT_BUCKET`, `REPOSITORY_OBJECTS`, and `ALLOW_USER_REGISTRATION="true"` because production settings are not inherited. Assets, compatibility settings, and DO migrations remain top-level. See [Cloudflare Preview configuration](https://developers.cloudflare.com/workers/previews/configuration/).

Production Cron checks for due discovery and mirror tasks every five minutes. Webhooks trigger updates immediately; a full discovery every six hours provides a fallback. Worker Previews do not support GitHub synchronization: the App has one Webhook and Setup URL pointing at production. Do not configure App secrets or Cron under `previews`.

### Deploy to Cloudflare

```bash
npm run deploy -- --var ALLOW_USER_REGISTRATION:true
```

The script applies remote D1 migrations, builds the frontend, then deploys the Worker with `--keep-vars`. For later deployments with existing production variables:

```bash
npm run deploy
```

To close registration, set the production registration variable to any value other than `true`, or remove it. Check `GET /healthz` or `GET /api/healthz` after deployment.

### Apply Migrations Separately

```bash
npm run db:migrate:local
npm run db:migrate
npm run db:migrate:preview
```

These target local D1, production D1, and preview D1 respectively.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` / `npm run dev:api` | Apply local migrations and start the Worker |
| `npm run dev:web` | Start Vite |
| `npm run build` / `npm run build:web` | Build the frontend |
| `npm run deploy` | Apply remote migrations, build frontend, deploy Worker |
| `npm run preview` | Apply preview D1 migrations, deploy Worker Preview (requires frontend build) |
| `npm run db:migrate:preview` | Apply remote migrations to `gits-preview` |
| `npm run typecheck` | Check backend TypeScript |
| `npm run test` / `npm run test:watch` | Run tests once / watch for changes |
| `npm run cf-typegen` | Generate Cloudflare binding types |
| `npm run d1:create:remote` | Create the remote D1 database named `gits` |
| `npm run db:migrate:local` / `npm run db:migrate` | Apply local / remote D1 migrations |
| `npm run secret:dev:set -- KEY FILE` | Prompt for a local variable and write it to the specified file |
| `npm run github-app:create -- --url <origin> --target <prod\|dev> [--org <org>]` | Register a GitHub App and save its six credentials |

## Project Structure

```text
gits/
├── src/
│   ├── routes/api/         # Auth, repository management and browsing
│   ├── routes/git.ts       # Smart HTTP endpoints
│   ├── services/           # Git, storage, repository state and auth
│   ├── middleware/         # Auth and error handling
│   └── db/migrations/      # D1 migrations
├── web/
│   └── src/
│       ├── pages/          # React route pages
│       ├── components/     # UI components
│       └── lib/            # API client and utilities
├── scripts/                # Local secret configuration
├── prd/                    # Product requirements
├── docs/                   # Usage guide
└── wrangler.jsonc          # Worker configuration
```

## API Overview

### Health, Auth and Tokens

- `GET /healthz`, `GET /api/healthz` — Health checks
- `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout` — Account access
- `GET /api/me` — Current user
- `POST /api/auth/tokens`, `GET /api/auth/tokens` — Create and list PATs
- `DELETE /api/auth/tokens/:tokenId` — Revoke a PAT
- `GET /api/auth/sessions?page=1` — List active login devices, 20 per page
- `DELETE /api/auth/sessions/:sessionId` — Revoke another login session
- `DELETE /api/auth/sessions` — Revoke every other session, keeping the current one

API authentication accepts the login cookie or Bearer session tokens/PATs. Public repository reads do not require authentication.
Sessions expire after seven days. Logout revokes the server-side session. Manage devices at
`/sessions`; revoking a device blocks subsequent requests using its token. Device management
requires a login session, not a PAT. API responses are not cached, and cross-origin mutations
are rejected. Browser/OS labels come from User-Agent and identify login sessions, not physical devices.

### Repositories and Collaborators

- `GET /api/public/repos` — Public repositories (`limit`)
- `GET /api/repos`, `POST /api/repos` — List accessible repositories / create a repository
- `GET /api/repos/:owner/:repo` — Repository detail (`ref`), including the viewer's `viewerPermission`
- `PATCH /api/repos/:owner/:repo`, `DELETE /api/repos/:owner/:repo` — Update / delete, owner only
- `GET /api/repos/:owner/:repo/collaborators`, `PUT /api/repos/:owner/:repo/collaborators` — List / add or update collaborators
- `DELETE /api/repos/:owner/:repo/collaborators/:username` — Remove a collaborator

Collaborator management requires the owner or an `admin` collaborator. Repository settings and deletion require the owner.

### Branches and Code

- `GET /api/repos/:owner/:repo/branches` — List branches
- `POST /api/repos/:owner/:repo/branches` — Create from `branchName` and an existing commit `sourceOid`, owner only
- `PATCH /api/repos/:owner/:repo/default-branch` — Set `branchName` as default, owner only
- `DELETE /api/repos/:owner/:repo/branches/:branch` — Delete a non-default branch, owner only; URL-encode the branch name
- `GET /api/repos/:owner/:repo/contents` — Directory or file (`ref`, `path`)
- `GET /api/repos/:owner/:repo/commits` — Commit history (`ref`, `page`, `limit`)
- `GET /api/repos/:owner/:repo/commits/:oid` — Commit detail
- `GET /api/repos/:owner/:repo/history` — Path history (required `path`, optional `ref`, `limit`)

### GitHub Synchronization

Register an App for this instance:

```bash
npm run github-app:create -- --url https://git.example.com --target prod
# For a development instance with its own publicly reachable callback and Webhook URL:
npm run github-app:create -- --url https://dev-git.example.com --target dev
# Add --org <organization> to register the App under an organization.
```

The command opens a local registration page, completes GitHub's App Manifest flow and saves
all six credentials. `prod` uses Wrangler secret prompts via stdin; `dev` updates `.env`, with
the private key encoded as one base64 line. Secret values are not printed. The registrar's
loopback callback is temporary; the App's OAuth callback, Setup URL and Webhook target the instance.
Add `--no-open` to open the printed registration URL in a browser of your choice. The suggested
App name is capped at GitHub's 34-character limit and can be edited on the registration page.

For manual registration, choose **Any account** (public installation) and configure:

| Setting | Value |
| --- | --- |
| Homepage | `https://git.example.com` |
| User authorization callback | `https://git.example.com/api/github/oauth/callback` |
| Setup URL | `https://git.example.com/api/github/setup`; redirect on update enabled |
| Webhook URL | `https://git.example.com/api/github/webhook`; Webhook enabled |
| Repository permissions | Contents: read; Metadata: read |
| Organization permissions | Members: read |
| Events | `push`, `repository`; installation events are delivered automatically |
| Request user authorization during installation | Disabled; gits starts OAuth from Setup |

Set each of the six `GITHUB_APP_*` secrets listed above using `npx wrangler secret put <NAME>`
(or the corresponding local `.env` value). Private keys can be GitHub's PKCS#1 PEM or PKCS#8 PEM,
including base64-encoded PEM. Worker Previews are not supported.

Users select **Add account or organization**, install the App on GitHub, choose all or selected
repositories, and return to gits for automatic binding. **Link existing installation** starts
OAuth directly. Only the account owner can bind a personal installation; organizations require
an active organization administrator. Each installation belongs to one gits user. Repeat binding
refreshes account metadata without resetting sync settings. Repository selection stays on GitHub.

Signed Webhooks request synchronization, while six-hour discovery recovers missed events.
User access tokens are never stored; installation access tokens remain only in memory and refresh
five minutes before expiry. Unbinding preserves local repositories and restores writes without
uninstalling the App. Uninstalling on GitHub also unbinds automatically.

| Method and path | Purpose |
| --- | --- |
| `GET /api/github/sources` | `{ configured, installUrl, sources }` with source summaries |
| `GET /api/github/authorize` | Browser redirect to GitHub OAuth using state and PKCE |
| `GET /api/github/setup` | Installation return URL; login or OAuth redirect |
| `GET /api/github/oauth/callback` | Bind eligible installations; redirect to `/sync` |
| `POST /api/github/webhook` | HMAC-authenticated events, no gits login required |
| `GET /api/github/sources/:sourceId` | Settings and state counts |
| `PATCH /api/github/sources/:sourceId` | Update prefix, filters, visibility or pause |
| `DELETE /api/github/sources/:sourceId` | Unbind; preserve local repositories |
| `POST /api/github/sources/:sourceId/sync` | Discover and dispatch immediately |
| `GET /api/github/sources/:sourceId/repositories` | `status` and `page`, 50 per page |
| `PATCH /api/github/sources/:sourceId/repositories/:githubRepoId` | `selection` or `localName` |
| `POST /api/repos/:owner/:repo/mirror/sync` | Sync a mirror, owner only |
| `DELETE /api/repos/:owner/:repo/mirror` | Stop syncing and restore writes, owner only |

JSON endpoints require login and return only the current user's sources. Times are milliseconds.
OAuth returns `bound=<count>` and repeated `skipped=<login>:<reason>` (`not_owner`, `not_admin`,
`taken`); failures return `error=state|denied|github|not_configured|pending_approval`.
Repository details include `mirror` (or `null`); lists include `is_mirror` (0 or 1).
Mirrors reject push with 403 and reject branch or metadata edits with 409; renaming is allowed.

### Git (Smart HTTP)

- `GET /:owner/:repo.git/info/refs?service=git-upload-pack` — Read reference discovery
- `GET /:owner/:repo.git/info/refs?service=git-receive-pack` — Write reference discovery
- `POST /:owner/:repo.git/git-upload-pack` — Fetch
- `POST /:owner/:repo.git/git-receive-pack` — Push

The `.git` suffix is optional. Push requires Basic Auth with a PAT and repository write permission.

## Documentation

- [Product requirements](prd/)
- [中文使用文档](docs/USAGE.zh-CN.md)

## License

Private

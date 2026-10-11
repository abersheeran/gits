# gits

A personal Git repository host built on Cloudflare Workers, focused on Git storage, repository management, and code browsing.

## Features

- **Git hosting** — Smart HTTP clone, fetch, and push, with shallow clone and object filters. Each repository stores Git objects and refs in its Durable Object SQLite database; packs stream in and out without loading the entire repository. R2 is used only to import legacy repositories.
- **GitHub sync** — Connect GitHub PATs and mirror personal or organization repositories. Mirrors are read-only until you stop synchronization.
- **Authentication** — Register, login, logout, JWT sessions, and Personal Access Tokens (PAT). Git Basic Auth uses a username and PAT.
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
npm run secret:dev
npm run build:web
npm run dev
```

Enter local JWT and GitHub token encryption secrets when prompted. `npm run dev` applies local D1 migrations and starts the Worker with `.env`. The initial build supplies the static assets configured in `wrangler.jsonc`.

In another terminal:

```bash
npm run dev:web
```

Open the URL printed by Vite. Its proxy sends API, health, and Git requests to `http://127.0.0.1:8787`; keep the Worker on that port for this setup.

## Configuration

### Environment Variables

The local `.env` template contains:

```dotenv
JWT_SECRET=replace-with-a-strong-secret
GITHUB_TOKEN_ENCRYPTION_KEY=replace-with-a-strong-secret
ALLOW_USER_REGISTRATION=true
```

| Variable | Behavior |
| --- | --- |
| `JWT_SECRET` | Required secret for signing login JWTs |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | Encrypts GitHub PATs; unset disables GitHub sync. Changing it requires replacing saved tokens |
| `ALLOW_USER_REGISTRATION` | `true` (case-insensitive) enables registration; any other value or unset disables it |
| `UPLOAD_PACK_MAX_BODY_BYTES` | Fetch request body limit; defaults to 8 MiB |
| `RECEIVE_PACK_MAX_BODY_BYTES` | Optional push request body limit; unset means platform limits only |

Local `.env` values are loaded by the development script. Configure production variables separately; use `npm run secret:prod` for both production secrets.

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

Set separate production and Preview secrets once before deploying:

```bash
npm run secret:prod
npx wrangler preview base-config secret put JWT_SECRET
npx wrangler preview base-config secret put GITHUB_TOKEN_ENCRYPTION_KEY
```

The Preview base secret applies to new Previews. To update an existing Preview, use `npx wrangler preview secret put JWT_SECRET --name <preview>`.

### Workers Builds + Worker Previews

Connect this repository to the `gits` Worker in Workers Builds, select the production branch, and enable **Preview builds** for all other branches. Use the repository root and these commands:

| Setting | Command |
| --- | --- |
| Build | `npm ci && npm --prefix web ci && npm run build` |
| Deploy (production branch) | `npm run deploy` |
| Preview (all other branches) | `npm run preview` |

Worker Previews require the project's Wrangler dependency to be at least 4.135.0; a global installation is not used. Preview URLs use `<branch>-gits.<subdomain>.workers.dev`.

`npm run preview` first migrates the preview D1 database using `wrangler.preview-migrations.jsonc`, then runs `wrangler preview`. All branches share the preview D1/R2 resources, isolated from production; DO storage is separate per Preview. The `previews` block explicitly sets `DB`, `GIT_BUCKET`, `REPOSITORY_OBJECTS`, and `ALLOW_USER_REGISTRATION="true"` because production settings are not inherited. Assets, compatibility settings, and DO migrations remain top-level. See [Cloudflare Preview configuration](https://developers.cloudflare.com/workers/previews/configuration/).

Production Cron runs GitHub discovery and dispatch every five minutes. Worker Previews do not run Cron; use the source or mirror sync API to trigger manually. Alarms continue dispatching queued tasks after each task completes. Do not add Cron configuration to `previews`.

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
| `npm run secret:dev` | Set local JWT and GitHub encryption secrets in sequence |
| `npm run secret:dev:jwt` / `npm run secret:dev:github` | Set one local secret |
| `npm run secret:dev:set -- KEY FILE` | Prompt for a local variable and write it to the specified file |
| `npm run secret:prod` | Set production JWT and GitHub encryption secrets in sequence |
| `npm run secret:prod:jwt` / `npm run secret:prod:github` | Set one production secret |

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

API authentication accepts the login cookie or Bearer JWT/PAT. Public repository reads do not require authentication.

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

All GitHub resources belong to the signed-in user. Times are millisecond timestamps.

| Method and path | Purpose |
| --- | --- |
| `GET /api/github/connections` | Configuration availability and connections with source summaries |
| `POST /api/github/connections` | Validate and save `{ token }` |
| `PATCH /api/github/connections/:connectionId` | Replace `{ token }` for the same GitHub account |
| `DELETE /api/github/connections/:connectionId` | Remove a connection; keep local repositories |
| `GET /api/github/connections/:connectionId/owners` | List the account and accessible organizations |
| `POST /api/github/sources` | Enable `{ connectionId, ownerLogin, ...settings }` |
| `GET /api/github/sources/:sourceId` | Source settings and state counts |
| `PATCH /api/github/sources/:sourceId` | Update prefix, filters, visibility, interval or pause |
| `DELETE /api/github/sources/:sourceId` | Remove a source; keep local repositories |
| `POST /api/github/sources/:sourceId/sync` | Discover and dispatch immediately |
| `GET /api/github/sources/:sourceId/repositories` | List by `status` and `page`, 50 per page |
| `PATCH /api/github/sources/:sourceId/repositories/:githubRepoId` | Set `selection` or `localName` |
| `POST /api/repos/:owner/:repo/mirror/sync` | Sync one mirror, owner only |
| `DELETE /api/repos/:owner/:repo/mirror` | Stop syncing and restore local writes, owner only |

Repository details include `mirror` (or `null`); repository lists include `is_mirror` (0 or 1).
Mirrors reject push with 403 and reject branch or metadata edits with 409; renaming is allowed.
Classic PATs require `repo` and `read:org`; fine-grained PATs require Contents and Metadata read
access for the selected owner. Add a separate connection per owner for fine-grained PATs.

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

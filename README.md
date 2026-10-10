# gits

A personal Git repository host built on Cloudflare Workers, focused on Git storage, repository management, and code browsing.

## Features

- **Git hosting** — Smart HTTP clone, fetch, and push, with shallow clone and object filters. R2 stores Git objects; a per-repository Durable Object caches repository state and persists a storage snapshot.
- **Authentication** — Register, login, logout, JWT sessions, and Personal Access Tokens (PAT). Git Basic Auth uses a username and PAT.
- **Repositories** — Create, rename, update visibility and description, delete, and manage collaborators with `read / write / admin` permissions.
- **Branches** — Owners can create and delete branches and set the default branch through the web UI or API.
- **Code browsing** — README, directory trees, text files, paginated commits, commit details with diffs, and path history.

Repositories belong to individuals. Git access is HTTP only; there is no SSH service, Git LFS, code search, branch protection, or recycle bin.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | Cloudflare Workers |
| Backend | Hono, TypeScript |
| Metadata | Cloudflare D1 (SQLite) |
| Git storage | Cloudflare R2 |
| Repository state | `RepositoryObject` Durable Object, memory cache and DO storage snapshot |
| Frontend | React 19, React Router v7, Vite |
| UI | shadcn/ui, Tailwind CSS, Monaco Editor |
| Git | isomorphic-git, memfs |

## Quick Start

Use Node.js 20.19+ or 22.12+ with npm and Git.

```bash
npm install
npm --prefix web install
cp .env.example .env
npm run secret:dev
npm run build:web
npm run dev
```

Enter a local JWT secret when prompted. `npm run dev` applies local D1 migrations and starts the Worker with `.env`. The initial build supplies the static assets configured in `wrangler.jsonc`.

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
ALLOW_USER_REGISTRATION=true
```

| Variable | Behavior |
| --- | --- |
| `JWT_SECRET` | Required secret for signing login JWTs |
| `ALLOW_USER_REGISTRATION` | Registration is enabled by any nonempty value after trimming, including `false`; unset or empty disables it |
| `UPLOAD_PACK_MAX_BODY_BYTES` | Fetch request body limit; defaults to 8 MiB |
| `RECEIVE_PACK_MAX_BODY_BYTES` | Push request body limit; defaults to 32 MiB |

Local `.env` values are loaded by the development script. Configure production variables separately; use `npm run secret:prod` for the production JWT secret.

### Cloudflare Bindings

| Binding | Configuration |
| --- | --- |
| `DB` | D1 database, default name `gits`; set your `database_id` in `wrangler.jsonc` |
| `GIT_BUCKET` | One R2 bucket, default name `gits` |
| `REPOSITORY_OBJECTS` | Durable Object namespace for `RepositoryObject` |
| `ASSETS` | Frontend build from `web/dist` |

Preserve the Durable Object migration history in `wrangler.jsonc` when upgrading.

## Deployment

### Create Resources and Set Secrets

```bash
npx wrangler login
npm run d1:create:remote
npx wrangler r2 bucket create gits
npm run secret:prod
```

Copy the returned D1 database ID into `wrangler.jsonc`. If using another R2 bucket name, update `r2_buckets[0].bucket_name`.

### Deploy to Cloudflare

```bash
npm run deploy -- --var ALLOW_USER_REGISTRATION:true
```

The script applies remote D1 migrations, builds the frontend, then deploys the Worker with `--keep-vars`. For later deployments with existing production variables:

```bash
npm run deploy
```

To close registration, remove or empty the production registration variable. Check `GET /healthz` or `GET /api/healthz` after deployment. Existing deployments should read the [upgrade note](docs/USAGE.zh-CN.md#45-已有部署升级).

### Apply Migrations Separately

```bash
npm run db:migrate:local
npm run db:migrate
```

The first command targets local D1; the second targets production.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` / `npm run dev:api` | Apply local migrations and start the Worker |
| `npm run dev:web` | Start Vite |
| `npm run build` / `npm run build:web` | Build the frontend |
| `npm run deploy` | Apply remote migrations, build frontend, deploy Worker |
| `npm run typecheck` | Check backend TypeScript |
| `npm run test` / `npm run test:watch` | Run tests once / watch for changes |
| `npm run cf-typegen` | Generate Cloudflare binding types |
| `npm run d1:create:remote` | Create the remote D1 database named `gits` |
| `npm run db:migrate:local` / `npm run db:migrate` | Apply local / remote D1 migrations |
| `npm run secret:dev` / `npm run secret:dev:jwt` | Prompt for `JWT_SECRET` and write it to `.env` |
| `npm run secret:dev:set -- KEY FILE` | Prompt for a local variable and write it to the specified file |
| `npm run secret:prod` / `npm run secret:prod:jwt` | Set the production `JWT_SECRET` |

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
- `GET /api/repos/:owner/:repo` — Repository detail (`ref`)
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

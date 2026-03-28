# gits

A personal Git hosting and AI agent collaboration platform built on Cloudflare Workers. It brings together repositories, issues, pull requests, code reviews, and AI-powered automation into a single workflow.

**Core loop:** Issue → Agent Session → Pull Request → Code Review → Merge

## Features

- **Git Hosting** — Smart HTTP endpoints (`clone`, `push`, `fetch`) with shallow clone and object filtering support, backed by Cloudflare R2 storage.
- **Issues** — Task tracking with acceptance criteria. Issues can be assigned to AI agents that work autonomously and report back.
- **Pull Requests** — Branch comparison, line-anchored review threads, suggested code changes, squash merge.
- **Actions & AI Automation** — Workflows triggered by events (`issue_created`, `pull_request_created`, `push`, mentions). Agents run in Cloudflare Containers or on a self-hosted local runner.
- **MCP Integration** — Agents interact with the platform through Model Context Protocol tools.
- **Authentication** — JWT sessions and Personal Access Tokens (PAT) with Git Basic Auth.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Runtime | Cloudflare Workers |
| Backend | Hono, TypeScript |
| Database | Cloudflare D1 (SQLite) |
| Object Storage | Cloudflare R2 |
| Durable Objects | Repository state, Container execution |
| Queue | Cloudflare Queues |
| Frontend | React 19, React Router v7, Vite |
| UI | shadcn/ui, Tailwind CSS, Monaco Editor |
| Git | isomorphic-git |

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

In a separate terminal, start the frontend:

```bash
npm --prefix web run dev
```

`npm run dev` applies local D1 migrations automatically and starts the Worker in local mode. The frontend dev server proxies API and Git requests to the Worker on port 8787.

## Configuration

### Environment Variables

Set in `.env` for local development:

```bash
APP_ORIGIN=auto
JWT_SECRET=replace-with-a-strong-secret
ALLOW_USER_REGISTRATION=true
```

### Cloudflare Bindings

Update `wrangler.jsonc`:

- `d1_databases[0].database_id` — your D1 database ID
- `r2_buckets[0].bucket_name` — your R2 bucket name

## Deployment

### Deploy to Cloudflare

```bash
npm run deploy
```

With custom variables:

```bash
npm run deploy -- \
  --var APP_ORIGIN:https://gits.example.com \
  --var ALLOW_USER_REGISTRATION:true \
  --keep-vars
```

### Set Secrets

```bash
wrangler secret put JWT_SECRET
```

### Apply Migrations

```bash
# Local
npm run db:migrate:local

# Remote (production)
npm run db:migrate
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local Worker with auto-migration |
| `npm run deploy` | Deploy Worker to Cloudflare |
| `npm run build` | Build frontend |
| `npm run typecheck` | TypeScript validation |
| `npm run test` | Run tests |
| `npm run cf-typegen` | Generate Cloudflare binding types |
| `npm run db:migrate:local` | Apply D1 migrations locally |
| `npm run db:migrate` | Apply D1 migrations remotely |

## Project Structure

```
gits/
├── src/                    # Backend (Cloudflare Worker)
│   ├── routes/api/         # REST API routes
│   ├── routes/git.ts       # Smart HTTP Git endpoints
│   ├── services/           # Business logic
│   ├── middleware/          # Auth, error handling
│   ├── db/migrations/      # SQL schema migrations
│   └── actions/            # Container Durable Object
├── web/                    # Frontend (React + Vite)
│   ├── src/pages/          # Route pages
│   ├── src/components/     # UI components
│   └── src/lib/            # API client, utilities
├── containers/             # Docker image for agent runtime
│   └── actions-runner/
├── prd/                    # Product requirements docs
└── wrangler.jsonc          # Cloudflare Worker config
```

## API Overview

### Auth & Tokens

- `POST /api/auth/register` — Create account
- `POST /api/auth/login` — Sign in
- `POST /api/auth/tokens` — Create PAT
- `GET /api/auth/tokens` — List PATs
- `DELETE /api/auth/tokens/:tokenId` — Revoke PAT

### Repositories

- `GET /api/repos` — List repositories
- `POST /api/repos` — Create repository
- `GET /api/repos/:owner/:repo` — Repository detail
- `PATCH /api/repos/:owner/:repo` — Update repository
- `DELETE /api/repos/:owner/:repo` — Delete repository
- `GET /api/repos/:owner/:repo/branches` — List branches
- `GET /api/repos/:owner/:repo/commits` — Commit history

### Git (Smart HTTP)

- `GET /:owner/:repo.git/info/refs` — Reference discovery
- `POST /:owner/:repo.git/git-upload-pack` — Fetch
- `POST /:owner/:repo.git/git-receive-pack` — Push

## Documentation

- Product requirements: [`prd/`](prd/)

## License

Private

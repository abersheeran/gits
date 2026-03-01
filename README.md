# Git Service (Workers + D1 + R2)

Minimal personal Git hosting service scaffold.  
Current code includes:

- Hono app structure (`routes`, `services`, `middleware`, `views`)
- D1 schema and initial migration
- JWT session + PAT verification skeleton
- Smart HTTP endpoints for Git (`info/refs`, `upload-pack`, `receive-pack`)
- R2-based storage adapter for Git object/ref paths
- Repository APIs:
  - `GET /api/repos`
  - `POST /api/repos`
  - `PATCH /api/repos/:owner/:repo`
  - `DELETE /api/repos/:owner/:repo`
  - `GET /api/repos/:owner/:repo`
  - `GET /api/repos/:owner/:repo/branches`
  - `GET /api/repos/:owner/:repo/commits`
  - `GET|PUT|DELETE /api/repos/:owner/:repo/collaborators*`
- Auth/PAT APIs:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/tokens`
  - `GET /api/auth/tokens`
  - `DELETE /api/auth/tokens/:tokenId`

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

`npm run dev` now applies local D1 migrations automatically and starts the Worker in local mode.

## Documentation

- Chinese usage guide: `docs/USAGE.zh-CN.md`

## Configure Cloudflare resources

Variables are loaded from `.env` (via `wrangler --env-file .env` in npm scripts).

1. Update `wrangler.jsonc`:
   - `d1_databases[0].database_id`
   - `r2_buckets[0].bucket_name`
   - optional: `vars.UPLOAD_PACK_MAX_BODY_BYTES`
   - optional: `vars.RECEIVE_PACK_MAX_BODY_BYTES`
2. Configure `.env`:

```bash
APP_ORIGIN=auto
JWT_SECRET=replace-with-a-strong-secret
```

3. Set secret (optional for Cloudflare remote environments):

```bash
wrangler secret put JWT_SECRET
```

4. Apply migration:

```bash
npm run db:migrate:local
# or
npm run db:migrate
```

## Scripts

```bash
npm run dev
npm run deploy
npm run typecheck
npm run test
npm run cf-typegen
```

## Current scope

- Fetch path via `git-upload-pack`, including:
  - `want/have/done` negotiation-only round (`done` missing => ACK/NAK + flush)
  - pack generation with commit/tree/blob object closure
  - `deepen <n>`, `deepen-since <ts>`, `deepen-not <ref>` handling
  - object filtering support for `filter blob:none` and `filter blob:limit=<n>`
  - protocol `ERR` responses for unknown/unsupported filter specs
- Push path via `git-receive-pack`, including:
  - pkt-line command parsing + pack ingestion (`indexPack`)
  - ref update validation (`old/new oid`, branch commit type checks)
  - report-status response (`unpack/ok/ng`) with side-band compatibility
  - storage sync back to R2
- Repository storage initialization on create (`HEAD -> refs/heads/main`)
- Basic repository detail web page with branches, recent commits, and README rendering.

## Unit tests

Current unit test coverage includes:

- API input validation and password-handling behavior
- API token lifecycle and repository-create initialization behavior
- Session middleware token fallback behavior
- Git Basic Auth middleware challenge/credential validation behavior
- Git protocol parsing and upload-pack/receive-pack response encoding
- Git service permission checks and advertisement behavior
- Git route validation (`invalid service`, body limits, content type checks)
- Auth service token metadata and revoke behavior
- Repository service collaborator/admin permission behavior
- Repository lifecycle + collaborator permission matrix (`PATCH` rename rollback, `DELETE`, collaborator admin checks)
- Integration tests on Hono app with mock D1 + mock R2 for:
  - repository detail API
  - commit history API
  - upload-pack result output
  - isomorphic-git fetch compatibility
  - authenticated push to private repository
- Black-box `git` CLI interoperability tests (`git clone`, `git push`) against the HTTP endpoints

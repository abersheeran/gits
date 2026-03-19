# Gits Local Runner

This is a local polling runner for repositories configured with `runner_type = local`. It claims queued sessions from the gits platform, clones the target repository, runs the configured agent on your machine, sends heartbeats and completion callbacks, and then cleans up the temporary workspace.

## Required environment variables

- `GITS_TOKEN`: your personal access token
- `GITS_PLATFORM_URL`: platform base URL, for example `https://gits.example.com`
- `GITS_POLL_INTERVAL`: optional poll interval in milliseconds, defaults to `5000`
- `GITS_WORKSPACE_DIR`: optional base directory for temporary workspaces, defaults to the system temp directory

## Run

```bash
cd local-runner
GITS_TOKEN=xxx GITS_PLATFORM_URL=https://gits.example.com npm start
```

Use Node.js 18+ so the script can rely on the built-in `fetch`.

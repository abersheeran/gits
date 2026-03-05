# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS builder
WORKDIR /src
COPY package.json ./
COPY package-lock.json ./
COPY tsconfig.json ./
COPY server.ts ./
COPY gits-platform-mcp.ts ./
RUN npm ci --no-fund --no-audit
RUN npm run build

FROM docker:dind-rootless

USER root
RUN apk add --no-cache bash ca-certificates curl git nodejs npm \
  && npm install -g @openai/codex @anthropic-ai/claude-code \
  && npm cache clean --force

WORKDIR /opt/actions-runner
COPY --from=builder /src/package.json /opt/actions-runner/package.json
COPY --from=builder /src/package-lock.json /opt/actions-runner/package-lock.json
RUN npm ci --omit=dev --no-fund --no-audit
COPY --from=builder /src/dist/server.js /opt/actions-runner/server.js
COPY --from=builder /src/dist/gits-platform-mcp.js /opt/actions-runner/gits-platform-mcp.js
COPY entrypoint.sh /opt/actions-runner/entrypoint.sh
RUN chmod +x /opt/actions-runner/entrypoint.sh \
  && chown -R rootless:rootless /opt/actions-runner

USER rootless

EXPOSE 8080
ENTRYPOINT ["/opt/actions-runner/entrypoint.sh"]

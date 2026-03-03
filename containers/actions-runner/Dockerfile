# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS builder
WORKDIR /src
COPY package.json ./
COPY tsconfig.json ./
COPY server.ts ./
RUN npm install --no-fund --no-audit
RUN npm run build

FROM docker:dind-rootless

USER root
RUN apk add --no-cache bash ca-certificates curl git nodejs npm \
  && npm install -g @openai/codex @anthropic-ai/claude-code \
  && npm cache clean --force

WORKDIR /opt/actions-runner
COPY --from=builder /src/dist/server.js /opt/actions-runner/server.js
COPY entrypoint.sh /opt/actions-runner/entrypoint.sh
RUN chmod +x /opt/actions-runner/entrypoint.sh \
  && chown -R rootless:rootless /opt/actions-runner

USER rootless

EXPOSE 8080
ENTRYPOINT ["/opt/actions-runner/entrypoint.sh"]

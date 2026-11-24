# One image for the main agent, the worker agent and the MCP server; each
# container picks its process with `command` (see k8s/deployment.yaml).
FROM node:26-alpine AS build
WORKDIR /app
# web/ is a workspace (the React island that renders the shell bar): its package.json must be here before `npm ci`.
COPY package.json package-lock.json tsconfig.json ./
COPY web/package.json web/
RUN npm ci
COPY src ./src
COPY web ./web
# The vendored run-observability core and readers (rule 27) are plain JS beside the compiled server: dist/runObs.js imports ../server/src/.
COPY server ./server
# The Story wording (GET /api/story) is read from video/captions.md at run time; the rest of video/ stays out of the image.
COPY video/captions.md ./video/captions.md
# `npm run build` compiles the server (tsc) and builds the island into dist/web, which the main agent serves at /web/assets/.
RUN npm run build && npm prune --omit=dev

FROM node:26-alpine
# Links the GHCR package to this repo on push (see .github/workflows/build-a2a-demo-image.yml).
LABEL org.opencontainers.image.source=https://github.com/curtismu7/privilege-a2a-anthropic-demo
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/video ./video
USER node
CMD ["node", "dist/worker-agent/index.js"]

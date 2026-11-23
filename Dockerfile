# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@8.15.9 --activate

WORKDIR /app
COPY . .

# This image never runs a browser; the web server connects to an external CDP
# endpoint. Skip all browser downloads during dependency installation.
ENV PUPPETEER_SKIP_DOWNLOAD=1
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

RUN pnpm install --frozen-lockfile

# The desktop postinstall rebuilds better-sqlite3 against Electron; restore the
# Node ABI required by the web server.
RUN cd node_modules/better-sqlite3 && npm run install

# The plugin's own postinstall build is best-effort (`npm run build || exit 0`)
# and its tsc still reports errors while emitting; assert the entry file the db
# worker imports exists so a broken build fails here instead of at runtime.
RUN test -f packages/sqlite-plugin/dist/index.js

# Server bundles (workers with Electron/daemon stubs) and the web renderer.
RUN node packages/web/build.mjs
RUN pnpm --filter geekgeekrun-ui exec vite build --config vite.web.config.ts

FROM node:20-bookworm-slim AS runtime

WORKDIR /app
COPY --from=build /app /app

ENV NODE_ENV=production
ENV HOME=/data
ENV PORT=3210
ENV HOST=0.0.0.0
# No browser is installed. Point the web server at an external CDP endpoint
# with GEEKGEEKRUN_BROWSER_URL or GEEKGEEKRUN_BROWSER_WS_ENDPOINT.

RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3210
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3210)+'/api/env').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "packages/web/server/index.mjs"]

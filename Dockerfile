# syntax=docker/dockerfile:1

FROM oven/bun:1.4.0 AS deps
WORKDIR /app

COPY package.json bun.lock bunfig.toml tsconfig.json turbo.json ./
COPY packages/dax/package.json packages/dax/package.json
COPY packages/plugin/package.json packages/plugin/package.json
COPY packages/script/package.json packages/script/package.json
COPY packages/sdk/js/package.json packages/sdk/js/package.json
COPY packages/util/package.json packages/util/package.json

RUN bun install --frozen-lockfile

FROM deps AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    DAX_PRODUCTION=true \
    DAX_DISABLE_AUTOUPDATE=true \
    DAX_DISABLE_TERMINAL_TITLE=true

COPY . .

EXPOSE 4096

CMD ["sh", "-lc", ": \"${DAX_SERVER_PASSWORD:?DAX_SERVER_PASSWORD is required}\"; exec bun run --cwd packages/dax --conditions=browser src/index.ts serve --hostname 0.0.0.0 --port ${PORT:-4096}"]

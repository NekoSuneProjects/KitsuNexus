FROM node:20-bookworm-slim AS base

FROM base AS dependencies
WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
# Compile native modules against the same libc as the runtime instead of
# downloading a SQLite prebuild that may require a newer glibc.
RUN npm_config_build_from_source=true npm ci --omit=dev

FROM base AS runtime
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
# Fail the image build if the native binding cannot load or execute a query.
RUN node -e "const db = new (require('sqlite3').Database)(':memory:'); db.get('SELECT 1 AS ok', (err, row) => { if (err) throw err; if (row.ok !== 1) throw new Error('SQLite smoke check failed'); db.close(); });"
EXPOSE 8080
CMD ["node", "src/index.js"]

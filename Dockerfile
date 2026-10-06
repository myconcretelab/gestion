FROM node:22.12-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --include=dev --include=optional
COPY . .
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run prod:generate && npm run build

FROM node:22.12-bookworm-slim AS runtime
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN NODE_ENV=development npm ci --include=dev --include=optional \
    && npx playwright install --with-deps chromium \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client sqlite3 openssl \
    && rm -rf /var/lib/apt/lists/* \
    && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/templates server/templates
COPY --from=build /app/server/prisma server/prisma
COPY --from=build /app/server/scripts server/scripts
COPY --from=build /app/server/generated server/generated
COPY --from=build /app/client/dist client/dist
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run prod:generate
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 4000
CMD ["npm", "run", "start"]

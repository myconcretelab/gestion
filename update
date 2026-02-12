#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo "==> Pull latest code"
git pull

echo "==> Install/update dependencies"
npm ci --include=optional

if [[ "${SKIP_PLAYWRIGHT_INSTALL:-0}" != "1" ]]; then
  echo "==> Ensure Playwright Chromium is installed"
  npx playwright install chromium
fi

echo "==> Generate Prisma client (PostgreSQL)"
npm run prod:generate

echo "==> Apply database migrations (PostgreSQL)"
npm run prod:migrate

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "==> Build client + server"
  npm run build
fi

echo "==> Update complete"

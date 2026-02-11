#!/usr/bin/env bash
set -euo pipefail

# Update dependencies
npm install

# Apply database migrations
npm run migrate

# Build client + server
# npm run build

# Optional: start server after update
# npm run start

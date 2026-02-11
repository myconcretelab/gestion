# AGENTS.md

## Scope
This repository is a Node.js + React monorepo (workspaces) for generating and archiving rental contracts as PDFs.

## Quick start
- Install dependencies: `npm install`
- Install Playwright browser (needed for PDF generation): `npx playwright install chromium`
- Create env file: `cp .env.example .env`
- Initialize DB (SQLite by default): `npm run migrate` then `npm run seed`
- Run dev (client + server): `npm run dev`

## Useful commands
- Dev: `npm run dev`
- Build: `npm run build`
- Start server (prod): `npm run start`
- DB migrate/seed: `npm run migrate`, `npm run seed`

## Project layout
- `server/` Express API + Prisma + Playwright (PDF generation)
- `client/` React + Vite frontend
- `server/templates/` HTML/CSS templates for PDF
- `server/data/pdfs/YYYY/MM/` generated PDFs

## Notes
- Production can use PostgreSQL; see `README.md` for the example and `server/prisma/schema.postgres.prisma`.
- If Playwright is not installed, `SEED_SKIP_PDF=1 npm run seed` skips PDF generation.
- There are no automated tests configured in this repo.

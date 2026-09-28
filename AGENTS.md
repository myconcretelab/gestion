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

## Frontend conventions
- Use the app primary color tokens (`--primary`, `--primary-soft`, `--primary-strong`) for selected states and highlight effects instead of ad hoc highlight colors.

## Notes
- Production can use PostgreSQL; see `README.md` for the example and `server/prisma/schema.postgres.prisma`.
- If Playwright is not installed, `SEED_SKIP_PDF=1 npm run seed` skips PDF generation.
- Automated tests: `npm run test` (server + client), or `npm run test -w client` for frontend-only changes.

- Commit + push after each run

## Deployment (Alwaysdata)

### Production target
- App: https://gestion.gites-broceliande.com
- SSH: `myconcretelab@ssh-myconcretelab.alwaysdata.net`
- Remote checkout: `/home/myconcretelab/www/apps/gestion`
- Deploy branch: `main` on `origin` (`myconcretelab/gestion`).
- Local wrapper: `/Users/sebsoaz/bin/update`; target name: `gestion`.
- The wrapper connects over SSH and executes the repository's `./update` on the server. Do not run the production update script from the local development checkout.

### Before deploying
1. Build and run tests appropriate to the changes, then commit and push the intended version to `origin/main`.
2. Check the current production revision and working tree:
   ```bash
   ssh -o BatchMode=yes -o ConnectTimeout=15 myconcretelab@ssh-myconcretelab.alwaysdata.net 'cd /home/myconcretelab/www/apps/gestion && git status --short && git log -1 --oneline'
   ```
3. Compare the production revision with the intended revision to choose the deployment mode. Account for any remote modifications before running the update: the script can stash/reapply local changes and resets the generated PostgreSQL schema. Do not discard unaccounted-for production edits.

### Deployment commands
For changes that need no dependency installation, Prisma generation or database migration (such as appearance changes), use:
```bash
/Users/sebsoaz/bin/update gestion --light
```
Light mode pulls the code, builds client and server, and restarts the site. It skips dependency installation, Playwright installation, Prisma generation, tests and migrations; run the relevant tests locally first.

For dependency, Prisma or database changes, use the full deployment:
```bash
/Users/sebsoaz/bin/update gestion
```
Full mode pulls the code, installs dependencies and Playwright Chromium, generates the PostgreSQL Prisma client, runs tests, builds client/server, applies PostgreSQL migrations and restarts the site. Before database migrations, ensure there is a current recoverable database backup. Never use development reset or seed commands on production.

If the local wrapper is unavailable, the equivalent light-mode command is:
```bash
ssh myconcretelab@ssh-myconcretelab.alwaysdata.net 'cd /home/myconcretelab/www/apps/gestion && ./update --light'
```
Omit `--light` for the full deployment.

### Configuration and restart
- The remote script loads `.env`, `.env.production`, then `.env.update` (later files override earlier ones).
- Restart uses `RESTART_CMD`, or the Alwaysdata API with `ALWAYSDATA_API_TOKEN`, `ALWAYSDATA_ACCOUNT` and `ALWAYSDATA_SITE_ID`. Restart configuration can live in `.env.update`.
- Never print or commit these files or credential values. Do not enable shell tracing while loading them.
- Do not routinely set `SKIP_BUILD`, `SKIP_TESTS`, or `SKIP_RESTART`. A message saying no restart is configured does not confirm a successful restart, even if the script exits successfully.

### Verify completion
1. Wait for the update command to finish successfully, including its restart step.
2. Confirm the deployed revision:
   ```bash
   ssh -o BatchMode=yes myconcretelab@ssh-myconcretelab.alwaysdata.net 'cd /home/myconcretelab/www/apps/gestion && git log -1 --oneline && git status --short'
   ```
3. Check the live service after restart:
   ```bash
   curl --fail --silent --show-error https://gestion.gites-broceliande.com/api/health
   ```
   Expected response: `{"ok":true}`.
4. Check the changed page and its published assets when applicable. A successful health response alone does not verify the frontend version.
5. Report the deployed revision and verification result. If any step fails, inspect the failure before retrying; do not report deployment success from a push or build alone.

Documentation-only changes require commit and push, but do not need a production rebuild.

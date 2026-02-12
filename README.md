# Contrats de location de gîtes

Monorepo Node.js + React pour générer et archiver des contrats de location de gîtes en PDF A4, avec stockage local et base SQLite (et option PostgreSQL en production).

## Structure

- `server/` API Express + Prisma + Playwright
- `client/` React + Vite
- `server/templates/` templates HTML/CSS pour PDF
- `server/data/pdfs/YYYY/MM/` stockage des PDF générés

## Prérequis

- Node.js 18+
- (Optionnel) PostgreSQL pour production

## Installation locale

1. Installer les dépendances à la racine (inclure les deps optionnelles pour Rollup/Prisma):

```bash
npm install --include=optional
```

2. Installer Chromium pour Playwright:

```bash
npx playwright install chromium
```

3. Copier le fichier d'environnement:

```bash
cp .env.example .env
```

4. Lancer Prisma (SQLite):

```bash
npm run dev:db
npm run seed
```

5. Démarrer en dev (client + server):

```bash
npm run dev
```

Accès:
- Front: http://localhost:5173
- API: http://localhost:4000/api

## Génération PDF

- Template principal: `server/templates/contract.html`
- Conditions générales: `server/templates/conditions.html`
- Playwright génère un PDF A4 en 2 pages.

## Seed

Le seed crée 2 gîtes et 2 contrats. Pour ignorer la génération PDF lors du seed (si Playwright n'est pas installé):

```bash
SEED_SKIP_PDF=1 npm run seed
```

## Deploy AlwaysData

1. Configurer les variables d'environnement (via l'interface AlwaysData):

- `DATABASE_URL=postgresql://myconcretelab:YOUR_PASSWORD@postgresql-myconcretelab.alwaysdata.net:5432/myconcretelab_contrats?schema=public`
- (optionnel) `DATABASE_URL_POSTGRES=...` si vous gardez un `DATABASE_URL` SQLite dans un `.env` local
- `NODE_ENV=production`
- `PORT=4000`
- `CLIENT_DIST_DIR=/home/USER/app/client/dist`
- `PLAYWRIGHT_BROWSERS_PATH=0`
- (optionnel) `BASIC_AUTH_PASSWORD=...`

Note: le port 5432 est le defaut PostgreSQL. AlwaysData peut afficher un port different dans l'UI. Si SSL est requis, ajoutez `sslmode=require` a l'URL.

2. Build, generation Prisma et migrations:

```bash
npm ci --include=optional
npm run build
npm run prod:generate
npm run prod:migrate
```

3. Lancer le serveur:

```bash
npm run start
```

4. PDFs: les fichiers sont stockes dans `server/data/pdfs/YYYY/MM/` par defaut. Assurez-vous que le dossier `server/data/` (ou la variable `DATA_DIR`) est sur un volume persistant et accessible en ecriture par le processus AlwaysData.

SQLite en production n'est pas recommande si vous avez des acces concurrents. PostgreSQL est le mode prevu pour la prod.

## Schémas Prisma (SQLite vs PostgreSQL)

- SQLite (dev): `server/prisma/schema.prisma` + migrations dans `server/prisma/migrations/`
- PostgreSQL (prod): `server/prisma/postgres/schema.prisma` + migrations dans `server/prisma/postgres/migrations/`

Scripts utiles:

- `npm run dev:db` (SQLite migrate dev)
- `npm run dev:reset` (SQLite reset)
- `npm run prod:generate` (gen client Postgres)
- `npm run prod:migrate` (migrate deploy Postgres)
- `npm run db:studio` (SQLite studio)

Le fichier `server/prisma/schema.sqlite.prisma` est la source SQLite. Le fichier `server/prisma/schema.postgres.prisma` est la source PostgreSQL, et `npm run prisma:use:postgres` synchronise le schema utilise pour les migrations Postgres.

## Migration des donnees SQLite -> PostgreSQL

```bash
npm run db:migrate:sqlite-to-postgres
```

Options:

- `--wipe` : vide les tables Postgres avant import
- `--dry-run` : lecture seule

Par defaut, la source SQLite vient de `DATABASE_URL` (ou `DATABASE_URL_SQLITE`) et la cible Postgres de `DATABASE_URL` (ou `DATABASE_URL_POSTGRES`). Vous pouvez aussi utiliser `--from-url` et `--to-url`.

## Endpoints API principaux

- `GET /api/gites`
- `POST /api/gites`
- `PUT /api/gites/:id`
- `DELETE /api/gites/:id`
- `GET /api/contracts`
- `POST /api/contracts` (création + PDF)
- `PUT /api/contracts/:id` (mise à jour + régénération)
- `GET /api/contracts/:id/pdf`
- `POST /api/contracts/:id/regenerate`

## Notes

- Les PDF sont stockés sous `server/data/pdfs/YYYY/MM/`.
- La numérotation est automatique `{PREFIX}-{YYYY}-{000001}` par gîte et par année.
- Auth simple activable via `BASIC_AUTH_PASSWORD`.

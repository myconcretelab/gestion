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

## Intégration Pump

Le repo `contrats` peut maintenant consommer directement l'API locale du repo `pump`.

Variables d'environnement utiles:

- `PUMP_API_BASE_URL=http://localhost:3000/api/reservations`
- `PUMP_API_KEY=...`
- `PUMP_IMPORT_CRON_ENABLED=true`
- `PUMP_IMPORT_CRON_INTERVAL_DAYS=3`
- `PUMP_IMPORT_CRON_HOUR=10`
- `PUMP_IMPORT_CRON_MINUTE=0`

Flux prévu:

1. Dans `pump`, exposer l'API `/api/reservations/*` avec `PUMP_API_KEY`.
2. Dans `contrats`, ouvrir **Réglages**.
3. Utiliser la section **Import Pump**:
   - `Lancer refresh Pump`
   - `Rafraîchir le statut`
   - `Analyser la dernière extraction`
   - `Importer`

`contrats` récupère alors les réservations normalisées depuis `pump`, les prévisualise avec le même moteur que l'ancien import HAR, puis crée ou complète les réservations locales.

Un cron Pump configurable est aussi disponible dans **Réglages**. Par défaut, il est prérempli sur un import automatique tous les 3 jours à 10h.

## Synchronisation iCal

La synchronisation iCal n'utilise plus de minuteur en mémoire dans le process Node. Le serveur stocke la configuration et l'état du dernier passage, mais c'est un cron externe qui doit lancer le job.

Le déclenchement se fait via l'URL HTTP Alwaysdata:

- `https://votre-domaine/api/settings/ical/cron/run?token=VOTRE_CRON_TRIGGER_TOKEN`

Le déclenchement HTTP accepte `CRON_TRIGGER_TOKEN` et, par repli, `INTEGRATION_API_TOKEN`. Il passe aussi la Basic Auth globale si le token URL est valide.

Le job déclenché par l'URL:

- lit la configuration iCal enregistrée dans **Réglages**
- exécute immédiatement la synchro si elle est activée
- verrouille l'exécution pour éviter les chevauchements
- journalise aussi les échecs dans **Traçabilité > Journal des imports**

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
- `PLAYWRIGHT_BROWSERS_PATH=/home/USER/.cache/ms-playwright` (recommande pour eviter les re-telechargements, utilisez un chemin absolu)
- (optionnel) `NPM_INSTALL_MODE=install` pour que `./update` utilise `npm install` (et conserve `node_modules`)
- (optionnel) `BASIC_AUTH_PASSWORD=...`
- (optionnel) `INTEGRATION_API_TOKEN=...` pour les appels serveur-à-serveur (ex: repo `what-today`)
- (optionnel) `ICAL_SYNC_ENABLED=true`
- (optionnel) `CRON_TRIGGER_TOKEN=...` pour déclencher le cron iCal via URL HTTP
- (optionnel) `RESTART_CMD=...` ou `ALWAYSDATA_API_TOKEN` + `ALWAYSDATA_ACCOUNT` + `ALWAYSDATA_SITE_ID` pour que `./update` redemarre le serveur

Note: le port 5432 est le defaut PostgreSQL. AlwaysData peut afficher un port different dans l'UI. Si SSL est requis, ajoutez `sslmode=require` a l'URL.
Note: evitez `PLAYWRIGHT_BROWSERS_PATH=~/.cache/ms-playwright` dans les fichiers `.env`; utilisez `/home/USER/.cache/ms-playwright`.
Note: `PLAYWRIGHT_BROWSERS_PATH=0` stocke les navigateurs dans `node_modules` et force souvent un re-telechargement apres `npm ci`.
Note: `NPM_INSTALL_MODE=ci` est le comportement par defaut (reproductible, mais supprime `node_modules`), `NPM_INSTALL_MODE=install` evite cette suppression.
Note: `./update` charge automatiquement `.env`, `.env.production` et `.env.update`.

2. Build, generation Prisma et migrations:

```bash
npm ci --include=optional
# ou: npm install --include=optional (si vous voulez conserver node_modules)
npm run build
npm run prod:generate
npm run prod:migrate
```

3. Lancer le serveur:

```bash
npm run start
```

3bis. Configurer l'URL du cron iCal dans Alwaysdata:

```text
https://votre-domaine/api/settings/ical/cron/run?token=VOTRE_CRON_TRIGGER_TOKEN
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
- Auth machine-à-machine possible via `Authorization: Bearer <INTEGRATION_API_TOKEN>`.

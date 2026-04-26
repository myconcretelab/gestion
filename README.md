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

Le repo `contrats` embarque maintenant sa propre automatisation Pump côté serveur.

Variables d'environnement utiles:

- `PUMP_BASE_URL=https://www.airbnb.fr/hosting/multicalendar`
- `PUMP_USERNAME=...`
- `PUMP_SESSION_PASSWORD=...`
- `PUMP_AUTH_MODE=persisted-only`
- `PUMP_SCROLL_SELECTOR=...`
- `PUMP_LOGIN_STRATEGY=simple` ou `multi-step`
- `PUMP_IMPORT_CRON_ENABLED=true`
- `PUMP_IMPORT_CRON_SCHEDULER=internal` ou `external`
- `PUMP_IMPORT_CRON_INTERVAL_DAYS=3`
- `PUMP_IMPORT_CRON_HOUR=10`
- `PUMP_IMPORT_CRON_MINUTE=0`
- `PUMP_ALERT_EMAIL_TO=...`
- `PUMP_ALERT_EMAIL_FROM=...`
- `SMTP_HOST=...`

Flux prévu:

1. Configurer l'automatisation Pump locale dans `contrats`.
2. Importer une session persistée Playwright depuis un navigateur local visible.
3. Ouvrir **Réglages**.
4. Utiliser la section **Import Pump**:
   - `Ouvrir le navigateur de capture`
   - `Lancer refresh Pump`
   - `Rafraîchir le statut`
   - `Analyser la dernière extraction`
   - `Importer`

En phase 1, le mode recommandé est `persisted-only`: `contrats` réutilise une session Airbnb déjà persistée et n'essaie plus de reconstruire le login via les boutons/classes de la page.

En local, le bouton `Ouvrir le navigateur de capture` lance un navigateur visible, attend votre connexion Airbnb, puis sauvegarde automatiquement le `storageState` réutilisé ensuite par Pump.

`contrats` exécute alors la capture Airbnb localement, extrait les réservations normalisées, les prévisualise, puis crée ou complète les réservations locales.

Un cron Pump configurable est aussi disponible dans **Réglages**. Par défaut, il est prérempli sur un import automatique tous les 3 jours à 10h. En production, vous pouvez utiliser le mode `external` et déclencher:

- `GET /api/settings/pump/cron/run?token=VOTRE_CRON_TRIGGER_TOKEN`
- ou `POST /api/settings/pump/cron/run` avec le même token

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

## Mise a jour AlwaysData

Le script `./update` du repo fait maintenant uniquement:

- `git pull`
- reinstall des dependances (`npm ci` par defaut, ou `NPM_INSTALL_MODE=install`)
- `npm run build`

Mode leger:

```bash
./update --light
```

Ce mode fait uniquement `git pull` puis `npm run build`, sans reinstaller les dependances.

Le wrapper local `/Users/sebsoaz/bin/update` transmet aussi cette option:

```bash
/Users/sebsoaz/bin/update gestion --light
```

1. Configurer les variables d'environnement (via l'interface AlwaysData):

- `DATABASE_URL=postgresql://myconcretelab:YOUR_PASSWORD@postgresql-myconcretelab.alwaysdata.net:5432/myconcretelab_contrats?schema=public`
- (optionnel) `DATABASE_URL_POSTGRES=...` si vous gardez un `DATABASE_URL` SQLite dans un `.env` local
- `NODE_ENV=production`
- `PORT=4000`
- `CLIENT_DIST_DIR=/home/USER/app/client/dist`
- `PLAYWRIGHT_HEADLESS=true` par defaut implicite en production (`NODE_ENV=production`) ; vous pouvez l'ajouter explicitement pour rendre le comportement visible
- (optionnel) `NPM_INSTALL_MODE=install` pour que `./update` utilise `npm install` au lieu de `npm ci`
- (optionnel) `BASIC_AUTH_PASSWORD=...` pour initialiser le premier mot de passe serveur hashé au premier démarrage
- (optionnel) `INTEGRATION_API_TOKEN=...` pour les appels serveur-à-serveur (ex: repo `what-today`)
- (optionnel) `ICAL_SYNC_ENABLED=true`
- (optionnel) `CRON_TRIGGER_TOKEN=...` pour déclencher le cron iCal via URL HTTP
- (optionnel) `PUMP_IMPORT_CRON_SCHEDULER=external` pour déclencher Pump via cron HTTP
- (optionnel) `PUMP_ALERT_EMAIL_TO=...`, `PUMP_ALERT_EMAIL_FROM=...`, `SMTP_HOST=...`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER=...`, `SMTP_PASS=...`

Note: le port 5432 est le defaut PostgreSQL. AlwaysData peut afficher un port different dans l'UI. Si SSL est requis, ajoutez `sslmode=require` a l'URL.
Note: `NPM_INSTALL_MODE=ci` est le comportement par defaut. `NPM_INSTALL_MODE=install` conserve `node_modules`.

2. Mettre a jour le code puis build:

```bash
npm ci --include=optional
# ou: NPM_INSTALL_MODE=install ./update
npm run build
```

3. Lancer le serveur:

```bash
npm run start
```

3bis. Configurer l'URL du cron iCal dans Alwaysdata:

```text
https://votre-domaine/api/settings/ical/cron/run?token=VOTRE_CRON_TRIGGER_TOKEN
```

3ter. Si Pump est en scheduler `external`, configurer aussi:

```text
https://votre-domaine/api/settings/pump/cron/run?token=VOTRE_CRON_TRIGGER_TOKEN
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
- Auth serveur via mot de passe hashé + session cookie. `BASIC_AUTH_PASSWORD` ne sert plus que de bootstrap initial optionnel.
- Le mot de passe serveur et la durée d'expiration de session se changent ensuite dans **Paramètres**.
- Auth machine-à-machine possible via `Authorization: Bearer <INTEGRATION_API_TOKEN>`.

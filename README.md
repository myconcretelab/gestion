# Gestion locative

Application Node.js + React destinée à une installation isolée par organisation. Elle gère les hébergements, réservations, contrats PDF et, selon les modules activés, la facturation et les intégrations.

## Prérequis

- Node.js 22.12 ou supérieur ;
- Chromium Playwright pour les PDF ;
- SQLite en développement, PostgreSQL 15+ en production ;
- un proxy HTTPS en production.

## Installation locale vierge

```bash
npm ci --include=optional
npx playwright install chromium
cp .env.example .env
npm run migrate
npm run dev
```

Générez `SETUP_TOKEN` avec un générateur cryptographiquement sûr (32 octets ou plus), placez-le dans `.env`, puis ouvrez l'application. L'assistant crée le premier administrateur, l'organisation, le premier hébergement et choisit les modules. Retirez `SETUP_TOKEN` après la fin de l'assistant. Aucun seed n'est nécessaire.

`npm run seed` est réservé à une base locale jetable : il efface son contenu et crée uniquement des données manifestement fictives. Ne jamais l'utiliser en production.

## Production avec PostgreSQL

1. Copier `.env.production.example` vers un fichier non versionné et renseigner `CLIENT_ORIGIN`, `DATABASE_URL`, `DATA_DIR`, `SETUP_TOKEN` et les chemins.
2. Installer avec `npm ci --include=optional` et `npx playwright install chromium`.
3. Générer le client PostgreSQL avec `npm run prod:generate`.
4. Sauvegarder l'installation, puis appliquer les migrations avec `npm run prod:migrate`.
5. Construire avec `npm run build` et démarrer avec `npm run start`.
6. Terminer l'assistant, vérifier `/api/health`, puis retirer `SETUP_TOKEN`.

Une installation de production refuse de démarrer sans compte protégé, sauf pendant l'onboarding lorsqu'un `SETUP_TOKEN` robuste est présent. Aucun reset ni seed n'est requis.

## Modules

Les modules sont désactivés sur une installation vierge : réservations et demandes, contrats, factures, finances et statistiques, frais personnels, planning des intervenants, publication web/WordPress, iCal, Pump/Airbnb, Smart Life, SMS, Telegram et e-mail quotidien. Une fonctionnalité désactivée est masquée, ses API sont fermées et ses tâches ne démarrent pas.

## Stripe en mode test

La dépendance Stripe est installée uniquement côté serveur. Pendant le pilote, le serveur refuse toute clé qui ne commence pas par `sk_test_`.

1. Dans le Dashboard Stripe en mode test, copier la clé secrète dans le fichier `.env` non versionné :

   ```dotenv
   STRIPE_MODE=test
   STRIPE_SECRET_KEY=sk_test_...
   ```

2. Pour recevoir les webhooks sur la machine locale, installer la CLI Stripe, s'y connecter puis lancer :

   ```bash
   stripe listen \
     --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed \
     --forward-to localhost:4000/api/billing/webhook/stripe
   ```

3. Copier le secret `whsec_...` affiché par la CLI dans `.env` sous `STRIPE_WEBHOOK_SECRET`, puis redémarrer le serveur.
4. Dans `/admin`, ouvrir **Forfaits et quotas**, renseigner les prix mensuel/annuel, enregistrer le forfait puis sélectionner **Synchroniser avec Stripe**.

La synchronisation crée un Product Stripe et ses Prices récurrents en mode test. Un changement de montant crée un nouveau Price et désactive l'ancien, conformément au fonctionnement Stripe. Les identifiants Stripe sont conservés en base ; les clés secrètes ne le sont jamais.

## Sauvegarde et restauration

```bash
npm run backup -- /chemin/sauvegarde.tar.gz
npm run restore:preview -- /chemin/sauvegarde.tar.gz
npm run restore -- /chemin/sauvegarde.tar.gz --apply --confirm-replace
```

L'archive contient la base, un manifeste SHA-256 et les PDF, photos, uploads et documents signés présents sous `DATA_DIR`. Les fichiers `.env`, sessions Pump et autres fichiers de secrets ne sont jamais inclus. PostgreSQL nécessite `pg_dump`/`pg_restore`. La restauration vérifie d'abord le manifeste et conserve une copie de sécurité de la base SQLite remplacée.

Avec PostgreSQL, définir en plus `INSTALLATION_BACKUP_PASSPHRASE` (24 caractères minimum) avant la sauvegarde et la restauration. Le dump de base est chiffré dans l'archive ; les secrets stockés en base ne sont jamais exportés en clair. Conserver cette phrase secrète séparément de l'archive. SQLite produit à la place une copie assainie qui révoque sessions, jetons et liens publics.

## Docker

Le `Dockerfile` fournit l'image de production. `docker compose -f compose.demo.yml up --build` lance une démonstration locale, applique les migrations et permet de terminer l'assistant avec le `SETUP_TOKEN` de démonstration indiqué dans le compose. Ces identifiants doivent être remplacés. Pour une vraie production, placez l'application derrière HTTPS, utilisez des volumes persistants pour PostgreSQL et `DATA_DIR`, et gérez les secrets hors du compose.

## Commandes

- `npm run dev` : développement ;
- `npm run migrate` : migrations SQLite locales ;
- `npm run prod:migrate` : migrations PostgreSQL ;
- `npm run test`, `npm run typecheck`, `npm run build` : validation ;
- `npm audit --omit=dev` : audit des dépendances de production ;
- `npm run backup`, `npm run restore:preview`, `npm run restore` : portabilité.

Voir [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md) et [docs/versioning.md](docs/versioning.md).

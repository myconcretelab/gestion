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

## Ménages

Le module « planning des intervenants » présente désormais une page **Ménages**. Un ménage est créé automatiquement à partir du départ d'une réservation. Pour chaque gîte, le gestionnaire choisit s'il est créé après chaque départ, uniquement si l'option ménage est prise, ou jamais ; il définit aussi le moment prévu (après le départ, la veille ou le jour de l'arrivée suivante), l'intervenant habituel, le délai avant l'arrivée, le contrôle final et les notifications. Les ménages existants gardent leur attribution lors d'un changement de règle. Un créneau impossible est signalé.

Un intervenant ne voit que les ménages qui lui sont attribués. Il peut les démarrer, les terminer et ajouter une note sans droit d'écriture général ; le contrôle final reste réservé au gestionnaire quand la règle l'exige. Les contrôles de la page « Aujourd'hui » et les liens de validation Telegram mettent à jour le même état. L'ancien planning partagé reste accessible sous « Ménages → Plannings partagés » pour conserver ses liens et ses envois existants.

Les règles de ménage peuvent attribuer les nouvelles tâches manuellement, à un intervenant habituel ou à tour de rôle parmi une liste ordonnée. La rotation avance uniquement lors de la création d'un nouveau ménage et ne réattribue pas ceux qui existent déjà.

L'onglet « Autres actions » permet de créer des tâches ponctuelles et des modèles réutilisables par gîte. Un modèle crée une action à chaque arrivée ou départ, avec un début et une échéance exprimés en jours et heures par rapport à cet événement. Il dispose des mêmes modes d'attribution, dont le tour de rôle. Un modèle désactivé ne génère plus de nouvelles tâches ; les tâches déjà créées restent visibles. Les intervenants ne voient et ne peuvent modifier que leurs actions attribuées. Ces actions n'affectent pas l'état « gîte prêt », qui reste propre au ménage.

## Entreprises et établissements de facturation

Dans **Paramètres → Organisation → Entreprises** (`/parametres/entreprises`), renseigner les entreprises qui émettent les factures : raison sociale, SIREN, régime et numéro de TVA, adresse du siège et contact. Une entreprise peut être associée à un gestionnaire ; un gestionnaire peut avoir plusieurs entreprises. Ajouter ensuite les établissements (SIRET et adresse), puis sélectionner l’**établissement facturant** dans chaque fiche gîte.

`Organization` reste le compte applicatif qui isole les données. `FiscalEntity` représente une entreprise juridique (un SIREN par compte) et `FiscalEstablishment` un établissement (un SIRET par compte). Les liens gestionnaire → entreprise → établissement → gîte sont protégés par des clés étrangères comprenant l’identifiant de compte. Aucun rattachement automatique n’est déduit des propriétaires historiques.

Les fiches peuvent être enregistrées progressivement. L’inventaire liste les gîtes sans établissement, les informations de base manquantes et les gestionnaires sans entreprise. Le régime de TVA reste « À préciser » jusqu’à sa saisie explicite. La validation contrôle les formats et la cohérence SIREN/SIRET/TVA ; elle ne vérifie pas l’existence des identifiants dans un registre ni l’éligibilité à la facturation électronique.

API : `GET/POST /api/fiscal-entities`, `PUT /api/fiscal-entities/:id`, `GET /api/fiscal-entities/inventory`, `POST /api/fiscal-entities/:id/establishments` et `PUT /api/fiscal-entities/:id/establishments/:establishmentId`. Elles nécessitent les droits de lecture/écriture des paramètres. La liste minimale `GET /api/gites/fiscal-establishments` utilise le droit de lecture des gîtes. La création, modification, duplication et l’import des gîtes acceptent `fiscal_establishment_id` ; l’omission préserve le rattachement existant, `null` le retire.

La migration `20261016100000_fiscal_entities` est fournie pour SQLite et PostgreSQL. Elle conserve les documents, les montants et les compteurs historiques ; les nouveaux rattachements sont initialement vides. Après sauvegarde, elle s’applique par les commandes de migration habituelles dans l’environnement choisi. Cette première étape prépare les données : elle n’active pas SuperPDP et ne modifie pas les calculs, la numérotation ou les PDF actuels.

## Cycle de vie des factures

Une nouvelle facture est enregistrée en **brouillon**, avec une référence technique et un PDF portant la mention « Brouillon ». Ce brouillon reste modifiable et supprimable. Son envoi par e-mail et la création d’un lien de partage sont bloqués avant validation. Sur sa fiche, **Valider définitivement** attribue le numéro officiel, enregistre la date d’émission et verrouille le document.

La série `F-AAAA-SIREN-NNNNNN` est commune aux gîtes et aux établissements d’une même entreprise, avec un compteur annuel. L’année et la date d’émission suivent le fuseau Europe/Paris et ne dépendent pas des dates du séjour. Les anciens compteurs par gîte sont conservés pour l’historique. La nouvelle série commence à 1 ; elle ne reprend pas une séquence provenant d’un autre logiciel. Les règles de numérotation et de correction retenues s’appuient sur [Service Public Entreprendre](https://entreprendre.service-public.gouv.fr/vosdroits/F23208).

La validation conserve un instantané de l’émetteur, du client, des tarifs et des montants enregistrés dans le brouillon. Elle refuse un émetteur incomplet, une adresse client vide ou un regroupement de gîtes appartenant à des entreprises différentes. Numéro, instantané, référence PDF, empreinte SHA-256 et événement d’audit sont enregistrés dans une transaction. Une nouvelle tentative sur la même facture retourne le document déjà émis. Un échec avant validation de la transaction ne consomme pas de numéro ; si le résultat de la transaction ne peut pas être vérifié, le fichier de tentative est conservé pour éviter d’effacer une archive potentiellement validée.

Le PDF émis est servi tel quel, même après un changement de modèle, de coordonnées ou de tarifs. Les changements de paiement restent possibles et sont audités, sans réécrire le PDF. Un PDF archivé absent ou dont l’empreinte a changé doit être restauré depuis une sauvegarde ; il n’est pas recalculé. Les factures verrouillées ne sont plus supprimables, y compris par suppression du gîte.

Une facture émise par ce nouveau cycle peut donner lieu à un **avoir intégral**, avec un motif obligatoire. L’avoir reprend l’émetteur et le total figés, référence sa facture source et reçoit son propre numéro dans la même séquence lors de sa validation. Un seul avoir intégral est possible par facture ; les avoirs partiels ne sont pas pris en charge dans cette étape. Les factures existantes deviennent `legacy` : numéro, montants et PDF restent inchangés et verrouillés, sans date d’émission inventée. Leur correction automatique est bloquée tant que leur émetteur et leurs montants n’ont pas fait l’objet d’une reprise vérifiée.

API complémentaires : `POST /api/invoices/:id/issue` avec `{ revision }`, `POST /api/invoices/:id/credit-note` avec `{ reason }`. Une modification de brouillon accepte sa `revision` pour détecter un formulaire périmé. Cette étape ne calcule pas de nouvelles lignes de TVA, ne certifie pas la conformité réglementaire complète et n’envoie rien à SuperPDP.

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
- `npm run migrate` : applique les migrations SQLite locales et génère le client Prisma ;
- `npm run migrate:dev` : crée une migration lors d'une modification volontaire du schéma ;
- `npm run prod:migrate` : migrations PostgreSQL ;
- `npm run test`, `npm run typecheck`, `npm run build` : validation ;
- `npm audit --omit=dev` : audit des dépendances de production ;
- `npm run backup`, `npm run restore:preview`, `npm run restore` : portabilité.

Voir [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md) et [docs/versioning.md](docs/versioning.md).

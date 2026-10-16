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

API complémentaires : `POST /api/invoices/:id/issue` avec `{ revision }`, `POST /api/invoices/:id/credit-note` avec `{ reason }`. Une modification de brouillon accepte sa `revision` pour détecter un formulaire périmé. Le détail fiscal ci-dessous complète désormais cette étape ; aucun envoi à SuperPDP n’est activé.

## Données fiscales structurées des factures (étape 3)

Dans le formulaire de facture, **Préparer les lignes depuis le séjour** propose les prestations à partir du calcul existant : location remise déduite, options facturées et frais complémentaires. Les prestations offertes ne sont pas ajoutées au montant. Pour les factures regroupées, chaque réservation reste une proposition agrégée : l’opérateur doit la ventiler si elle contient plusieurs traitements de TVA. Les lignes restent éditables (libellé, quantité, unité, prix unitaire TTC, catégorie, taux et motif). Aucun taux n’est déduit du type de gîte ou du régime de l’entreprise.

Le client est qualifié explicitement en particulier ou entreprise, avec une adresse structurée et un pays. Une entreprise française nécessite un SIREN ; les identifiants de TVA sont contrôlés en format et cohérence, sans interrogation d’un registre. Le nom reste celui du destinataire renseigné dans le formulaire ; l’adresse structurée devient l’adresse de facturation imprimée. Les factures existantes ne sont pas enrichies artificiellement.

Les prix contractuels restent **TTC**. Le calcul fiscal partagé utilise des entiers mis à l’échelle, calcule le HT des lignes puis la TVA par catégorie/taux. L’écart d’arrondi entre le TTC contractuel et HT + TVA est explicite (`rounding_amount`) ; il n’est pas caché dans un prix. Le rapprochement au centime avec le total du calcul historique est obligatoire avant émission. Les quantités ont au plus trois décimales, les prix TTC et les taux deux ; les prix nets unitaires exportés ont huit décimales pour préserver le montant net de la ligne. La TVA et les lignes d’un avoir sont conservées en valeurs positives dans le candidat électronique de type 381, avec `document_sign: -1` pour leur effet comptable et un rendu PDF négatif.

Catégories initiales : **S** (TVA à taux positif), **Z** (taux zéro), **E** (exonération, dont franchise en base) et **O** (hors champ). E/O nécessitent un motif ; la franchise exige une référence à l’article 293 B. Ce sous-ensemble ne couvre pas l’autoliquidation, les livraisons intracommunautaires, les régimes de marge ou les avoirs partiels. Le mélange O/autres catégories est bloqué suivant [BR-O-11](https://docs.peppol.eu/poacc/billing/3.0/bis/) ; il ne faut notamment pas requalifier une taxe en exonération pour contourner cette règle. Les opérations entièrement hors champ avec identifiants de TVA sont également à faire vérifier avant émission.

**Taxe de séjour :** le calcul historique l’affiche « dont taxe de séjour » sans l’ajouter au total. Cette étape ne change pas ce comportement et ne présume pas de son traitement fiscal. L’opérateur doit vérifier si elle est incluse, collectée séparément/par une plateforme ou non applicable, puis ventiler les lignes si nécessaire sans modifier le total. Une confirmation spécifique est exigée lorsque le calcul contient une taxe et pour tous les regroupements (dont le détail de taxe n’est pas connu). Les cas de débours et de taxes incompatibles avec ce sous-ensemble doivent être traités avec le comptable avant émission.

**Encaissements :** `paid_amount` représente uniquement les sommes réellement reçues à l’émission, saisi explicitement (proposition initiale : 0). Les arrhes prévues au contrat et l’ancien `solde_montant` restent utilisés par les réservations ; ils ne prouvent pas un encaissement. Le PDF fiscal imprime le montant restant calculé depuis les sommes réellement reçues, qui peut donc différer du solde contractuel. Le détail est figé à l’émission ; la bascule ultérieure « réglée » ne réécrit ni le PDF ni cet instantané, et ne constitue pas encore un journal d’encaissements ou une déclaration e-reporting de paiement. Un avoir intégral reprend les prestations, le client, les taux et les motifs d’origine, mais pas l’acompte reçu de sa source.

Le brouillon peut être enregistré incomplet ; la validation définitive refuse les champs manquants, écarts de TTC, catégories incohérentes et données non vérifiées, avant de consommer un numéro. Une modification du contexte du formulaire annule la confirmation de revue. Les anciennes factures émises restent verrouillées, sans recalcul ou migration de leur PDF. Un avoir d’une facture déjà émise à l’étape 2, sans détail fiscal, reste possible dans l’ancien mode ; il ne reçoit pas de faux instantané EN16931.

Le modèle PDF actuel reste conçu pour une page. Les métriques de police sont stabilisées avant l’ajustement de densité ; si le contenu dépasse encore la surface imprimable, la génération est refusée plutôt que de produire une facture tronquée. L’aperçu le signale. Il faut raccourcir le texte ou répartir les réservations sur plusieurs factures ; un véritable modèle multipage reste à développer pour les détails volumineux.

Stockage : une colonne texte JSON nullable `Facture.fiscal_data`, avec schéma partagé versionné, contient la saisie du brouillon. À l’émission, `immutable_snapshot.structured_invoice` fige les données calculées et le candidat `en_invoice` inspiré du [schéma officiel SuperPDP](https://api.superpdp.tech/openapi/superpdp.json), version 1.37.0.beta consultée le 16/10/2026. La migration additive `20261016150000_invoice_fiscal_data` est fournie pour SQLite et PostgreSQL ; aucune ligne historique n’est modifiée. Les sauvegardes et la conversion SQLite → PostgreSQL transportent cette colonne avec les factures.

API : `POST /api/invoices/fiscal-preview` (même contexte que l’aperçu, droit d’écriture factures) propose un `fiscal_input` sans sauvegarde ni appel réseau. La création/mise à jour accepte `fiscal_input` ; son omission retire le détail fiscal d’un brouillon pour éviter de conserver une saisie silencieusement périmée. La lecture expose `fiscal_input`, `fiscal_totals`, `fiscal_issues` et `structured_available`. `GET /api/invoices/:id/structured` (lecture factures, compte courant) exporte uniquement l’instantané d’un document émis avec ce modèle ; brouillons et historiques sans modèle sont refusés. Les règles d’accès et l’isolation par compte existantes s’appliquent.

**Limite explicite :** cet export est un modèle sémantique local et un **candidat**, pas un fichier Factur-X ni une attestation de conformité EN16931. Il porte `transport_ready: false`. Il reste à résoudre les adresses électroniques dans l’annuaire, choisir le profil, convertir et valider CII/UBL ou Factur-X, puis tester les règles françaises dans le bac à sable. SuperPDP documente `POST /v1.beta/invoices/convert?from=json&to=...`, y compris une requête multipart avec le PDF existant et la facture JSON pour produire Factur-X. L’émission utilise ensuite `/v1.beta/invoices` avec XML ou Factur-X, pas ce JSON directement. Aucun appel de conversion, d’envoi, OAuth, secret, e-reporting ou déploiement n’est réalisé par cette étape. Le routage B2C/B2B/B2BInt proposé n’est qu’un candidat basé sur le type de client et le pays, pas une décision d’assujettissement réglementaire.

## Connexion OAuth SuperPDP en bac à sable (étape 4)

Dans **Paramètres → Organisation → Entreprises**, sélectionner une entreprise déjà enregistrée avec son SIREN. Un administrateur authentifié peut alors configurer sa connexion **SuperPDP — environnement de test uniquement**. Les autres rôles, les jetons d’intégration et l’ancien mode sans authentification ne peuvent pas gérer cette connexion.

Cette étape utilise **Authorization Code avec PKCE S256**, adapté à la délégation entreprise par entreprise. Elle n’utilise ni l’enrôlement réservé aux experts-comptables, ni un mandat de facturation, ni un jeton commun à toutes les entreprises. Le même `client_id` peut servir à plusieurs consentements si l’application OAuth l’autorise, mais chaque entreprise locale conserve sa propre configuration et ses propres jetons. La documentation d’[authentification SuperPDP](https://www.superpdp.tech/documentation/4/) et le [schéma officiel](https://api.superpdp.tech/openapi/superpdp.json) ont été consultés le 16/10/2026. La bibliothèque serveur `oauth4webapi` traite les échanges, les réponses OAuth, le PKCE et la révocation ; les secrets ne sont pas intégrés au client React.

### Préparer un environnement de test distinct

Créer un site de préproduction ou une installation locale avec sa propre base et son propre `DATA_DIR`. Ne pas copier les secrets ni les consentements d’un serveur actif. Sur Alwaysdata, utiliser un autre site et une autre base que `gestion.gites-broceliande.com`. Aucun site n’est créé ou déployé automatiquement par cette étape.

Dans un fichier d’environnement **non versionné**, de mode `600`, renseigner :

```dotenv
SUPERPDP_SANDBOX_ENABLED=true
SUPERPDP_SECRETS_KEY=<cle-aleatoire-de-32-octets-encodee-en-base64>
SUPERPDP_SANDBOX_REDIRECT_URI=https://votre-site-de-test.example/api/fiscal-entities/superpdp/oauth/callback
```

`APP_PUBLIC_URL` et `CLIENT_ORIGIN` doivent désigner cette installation de test. La clé doit être générée cryptographiquement, conservée séparément de la base et sauvegardée dans un emplacement sûr ; ne pas l’afficher dans les journaux ou la transmettre dans le chat. Ne jamais utiliser de variable `VITE_*` pour ces valeurs. Le connecteur est **désactivé par défaut** ; une clé ou une URL incorrecte laisse les actions indisponibles avec un message explicite. HTTPS est exigé ; HTTP est accepté uniquement sur localhost/127.0.0.1 en développement ou test. En mode serveur `production`, l’origine de retour doit être celle de `APP_PUBLIC_URL`.

Dans l’interface SuperPDP, créer/configurer l’application OAuth et y enregistrer **exactement** cette URL de retour. Dans la fiche entreprise locale, saisir son `client_id`, son `client_secret` et le champ `number` de l’entreprise fictive SuperPDP attendue. Le numéro de l’entreprise fictive **n’est pas déduit du SIREN local**. Le champ secret est vidé après enregistrement ; laisser ce champ vide lors d’une modification conserve le secret existant. Un changement d’application ou de numéro de test impose d’abord une déconnexion. Le remplacement du seul secret de la même application est possible sans changer l’identité liée.

Cliquer ensuite **Autoriser l’entreprise dans SuperPDP**, effectuer le consentement dans la même session applicative et attendre le retour. Aucun scope n’est demandé, conformément à la documentation. Le paramètre `superpdp_send_and_receive=send` masque l’inscription à un annuaire de réception dans ce parcours : cette phase ne doit pas créer de ligne d’annuaire ou activer une réception par inadvertance. Le raccordement de la réception viendra dans l’étape dédiée.

### Vérification et séparation des environnements

SuperPDP utilise **le même domaine API** pour les entreprises de test et de production. Le serveur n’accepte donc pas un simple succès OAuth comme preuve d’environnement. Il lit d’abord `GET /v1.beta/oauth2_sessions/me` et contrôle le `client_id` retourné. Si `company_verification_status` n’est pas `verified`, les jetons restent en attente, sans lecture des données de l’entreprise. Le bouton **Vérifier la connexion** permet de reprendre cette vérification, sans synchronisation automatique en arrière-plan.

Une fois la session vérifiée, `GET /v1.beta/companies/me` doit retourner `env=sandbox`, `number_scheme=sandbox`, le numéro fictif explicitement attendu, et le même identifiant distant lors des vérifications suivantes. Une identité de production ou inattendue est refusée ; une révocation du jeton connu est demandée. Un identifiant distant ne peut être attaché à deux entreprises locales du même compte. Les identifiants 64 bits sont stockés comme chaînes pour éviter leur arrondi par JavaScript. Tant qu’une connexion non déconnectée existe, le SIREN local est verrouillé contre un changement d’identité.

Les lignes sont séparées par `(organization_id, fiscal_entity_id, environment)` avec clés étrangères composites. Le modèle prévoit un futur enregistrement `production`, mais **aucune route ni aucun réglage utilisateur ne l’active**. Les seuls appels distants implémentés sont le consentement, l’échange/renouvellement/révocation de jetons et les deux lectures d’identité. Aucune facture, conversion, ligne d’annuaire ou donnée d’e-reporting n’est envoyée par cette étape.

### Protection et cycle des secrets

Le secret client, la paire de jetons et le vérificateur PKCE sont chiffrés en AES-256-GCM avec un IV aléatoire et une authentification liée au compte, à l’entreprise, à l’environnement et au type de secret. Le `state` aléatoire est uniquement stocké sous forme de SHA-256 ; il est lié à l’utilisateur et à sa session, expire après dix minutes, n’est utilisable qu’une fois et voit son vérificateur effacé lors de sa consommation. Un nouveau consentement invalide le précédent. Les modifications de configuration invalident également les retours encore en attente.

Les actions demandent une session d’administrateur et une origine de requête autorisée. Le retour OAuth exige la même session et le même compte, sans réactivation implicite après déconnexion. Il redirige ensuite vers une URL fixe de l’application, sans code, jeton, `state` ou description d’erreur du fournisseur. Les réponses de gestion portent `Cache-Control: no-store`. Les erreurs OAuth brutes ne sont ni propagées ni journalisées ; l’audit contient seulement l’action, les identifiants locaux, l’environnement et un code d’erreur contrôlé. Les identifiants `client_id` sont publics, mais les secrets, leurs versions chiffrées et les jetons ne sont jamais retournés par les API de consultation.

Le renouvellement est déclenché au besoin pendant une vérification, selon `expires_in`, avec une marge de soixante secondes. Un verrou persistant empêche deux processus d’utiliser simultanément le même refresh token. La nouvelle paire rotative est sauvegardée avant les lectures suivantes. Une rotation non confirmée ou un verrou abandonné exige une nouvelle autorisation : l’ancien refresh token n’est **pas réessayé automatiquement**. Le premier appel après un verrou expiré sécurise l’état ; la déconnexion peut alors être relancée.

**Déconnecter et retirer les secrets** demande la révocation RFC 7009 du refresh token connu, puis efface les secrets et jetons locaux après confirmation. Si la révocation n’est pas confirmée, les données chiffrées restent disponibles pour réessayer, mais leur utilisation est bloquée. Après une réponse de renouvellement perdue ou un crash, une nouvelle paire peut avoir été émise sans avoir été sauvegardée : révoquer aussi l’application/le consentement dans le compte SuperPDP avant de repartir. Une confirmation de révocation du jeton connu ne prouve pas à elle seule la révocation de jetons devenus inconnus du serveur.

La rotation du **secret de l’application OAuth** est distincte du remplacement de la **clé de chiffrement du serveur**. Pour cette dernière, déconnecter les entreprises avec l’ancienne clé avant d’en changer, ou prévoir une migration de rechiffrement dédiée. Perdre cette clé rend les données indéchiffrables ; restaurer la bonne clé depuis sa sauvegarde. À défaut, révoquer les consentements côté SuperPDP puis faire retirer les enregistrements devenus inutilisables par une intervention d’administration vérifiée ; le connecteur ne contourne pas le chiffrement.

Les sauvegardes SQLite assainies retirent les connexions et états OAuth de la copie, sans modifier la base source. Les dumps PostgreSQL restent chiffrés par le mécanisme de sauvegarde existant ; conserver séparément la phrase de sauvegarde et la clé SuperPDP. Une restauration PostgreSQL ou une conversion SQLite → PostgreSQL invalide les états en attente et place les grants copiés en réautorisation obligatoire. Arrêter le serveur source avant de migrer/restaurer et révoquer puis renouveler le consentement pour ne pas exploiter la même paire rotative sur deux serveurs.

API (toutes réservées à l’administrateur du compte courant) :

- `GET /api/fiscal-entities/:id/superpdp` : état non sensible et disponibilité du connecteur.
- `PUT /api/fiscal-entities/:id/superpdp/config` : `{ revision, client_id, client_secret?, sandbox_number }` ; la révision empêche l’écrasement d’une configuration périmée.
- `POST /api/fiscal-entities/:id/superpdp/connect` : URL de consentement avec protection de session.
- `GET /api/fiscal-entities/superpdp/oauth/callback` : retour OAuth, à enregistrer à l’identique chez SuperPDP.
- `POST /api/fiscal-entities/:id/superpdp/check` : vérification d’identité et renouvellement si nécessaire.
- `DELETE /api/fiscal-entities/:id/superpdp` : révocation du jeton connu et retrait des secrets après confirmation.

La migration additive `20261016170000_superpdp_oauth` est fournie pour SQLite et PostgreSQL. Elle n’altère aucune facture, aucun PDF et aucun calcul. Prévoir une sauvegarde récupérable et un déploiement complet **uniquement lorsqu’il sera autorisé**. Vérifier aussi la politique de journalisation du proxy et du serveur : les URL de callback contiennent transitoirement un code OAuth et un `state`, qui ne doivent pas être conservés dans des journaux d’accès non expurgés. Les tests automatisés utilisent un fournisseur simulé ; la recette réelle exige les identifiants et le consentement de test de l’utilisateur, qui ne sont pas fournis par le dépôt.

## Émission électronique SuperPDP B2B de test (étape 5)

Le développement ne nécessite pas de déployer les étapes précédentes. La recette avec le vrai fournisseur nécessite en revanche une installation de test distincte, sa connexion OAuth vérifiée et le consentement de l’utilisateur. Aucun déploiement ni appel réel de facturation n’est effectué par les tests automatisés.

Le connecteur d’émission est **désactivé par défaut**. Dans l’environnement serveur de test uniquement, ajouter `SUPERPDP_SANDBOX_EMISSION_ENABLED=true` en plus de la configuration OAuth de l’étape 4. Le worker nécessite aussi `ORGANIZATION_JOB_WORKER_ENABLED=true` ; sans worker, les demandes restent en file. Le serveur ne démarre aucun worker en `NODE_ENV=test`. Aucun réglage ne permet d’envoyer en production.

### Parcours manuel

1. Préparer une facture ou un avoir avec des **données entièrement fictives**, un émetteur rattaché à l’entreprise de test connectée et un acheteur professionnel français. Les brouillons, documents historiques, documents sans instantané structuré, B2C et B2B international sont refusés. Le B2C/e-reporting et les encaissements restent réservés à l’étape 7.
2. Valider localement la facture par le parcours existant. Son numéro, son instantané fiscal et son PDF ne seront plus modifiés par le transport.
3. Dans sa fiche, renseigner les adresses électroniques complètes de test du vendeur et de l’acheteur (`schéma:identifiant`). Copier l’adresse de réponse depuis l’annuaire de l’entreprise connectée : elle doit être en état `created` et rattachée au même `company_id`. Aucun annuaire, mandat ou destinataire n’est créé automatiquement. Une adresse française `0225:` doit reprendre le SIREN acheteur figé ; les autres schémas restent soumis aux contrôles du fournisseur. Les adresses sont une configuration de transport séparée de l’instantané local.
4. Confirmer l’usage de données fictives, puis **Préparer et valider le Factur-X**. La requête enregistre atomiquement la préparation et une tâche persistante ; elle ne fait pas de dépôt. Le worker reprend le PDF archivé après contrôle de son SHA-256, complète le candidat EN16931 avec les adresses et `process_control.specification_identifier=urn:cen.eu:en16931:2017`, appelle la conversion multipart `POST /v1.beta/invoices/convert?from=json&to=factur-x` avec les parties `invoice` et `pdf`, puis `POST /v1.beta/validation_reports`. Ces deux routes publiques ne reçoivent pas le jeton OAuth.
5. Lire le rapport et télécharger l’archive. Un rapport vide, incohérent, négatif, sans contrôle exécuté ou contenant des échecs bloque le dépôt. Le lisible source est conservé ; le PDF retourné par SuperPDP est une archive distincte, avec son empreinte et un `DocumentAsset`. Les contrôles préalables ne constituent pas une attestation indépendante de conformité ni une garantie d’acheminement.
6. Confirmer de nouveau les données fictives et cliquer **Déposer dans SuperPDP de test**. Une autre tâche effectue le dépôt avec `processing_rule=B2B`, le Factur-X exact validé et un `external_id` UUID de 36 caractères. Les contrôles synchrones du fournisseur ne sont jamais désactivés. La connexion et son entreprise sont revérifiées avant les appels ; le verrou OAuth de l’étape 4 empêche renouvellement, révocation et transport concurrents. Les droits de l’administrateur demandeur sont recontrôlés avant conversion et dépôt.

**Ne pas prendre une facture réelle puis changer seulement ses adresses pour simuler Burger Queen/Tricatel.** Aucun SIREN, SIRET, nom, montant ou identité du PDF n’est substitué automatiquement ; les règles du bac à sable peuvent refuser une identité locale incompatible. Une recette réelle doit donc établir un jeu fiscal/PDF cohérent avec les entreprises fictives et les formats acceptés par SuperPDP. Les tests locaux simulent la conversion et le dépôt ; ils ne prouvent pas que le fournisseur accepte un jeu particulier de données ou le profil français complet. Tout rejet reste bloquant, sans contournement du validateur ou du précontrôle.

### Dépôt incertain et suivi

`ElectronicInvoiceTransmission` conserve une ligne par compte/facture/environnement, liée par des clés étrangères composites à la facture et à la connexion de la **même entité fiscale**. Chaque préparation possède un identifiant, le JSON exact et son SHA-256, ainsi que les empreintes de l’instantané local et du PDF source. Une repréparation n’est autorisée qu’avant toute tentative de dépôt ; son JSON et les résultats antérieurs restent conservés dans les événements append-only. Les archives successives ne s’écrasent pas.

Le worker marque durablement le début du POST **avant** l’appel réseau. Après ce marqueur, aucun chemin de reprise ne rejoue le dépôt, même après crash, expiration de verrou, erreur HTTP ou absence dans la recherche. Un résultat incertain devient `send_unknown`. Le rapprochement parcourt `GET /v1.beta/invoices?direction=out&order=asc&starting_after_id=…`, une page de 100 par tâche, et cherche l’`external_id` dans le compte connecté. Une recherche infructueuse n’autorise jamais un renvoi : vérifier manuellement dans SuperPDP. L’API ne documentant pas de clé d’idempotence de dépôt, cette politique privilégie le blocage d’un doublon à un renvoi incertain.

Un dépôt HTTP confirmé reste `submitted`, pas « acheminé ». Les événements sont récupérés par `GET /v1.beta/invoice_events?invoice_id=…&starting_after_id=…`, avec vérification de la facture distante et de son entreprise, pagination croissante et mise à jour atomique du curseur avec l’historique. Les doublons sont dédupliqués par identifiant distant ; les nouveaux codes sont conservés. L’interface affiche les 200 derniers événements, pas un état réglementaire exclusif. Le paiement local et les envois email restent indépendants, y compris en présence d’un événement `fr:212`.

Le worker programme le suivi des dépôts de test connus ou incertains toutes les cinq minutes, et reprend plus vite quand il reste des pages. Le bouton **Synchroniser les événements SuperPDP** demande une tâche de lecture ; **Actualiser l’état local** ne contacte pas SuperPDP. Les erreurs de transport ne propagent ni les corps HTTP bruts ni les exceptions OAuth. Les rapports conservent les messages du validateur et leurs emplacements, sans champ `raw`, et sont réservés à l’administrateur.

Après copie/restauration, les préparations conservées restent bloquées pour la repréparation et le dépôt, **même si l’ancienne sauvegarde ne contient pas de marqueur de dépôt** : un envoi a pu intervenir entre la sauvegarde et l’incident. Vérifier l’historique côté SuperPDP avant toute intervention d’administration. Une nouvelle connexion OAuth ne lève pas ce blocage.

API : `GET /api/invoices/:id/electronic`, `GET /api/invoices/:id/electronic/factur-x`, `POST /api/invoices/:id/electronic/prepare` (`revision`, `seller_address`, `buyer_address`, `confirm_test_data:true`), `POST /api/invoices/:id/electronic/send` (`revision`, `confirm_test_data:true`), `POST /api/invoices/:id/electronic/sync`. Tous ces accès exigent une session d’administrateur du compte ; les mutations contrôlent l’origine. Les réponses de gestion ne sont pas mises en cache. Les tâches n’embarquent que l’identifiant local et la révision, jamais les secrets ou jetons.

La migration additive `20261016190000_superpdp_emission` est fournie pour SQLite/PostgreSQL ; elle ne modifie aucune facture existante. Les archives sont stockées sous `DATA_DIR/organizations/{compte}/{PDF_SUBDIR}/electronic/sandbox/…`. Le mécanisme de sauvegarde inclut désormais les répertoires documentaires par compte. Une copie SQLite assainie conserve les clés de connexion nécessaires à l’historique mais retire les secrets ; une restauration PostgreSQL et une conversion SQLite → PostgreSQL suspendent les transmissions. Les tâches SuperPDP en attente sont neutralisées à la restauration. Les dépôts déjà tentés restent non rejouables. Aucune reprise automatique d’un ancien envoi après restauration n’est permise.

Référence : [OpenAPI SuperPDP](https://www.superpdp.tech/openapi/), version `1.37.0.beta` consultée le 16/10/2026. Un sous-ensemble structurel versionné est conservé dans `server/tests/fixtures/superpdp-1.37.0.beta.json` pour les tests de contrat ; ce n’est pas une copie complète ni une spécification OpenAPI autonome.

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

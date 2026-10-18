# Recette native SuperPDP, isolée des factures métier

Depuis le 18/10/2026, un [atelier web de recette](superpdp-workshop.md) distinct permet également un parcours guidé depuis l'interface locale : copie anonymisée du montant d'une réservation, vérification, émission figée, dépôt, suivi et avoir intégral. Le présent document décrit toujours l'outil opérateur en ligne de commande et ses preuves historiques ; ne pas rejouer ces dépôts depuis l'un ou l'autre parcours.

## Périmètre et limites

Parcours **opérateur local uniquement**, autorisé le 16/10/2026. Il réutilise le calcul fiscal, le modèle PDF de l'application, le constructeur EN16931 et les services OAuth/transport existants. Il ne crée pas de `Facture`, ne consomme aucune séquence et n'écrit aucune identité légale dans les entreprises ou établissements. Le PDF et les données structurées portent une mention de test explicite.

Ce n'est **pas** une nouvelle fonction d'émission depuis les formulaires de facturation, ni une interface SaaS utilisable par les clients. Il n'y a aucune nouvelle route HTTP, tâche automatique ou activation permanente. Le cycle brouillon → émission métier figée → transmission reste à qualifier séparément avec des identités de test appropriées. Les contrôles SIREN/SIRET, de TVA et de routage des factures normales restent inchangés.

Le parcours accepte seulement la paire fictive SuperPDP **Burger Queen (`000000002`) → Tricatel (`000000001`)**, avec connexions sandbox déjà consenties et vérifiées. Le nom d'affichage local peut différer. L'identité est liée au compte, à l'entité, à sa connexion, au numéro sandbox vérifié et à l'identifiant distant. Les adresses Peppol doivent être confirmées dans les annuaires des deux comptes. Les numéros sandbox ne sont jamais copiés dans les champs SIREN locaux ; aucun SIRET n'est inventé.

Le jeu de données est versionné et figé dans `buildSandboxRecipe` : deux prestations fictives, 150 EUR HT + 25 EUR de TVA = 175 EUR TTC. Les taux 20 %/10 %, les exemples de TVA, les adresses fictives et les conditions de paiement servent uniquement à la recette technique. Ils ne qualifient pas fiscalement une activité de location.

Contrat fournisseur consulté : [OpenAPI SuperPDP](https://api.superpdp.tech/openapi/superpdp.json), version `1.37.0.beta`, le 16/10/2026. Les identités et le préfixe Peppol proviennent du générateur officiel observé ; ce n'est pas un algorithme général pour raccorder une entreprise. Arrêter et requalifier le jeu si le fournisseur change ces conventions.

## Conditions bloquantes

- `NODE_ENV=development`, base SQLite exactement `server/prisma/dev.db`, confirmation opérateur explicite ; PostgreSQL et un autre chemin de base sont refusés.
- Connecteur sandbox activé, mais émission/réception/B2C ordinaires, worker et automatisations multi-compte désactivés. Les PDF factices sont interdits.
- Session propriétaire active du compte ; accès OAuth via le service existant, sans copier ni afficher les secrets ou jetons.
- Les deux entreprises locales restent sans SIREN et leurs connexions sont vérifiées pour les numéros fictifs attendus. Le service recontrôle réellement l'environnement et l'identité distants.
- Conversion et validation positives avant la préparation puis nouvelle validation avant le dépôt ; chaque sous-rapport doit être sans échec, avec des contrôles effectivement exécutés. Aucun contournement du contrôle synchrone fournisseur.
- Relecture humaine du PDF final, attestée avec son empreinte. Le manifeste lie compte/connexions, données figées, date, référence externe et empreintes des deux PDF.

Les garde-fous sont des restrictions supplémentaires du script ; aucune variable ne déverrouille la production du connecteur applicatif.

## Utilisation encadrée

Depuis `server/`, après sauvegarde privée de la base et autorisation explicite de réaliser une nouvelle recette fournisseur. Ne pas inscrire de secrets dans les commandes ou dans ce document.

```sh
SUPERPDP_LOCAL_RECIPE_CONFIRMED=1 npm run superpdp:recette -- prepare ORG_ID SELLER_ENTITY_ID BUYER_ENTITY_ID
```

Remplacer les trois identifiants par ceux du compte local de test. La commande vérifie les annuaires, crée un identifiant d'exécution UUID inédit, produit le PDF natif, le convertit en Factur-X et conserve le rapport. Elle n'envoie aucune facture. Les preuves sont privées dans `DATA_DIR/superpdp-recette/native-v1/UUID/`, hors Git ; dossiers nouvellement créés en `700`, fichiers en `600`.

Inspecter visuellement **toutes les pages du Factur-X final**, vérifier les identités, les montants, le bandeau de test et le rapport. Puis attester la relecture avec l'empreinte retournée :

```sh
SUPERPDP_LOCAL_RECIPE_CONFIRMED=1 npm run superpdp:recette -- review UUID --reviewed-sha256=SHA256
```

Un envoi exige une étape manuelle distincte :

```sh
SUPERPDP_LOCAL_RECIPE_CONFIRMED=1 npm run superpdp:recette -- send UUID --confirm-sandbox-once
```

Le journal crée **exclusivement** et synchronise sur disque `send-intent.json` avant le POST. Deux demandes concurrentes utilisant ce même journal ne peuvent pas déclencher deux POST. Toute intention déjà présente interdit un nouvel essai, même si le résultat n'a pas été confirmé, ou si le processus s'est interrompu avant le POST. La réponse brute conforme au schéma est conservée avant les contrôles de correspondance ; aucune erreur arbitraire ni réponse OAuth n'est archivée dans ce journal.

Le suivi est distinct et ne renvoie rien :

```sh
SUPERPDP_LOCAL_RECIPE_CONFIRMED=1 npm run superpdp:recette -- observe UUID
```

Il recherche la référence externe côté émetteur et la facture côté destinataire, vérifie l'empreinte de l'original reçu et conserve les événements. La pagination est bornée ; un suivi incomplet ou sans résultat ne prouve jamais l'absence d'un envoi.

**Ne jamais supprimer/réinitialiser le journal, changer de référence ni refaire `prepare` pour retenter un résultat inconnu.** Les preuves et références doivent rester disponibles sur le poste opérateur et dans une sauvegarde privée. Une restauration de base ne rappelle aucun dépôt distant. Si le journal n'est pas disponible ou a été restauré à un état antérieur, ne pas envoyer : rapprocher les preuves et l'état fournisseur, avec le support si nécessaire. Cette protection locale n'est pas une garantie d'idempotence globale du fournisseur entre plusieurs postes ou copies de données.

La réception utilise le service applicatif habituel, indépendamment de cet outil d'émission. Pour la recette réalisée ci-dessous, elle a été activée uniquement dans un processus manuel limité à la facture attendue, puis arrêtée, sans daemon ni modification des fichiers d'environnement. Ne pas activer un worker général pour rejouer cet exemple.

## Résultats réels du 16/10/2026 — ne pas rejouer

1. Le document du générateur SuperPDP, déjà déposé précédemment, a été importé dans les achats de Tricatel avec le service natif et une tâche native ciblée : original inchangé, extraction et événements disponibles, deuxième passage sans doublon. Aucune dépense créée et synchronisation arrêtée. Preuves privées : `server/data/superpdp-recette/20261016-generator-reception/`.
2. La nouvelle facture issue du **moteur PDF de l'application**, référence `TEST-PDP-20261016-54537248`, a été convertie, validée (191 contrôles, aucun échec), inspectée visuellement sur sa page unique, puis déposée **une seule fois**. Exécution : `54537248-cc0c-4070-8c5c-91e50cfb4834` ; émission distante `1293899`, réception `1293900`.
3. Événements observés : `api:uploaded`, `fr:200`, `fr:201`, `fr:202`, `fr:203`. Ils ne prouvent ni paiement ni acceptation administrative.
4. L'original reçu a la même empreinte SHA-256 que le Factur-X envoyé. L'import natif existe dans l'application sous `69576df0-f558-4e1d-a7c5-1263f8ed2cfd`. L'interface montre 150 EUR HT, 25 EUR de TVA et 175 EUR TTC, les liens vers l'original et le structuré, ainsi que les événements de réception.
5. La comparaison des données reçues est positive après prise en compte de trois normalisations de représentation fournisseur : quantités `1` → `1.0000`, omission des montants nuls payé/arrondi, ajout du code de régime de taxe `VAT`. Les valeurs, identités, lignes, conditions, notes et autres champs concordent. Le premier contrôle strict JSON s'était arrêté sur ces différences ; aucun renvoi n'a eu lieu. Les originaux et données archivées n'ont pas été réécrits.
6. Un nouveau passage de réception ne crée aucun doublon et conserve les curseurs. Aucun document n'apparaît dans la boîte d'achats de Burger Queen. Les deux réceptions restent non rapprochées ; aucune facture métier, transmission métier, dépense ou paiement n'est créé. La synchronisation est arrêtée et aucune tâche de réception n'est en attente/en cours à la fin.

Preuves complètes de la seconde recette : `server/data/superpdp-recette/native-v1/54537248-cc0c-4070-8c5c-91e50cfb4834/`, hors Git. PDF témoin local : `output/pdf/superpdp-facture-native-sandbox-20261016.pdf`. Conserver ces preuves ; ne pas reproduire les commandes d'envoi pour cette exécution.

Aucun déploiement. Aucun changement de fiches légales ni de rattachements. Les recettes d'avoir, de rapprochement humain, de B2C/e-reporting, d'incidents/restauration, de SaaS et du cycle complet de facturation métier ne sont pas attestées par ce seul résultat.

Vérifications locales finales : **529 tests réussis** (17 partagés, 399 serveur, 113 client), aucun échec ni test ignoré ; compilation complète réussie, outil opérateur vérifié séparément par TypeScript strict ; lint sans erreur (36 avertissements de hooks préexistants). Les tests ajoutés couvrent les garde-fous d'environnement/base, la paire fictive et le routage, les calculs et les rendus distincts, les rapports contradictoires, la concurrence/non-rejeu, les permissions de fichiers et les liens symboliques. Ils ne contactent pas le fournisseur. La suite générale utilise une base temporaire de repli migrée ; la base utilisateur n'a été ni migrée, ni réinitialisée, ni réensemencée.

Une comparaison des tables d'entreprises, établissements, gîtes, factures, compteurs/séquences, frais ponctuels, transmissions et paiements avec la sauvegarde privée antérieure est positive : aucune différence. Les écritures attendues concernent les connexions OAuth/audits, les deux archives entrantes, leurs actifs/événements et les tâches ciblées de réception. Le contrôle SQLite et la santé localhost sont positifs. Les preuves locales et PDF restent exclus du commit.

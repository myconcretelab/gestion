# Migration multi-tenant

## Identité historique

L'installation existante devient l'organisation `org_historical_broceliande`, de slug `historique`.
Cet identifiant est déterministe et ne doit jamais être modifié après une migration.

## Modèle

- Global : `users`, `organizations` et les catalogues techniques (`app_user_status_presets`, `security_throttles`).
- Appartenance : `memberships` porte le rôle, le statut et les permissions d'un utilisateur dans une organisation.
- Profil métier : `app_users` reste le profil propriétaire/intervenant propre à une organisation et référence `users` par `user_id`.
- Réglages : `organization_settings` est la source canonique du profil, de la langue, devise, fuseau, marque, documents et modules. `installation_config` est conservée et synchronisée pour la compatibilité historique.
- Données métier : toutes les tables de gîtes, photos, réservations, demandes, contrats, factures, compteurs, frais, déclarations, calendriers, plannings, interventions, contenus, jetons, partages et jobs portent `organization_id`.

## Migration

Les migrations `20261007120000_multitenant_expand` SQLite et PostgreSQL :

1. créent les tables globales et les réglages d'organisation ;
2. créent l'organisation historique ;
3. copient les identités sans modifier les identifiants, mots de passe ou versions d'authentification ;
4. créent une appartenance par profil existant ;
5. rattache toutes les lignes persistantes à l'organisation historique ;
6. remplace les contraintes uniques métier globales par leur équivalent tenant-aware.

Aucune colonne ni table historique n'est supprimée. Prisma détecte une migration déjà appliquée dans `_prisma_migrations`; la version PostgreSQL accepte aussi une reprise grâce à `IF NOT EXISTS` et `ON CONFLICT`.

## Fichiers

Les fichiers historiques ne sont pas déplacés par la migration SQL. Ils restent lisibles par leurs chemins enregistrés. Les nouveaux fichiers sont écrits sous `organizations/{organizationId}/`.

`npm run files:migrate-tenants -w server` effectue un dry-run. Ajouter `-- --copy` pour copier sans supprimer les originaux. Chaque copie est contrôlée par taille et SHA-256 et journalisée. Une relance reprend les destinations déjà présentes et les revalide.

## Déploiement de production

1. Mettre l'application en maintenance et arrêter les jobs, imports et écritures.
2. Relever la révision, l'état Git, le nombre de fichiers et le rapport de parité avant migration.
3. Produire un dump PostgreSQL complet et une archive du stockage, dans deux emplacements distincts.
4. Restaurer ces deux sauvegardes dans un environnement temporaire et vérifier l'ouverture de documents échantillonnés.
5. Tester la migration deux fois sur cette restauration, puis comparer le rapport de parité et les empreintes déterministes.
6. Déployer la révision validée avec le déploiement complet seulement après autorisation explicite.
7. Exécuter le rapport après migration, vérifier les orphelins, totaux, sessions, accès historiques et refus inter-organisations.
8. Réactiver les jobs puis vérifier `/api/health`, l'interface authentifiée, un PDF et une intégration par organisation.

## Rollback

Avant toute nouvelle écriture, revenir à la révision applicative précédente et restaurer ensemble le dump PostgreSQL et l'archive de fichiers validés. Ne pas tenter un rollback partiel des colonnes : la migration est additive, et l'ancienne application ignore les nouvelles tables et colonnes. Si des écritures ont eu lieu après migration, conserver la base migrée en quarantaine pour réconciliation avant toute restauration.

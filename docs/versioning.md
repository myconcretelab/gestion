# Politique de versions

Le projet suit SemVer : correctif pour une correction compatible, mineure pour une fonctionnalité compatible, majeure pour une rupture d'API, de configuration ou de données.

Chaque version publiée comporte un tag, des notes de migration et les versions minimales de Node/PostgreSQL. Les migrations de base sont monotones : aucune publication ne dépend d'un reset ou d'un seed. Une sauvegarde vérifiée précède toute mise à jour de production.

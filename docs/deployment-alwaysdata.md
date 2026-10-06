# Déploiement spécifique Alwaysdata

Cette documentation est propre à l'installation historique et n'est pas la procédure générique distribuée. Les hôtes, comptes, chemins et jetons restent dans les fichiers locaux non versionnés et dans les consignes d'exploitation de cette installation.

Utiliser le script `update` uniquement depuis le serveur cible ou son wrapper local autorisé. Avant toute migration : contrôler l'arbre distant, réaliser une sauvegarde récupérable, exécuter la mise à jour complète, puis vérifier la révision, `/api/health` et les pages modifiées. Ne jamais lancer de reset ou de seed.

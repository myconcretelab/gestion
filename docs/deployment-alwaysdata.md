# Déploiement spécifique Alwaysdata

Cette documentation est propre à l'installation historique et n'est pas la procédure générique distribuée. Les hôtes, comptes, chemins et jetons restent dans les fichiers locaux non versionnés et dans les consignes d'exploitation de cette installation.

Utiliser le script `update` uniquement depuis le serveur cible ou son wrapper local autorisé. Avant toute migration : contrôler l'arbre distant, réaliser une sauvegarde récupérable, exécuter la mise à jour complète, puis vérifier la révision, `/api/health` et les pages modifiées. Ne jamais lancer de reset ou de seed.

## Mémoire pendant la compilation

Le script `./update` construit successivement le workspace partagé, le client et le serveur. Il impose des plafonds distincts : **768 Mio** de heap pour Vite et **832 Mio** pour la compilation TypeScript complète du serveur. Les contrôles de types restent activés. Les modes complet et léger utilisent la même procédure de compilation.

Ces valeurs sont versionnées dans le script, indépendamment du `NODE_OPTIONS` global utilisé par les commandes auxiliaires. Elles peuvent être ajustées dans la configuration privée avec `CLIENT_BUILD_HEAP_MB` et `SERVER_BUILD_HEAP_MB` (entiers positifs), après vérification des ressources de l’hébergement. Ne pas augmenter globalement `NODE_OPTIONS` pour résoudre une erreur du seul serveur : cela peut faire dépasser à Vite la limite mémoire du processus.

Valeurs vérifiées sur Alwaysdata le 24 octobre 2026 : Vite réussit à 768 Mio ; la compilation complète du serveur réussit à 832 Mio, avec un maximum de mémoire résidente observé de 998 460 Kio. Un heap serveur de 768 Mio échoue ; un plafond global de 1152 Mio provoque l’arrêt de Vite par l’hébergement. Une croissance future du projet peut nécessiter une nouvelle mesure ou une compilation sur une machine plus dotée.

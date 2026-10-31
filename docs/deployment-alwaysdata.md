# Déploiement spécifique Alwaysdata

Cette documentation est propre à l'installation historique et n'est pas la procédure générique distribuée. Les hôtes, comptes, chemins et jetons restent dans les fichiers locaux non versionnés et dans les consignes d'exploitation de cette installation.

Utiliser le script `update` uniquement depuis le serveur cible ou son wrapper local autorisé. Avant toute migration : contrôler l'arbre distant, réaliser une sauvegarde récupérable, exécuter la mise à jour complète, puis vérifier la révision, `/api/health` et les pages modifiées. Ne jamais lancer de reset ou de seed.

## Démarrage sans lanceurs npm permanents

Dans la configuration du site Node.js, utiliser la commande **`node dist/index.js`** et le **répertoire de travail `server/` de l'installation**. Le chemin du répertoire doit être renseigné selon les conventions Alwaysdata, relativement au répertoire du compte ou en chemin absolu.

Ce démarrage conserve le répertoire utilisé par `npm run start -w server`, ainsi que la résolution des fichiers d'environnement, des données, des modèles PDF et du client compilé. La version de Node.js et l'environnement du site restent ceux configurés sur l'hébergement. Les commandes npm du dépôt restent disponibles pour le développement et les opérations ponctuelles.

Éviter `npm run start` comme commande permanente de l'hébergeur : le script racine lance un second npm dans le workspace serveur et conserve deux processus npm, en plus du serveur et de leurs shells. Le démarrage direct supprime ces intermédiaires ; il ne modifie pas les tâches planifiées Smart Life et iCal ni les automatismes internes.

Avant de changer la configuration, vérifier le fichier compilé avec `node --check server/dist/index.js` depuis la racine de l'installation et relever les processus du site. Après le redémarrage Alwaysdata, vérifier `/api/health`, une page authentifiée, le prochain appel automatique et la présence d'un seul processus Node pour ce site, sans lanceur npm. Comparer la mémoire après stabilisation ; la somme des RSS peut compter plusieurs fois les pages partagées.

Le délai d'inactivité du site ne suffit pas à économiser la mémoire tant qu'une tâche appelle son API plus fréquemment que ce délai. Ne pas désactiver ces appels pour provoquer une mise en veille sans préserver les fonctions qu'ils assurent.

## Mémoire pendant la compilation

Le script `./update` construit successivement le workspace partagé, le client et le serveur. Il impose des plafonds distincts : **768 Mio** de heap pour Vite et **832 Mio** pour la compilation TypeScript complète du serveur. Les contrôles de types restent activés. Les modes complet et léger utilisent la même procédure de compilation.

Ces valeurs sont versionnées dans le script, indépendamment du `NODE_OPTIONS` global utilisé par les commandes auxiliaires. Elles peuvent être ajustées dans la configuration privée avec `CLIENT_BUILD_HEAP_MB` et `SERVER_BUILD_HEAP_MB` (entiers positifs), après vérification des ressources de l’hébergement. Ne pas augmenter globalement `NODE_OPTIONS` pour résoudre une erreur du seul serveur : cela peut faire dépasser à Vite la limite mémoire du processus.

Valeurs vérifiées sur Alwaysdata le 24 octobre 2026 : Vite réussit à 768 Mio ; la compilation complète du serveur réussit à 832 Mio, avec un maximum de mémoire résidente observé de 998 460 Kio. Un heap serveur de 768 Mio échoue ; un plafond global de 1152 Mio provoque l’arrêt de Vite par l’hébergement. Une croissance future du projet peut nécessiter une nouvelle mesure ou une compilation sur une machine plus dotée.

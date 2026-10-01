# Heures des intervenants sur Aujourd'hui

Sous les poubelles, les personnes actives choisies apparaissent sous forme de boules.
Choisir les personnes depuis « Choisir » ou dans Paramètres > Intervenants,
avec « Afficher sur Aujourd'hui ». La sélection est commune aux appareils.

Un appui ouvre un éventail : ½ h, 1 h, 2 h ou une durée libre en heures décimales.
Après le choix, un second appui au centre valide explicitement la durée.
Le total du jour ouvre les saisies ; chaque ajout peut être corrigé ou annulé.
Le sélecteur de date permet de saisir et consulter un autre jour.
Les durées sont stockées en minutes entières, de 1 minute à 24 heures par saisie.
Ces heures sont un suivi du temps : elles ne créent pas automatiquement de frais.

## Enregistrement

Chaque ajout possède un UUID conservé lors d'un échec réseau ; une nouvelle
tentative avec ce même identifiant ne double pas le temps. Les annulations
conservent une entrée supprimée pour empêcher une ancienne tentative de la
recréer. Une correction vérifie la version lue pour éviter d'écraser celle
d'un autre appareil. La suppression d'un intervenant conserve ses saisies et son nom.

## Validation et déploiement

Cette évolution ajoute une colonne et une table. Utiliser un déploiement complet,
après sauvegarde récupérable de la base, et non le mode --light.

Avant publication :
- appliquer les migrations de développement et régénérer Prisma ;
- exécuter npm run test et npm run build ;
- vérifier sur mobile et ordinateur l'éventail, la confirmation, Annuler,
  les corrections et les dates passées.

Les tests client vérifient les conversions sans arrondi et les libellés.
Les tests serveur vérifient les dates, la validation, les nouvelles tentatives,
l'annulation et les conflits de correction avec un modèle de persistance simulé.

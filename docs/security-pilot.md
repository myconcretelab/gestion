# Durcissement du pilote et traitement de l'historique Git

## Données identifiées

Le dépôt courant ne suit plus `data/import-log.json` ni `server/server/prisma/dev.db`. Les bases, sauvegardes, PDF, journaux, exports tabulaires, fichiers bureautiques, clés et répertoires de données sont désormais ignorés.

L'historique Git contient encore le blob `server/prisma/dev.db.bak-20260506164132` (environ 132 Mo). L'inspection limitée aux métadonnées confirme qu'il contient des données réelles : réservations, contrats, facture, coordonnées, coordonnées bancaires, URL Airbnb, sources iCal et jetons d'export iCal. Ce constat doit être traité comme une exposition aux personnes et systèmes ayant pu lire le dépôt.

Actions d'incident recommandées avant toute purge :

1. inventorier les personnes, robots, forks, caches CI et sauvegardes ayant eu accès au dépôt ;
2. régénérer tous les jetons d'export iCal et remplacer les URL de sources iCal qui embarquent un secret ;
3. révoquer tout secret d'intégration qui aurait pu être stocké dans des données ou journaux historiques ;
4. évaluer l'impact sur les voyageurs, propriétaires et demandes de réservation selon la politique de notification applicable ;
5. conserver une preuve privée des constats et des dates de rotation, sans recopier les données dans un ticket public.

## Procédure proposée de purge (non exécutée)

Cette opération réécrit tous les identifiants de commits concernés et impose un push forcé coordonné. Elle ne doit être lancée qu'après accord explicite, gel des pushes et sauvegarde récupérable.

1. Annoncer une fenêtre de maintenance Git et bloquer temporairement les pushes.
2. Créer un miroir privé de sauvegarde, chiffré et à accès restreint.
3. Travailler dans un clone miroir neuf, avec `git-filter-repo` installé depuis une source vérifiée.
4. Retirer de toutes les références les chemins suivants :

   ```text
   server/prisma/dev.db.bak-20260506164132
   server/server/prisma/dev.db
   data/import-log.json
   ```

5. Réexécuter l'inventaire des objets et un scanner de secrets sur toutes les références. Étendre la liste si d'autres blobs réels sont découverts.
6. Vérifier sur une copie de test que la branche principale se construit et que les migrations restent présentes.
7. Forcer la mise à jour de toutes les branches et étiquettes du dépôt distant avec `--force-with-lease`, après une dernière confirmation explicite.
8. Expirer les caches et artefacts CI concernés et demander la suppression des forks ou copies non nécessaires.
9. Faire recloner le dépôt à chaque contributeur ; ne pas fusionner d'anciennes branches, qui réintroduiraient les blobs purgés.
10. Contrôler de nouveau le serveur Git distant et documenter les nouveaux identifiants de commits.

Impacts : liens vers les anciens commits invalidés, branches locales à recréer, pull requests potentiellement fermées ou recalculées, signatures de commits non conservées, risque de réintroduction par un ancien clone. La purge réduit la disponibilité courante mais n'efface pas les copies déjà téléchargées ; la rotation et l'évaluation d'incident restent donc obligatoires.

# Reprise des règlements historiques — 2 novembre 2026

Outil ponctuel propre à l’installation historique. Le propriétaire a confirmé que les séjours antérieurs à octobre étaient déjà payés et a demandé une date reconstituée deux jours après leur sortie.

Depuis la racine du dépôt, avec le serveur compilé et la bonne configuration de base :

```sh
node server/tools/private/payment-dates/reconcile-historical.mjs
node server/tools/private/payment-dates/reconcile-historical.mjs --apply
```

La première commande affiche seulement un aperçu. Le périmètre comprend les quatre gîtes, toutes années confondues, avec une sortie au plus tard le 1er octobre 2026 (aucune nuit en octobre). Les montants nuls restent inchangés. Les dates attestées Stripe/relevé importé et les arrhes historiques déjà datées sont conservées. Un moyen de règlement inconnu reste inconnu.

L’application sauvegarde les réservations, règlements et contrats précédents, le plan précis, les identifiants créés et les rapports dans `server/data/backups/historical-payment-dates-*/before.json` (dossier 700, fichier 600). Une transaction refuse toute modification concurrente, vérifie les soldes et les dates, puis écrit une trace d’audit. Les dates reconstituées sont signalées dans les notes des règlements.

Exécution de production vérifiée : 2 438 réservations avec montant positif, 36 montants nuls, 2 457 règlements matérialisés ou ajoutés et 15 dates de saisies récentes corrigées. Aucun ancien séjour ne reste impayé ou rattaché à novembre 2026. Les deux arrhes historiques déjà datées sont conservées. Le rapport d’octobre de Sébastien est de 3 462,48 € après recalcul ; 140 € correspondent au séjour sorti le 1er octobre, daté au 3 octobre par la règle demandée.

Pour revenir sur la reprise, utiliser le snapshot et le plan : supprimer uniquement les règlements créés par cette exécution, restaurer les dates/notes des règlements modifiés et les champs de suivi des réservations et contrats sauvegardés, puis recalculer les rapports. Comparer auparavant les valeurs courantes au résultat de la reprise pour préserver les éventuelles modifications ultérieures. Ne pas restaurer globalement une ancienne base sur des données modifiées depuis.

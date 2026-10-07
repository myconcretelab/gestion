# Politique prudente et scénarios du pilote

## Matrice d’abonnement

| Statut interne | Lecture | Export | Écriture | Action opérateur/utilisateur |
| --- | --- | --- | --- | --- |
| Essai | oui | oui | oui | afficher la fin d’essai et proposer mensuel/annuel |
| Actif | oui | oui | oui | accès normal, portail disponible |
| Paiement en attente | oui | oui | oui | avertir et ouvrir le portail |
| Période de grâce | oui | oui | oui | afficher l’échéance de grâce et relancer la synchronisation |
| Suspendu | oui | oui | non | bloquer seulement les nouvelles écritures ; conserver toutes les données |
| Résilié | oui | oui | non | aucune suppression ; conservation selon la politique à valider |

Un premier échec de paiement produit `past_due` et fixe la fin de grâce. Une resynchronisation pendant ce délai produit `grace_period`; après l’échéance elle produit `suspended`. Un paiement régularisé revient à `active`. Une suppression Stripe produit `cancelled`.

Les quotas durs bloquent uniquement la nouvelle opération concernée. Les quotas souples enregistrent le dépassement et laissent l’opération réussir. Les événements d’usage portent une clé d’idempotence propre à l’organisation.

## Valeurs provisoires de staging

Le forfait `pilot_provisional` est explicitement temporaire. Il active uniquement réservations, contrats et factures. Les intégrations restent désactivées. Ses limites servent aux tests et ne constituent pas une offre commerciale : 2 hébergements, 3 gestionnaires, 5 intervenants (souple), 50 réservations/mois (souple), 50 documents/mois (souple), 100 Mio de stockage (souple), aucun SMS ni automatisation tant que les intégrations ne sont pas validées.

Le forfait historique `legacy_unlimited` reste archivé commercialement mais actif pour l’organisation historique, sans fournisseur de paiement et sans limite.

## Décisions encore attendues

- noms définitifs des forfaits ;
- prix mensuels et annuels ;
- quotas exacts par forfait ;
- caractère souple ou dur de chaque quota ;
- durée d’essai ;
- durée de grâce ;
- politique et durée de conservation après résiliation ;
- contenu exact du portail Stripe (résiliation immédiate ou fin de période, factures, changements de forfait) ;
- date d’ouverture, nombre d’organisations et critères de sortie du pilote ;
- activation explicite de `MULTITENANT_AUTOMATION_ENABLED` après revue de chaque intégration par organisation.

# Taxe de séjour au réel

La gestion dédiée s’active dans la fiche d’un gîte, rubrique Gestion → Fiscalité & banque. Sans configuration (`taxe_sejour_config = null`), les calculs historiques restent inchangés. La migration SQLite/PostgreSQL ajoute uniquement une colonne nullable, sans recalculer les réservations ou documents existants.

## Réglages du gîte

- Classement officiel : switch classé/non classé et nombre d’étoiles. Le classement active un tarif fixe ; un meublé non classé utilise le pourcentage et le plafond saisis.
- Inclusion : switch taxe comprise dans le prix annoncé/en supplément.
- Barème : tarif de base, taxes additionnelles (pourcentage du montant de base), TVA de l’hébergement pour reconstruire le prix HT proportionnel, collectivité et date d’application.
- Les tarifs sont saisis depuis le barème de la collectivité. Aucune grille locale ni classification officielle n’est déduite automatiquement. Un tarif fixe au réel n’est pas le régime fiscal de taxe au forfait, non pris en charge ici.

## Séjours et documents

Les réglages sont copiés dans `options.tourist_tax` et conservés avec le séjour. Les changements de barème n’altèrent pas les documents déjà enregistrés. Une reprise historique ou une actualisation de barème demande une action explicite dans le formulaire.

Le collecteur est à préciser : loueur, plateforme (avec son nom), non applicable (avec motif). La source de réservation ne prouve pas la collecte. Les demandes publiques en réservation directe utilisent la collecte par le loueur et le barème du gîte ; les visiteurs ne peuvent pas soumettre un barème ou un collecteur alternatif.

Les mineurs sont exonérés. Les enfants de moins de deux ans sont comptés séparément et entrent dans le diviseur proportionnel, comme les autres occupants. Les autres exonérations d’adultes nécessitent un nombre et un motif. Les effectifs restent constants sur chaque réservation ; les variations d’occupation nécessitent des séjours distincts.

Le prix d’hébergement après remise constitue la base avant options et prestations. La taxe s’ajoute uniquement si le loueur la collecte et qu’elle est en supplément. Si le prix la comprend, elle en est isolée. Une taxe comprise dans un prix et collectée par une plateforme est retirée du montant à régler au loueur ; le switch du séjour permet d’adapter ce réglage si un tarif importé exclut déjà la taxe.

Le calcul arrondit le tarif de base au centime, puis la taxe additionnelle au centime, avant multiplication par les personnes taxables et les nuits. Pour un prix proportionnel taxe comprise, le moteur recherche une ventilation exacte. Les prix sans solution compatible avec ces arrondis restent à corriger avant émission ; aucune incohérence n’est cachée dans la TVA.

Le calcul est commun au navigateur et au serveur. Les factures regroupées reprennent les barèmes et collecteurs de chaque séjour. La taxe est séparée des lignes de prestations, de la base TVA et des revenus statistiques. Les centimes de revenu sont conservés entre les mois. Un contrat exige un traitement complet ; une facture peut être enregistrée en brouillon, mais ses vérifications bloquent l’émission si la taxe est incohérente ou le collecteur inconnu. Un avoir intégral reprend la taxe de la facture source.

## Limites de cette étape

- Le registre d’encaissement, de déclaration et de reversement avec justificatifs et export n’est pas encore développé ; les rappels existants de nuitées restent disponibles.
- Les PDF locaux incluent la taxe. L’export EN16931/SuperPDP des factures avec taxe collectée par le loueur n’est pas implémenté : aucun instantané électronique candidat n’est produit pour ces factures et leur préparation distante reste bloquée. Les taxes collectées ailleurs n’augmentent pas le montant électronique des prestations.
- Les modifications futures doivent maintenir l’égalité entre le calcul archivé, la taxe séparée, le total à payer et les paiements, sans reclasser une taxe en ligne de prestation pour contourner l’export.

Références de cadrage : [Service Public](https://entreprendre.service-public.gouv.fr/vosdroits/F31635), [plateforme de Ploërmel Communauté](https://ploermelcommunaute.taxesejour.fr/), [BOFiP](https://bofip.impots.gouv.fr/bofip/392-PGP.html).

# Rapports et déclarations

`/rapports` utilise les réservations et le registre des règlements de l’organisation connectée. Le module Finances, le droit Statistiques et l’accès aux montants sont requis. Les commandes nécessitent aussi le droit d’écriture. La correction d’un logement, d’une entreprise ou d’un règlement conserve les droits de la page source.

## Sources et calculs

Le même moteur de calcul, dans `packages/shared/src/reports.ts`, sert au serveur et à l’aperçu de l’éditeur. Les règles, corrections internes, états de préparation et copies confirmées sont enregistrés dans `FinanceReportStore`, isolé par organisation et protégé par un numéro de révision. Les confirmations sont calculées sur le serveur : le navigateur ne fournit jamais le montant ou les opérations à figer. Chaque commande produit une entrée d’audit. Les identifiants des lignes restent stables lors d’une modification de ventilation. Une correction interne devient à vérifier si ses données sources changent.

- **Encaissement** : paiements manuels actifs, paiements Stripe reçus et règlements historiques issus des contrats. Aucune recette n’est déduite du seul prix d’une réservation impayée. Tous les moyens de paiement sont pris en compte. Les paiements Stripe en mode test sont ignorés. Les commissions ne sont pas retranchées.
- **Date** : la date réelle du règlement détermine la période ; les horodatages Stripe utilisent le jour civil en Europe/Paris. Un règlement sans date est visible à vérifier dans chaque période, sans entrer automatiquement dans le total. Les versements automatiques estimés de plateforme restent à vérifier jusqu’à la saisie du versement réel.
- **Ventilation** : chaque règlement est réparti au centime entre les montants restant dus par logement et catégorie, selon la méthode des plus grands restes. Les versements de plateforme sont affectés à l’hébergement en priorité ; les règlements locaux d’un séjour de plateforme aux prestations et à la taxe en priorité. L’explication figure dans le détail de l’opération. Il s’agit d’une convention de ventilation des encaissements, pas d’une reconstitution de paiements indépendants de chaque prestation.
- **Prestations anciennes** : les devis sauvegardés et cohérents avec les montants/options de la réservation sont utilisés. À défaut, une unique catégorie active reçoit le montant historique. Une ventilation ambiguë reste agrégée : le total des prestations est utilisable, une sélection partielle de catégories est à vérifier. Le formulaire « Ventiler les prestations » enregistre une répartition manuelle dont la somme doit égaler exactement le montant de la réservation. Cette répartition devient caduque si les options ou le montant changent. Les tarifs actuels du logement ne servent jamais à reconstruire une prestation ancienne.
- **Date d’arrivée** : pour les rapports internes, les montants prévus du séjour sont affectés à son mois d’arrivée, indépendamment des règlements.
- **Nuitées** : nombre de personnes hébergées, enfants compris, multiplié par les nuits effectivement comprises dans chaque mois. Une réservation à cheval sur deux mois est répartie entre les mois. Ce rapport ne calcule pas le montant d’une taxe et ne présume pas des exonérations d’une collectivité.
- **Taxe de séjour** : la part collectée par l’hébergeur, d’après le barème sauvegardé du séjour, est isolée des recettes du rapport social. Les incohérences de barème ou de total du registre/contrat restent à vérifier.
- **Exploitant** : l’établissement facturant du logement détermine l’entreprise. Le propriétaire historique est repris pour le classement, avec un rattachement à confirmer. Chaque rapport social porte sur une seule entreprise. Un changement de rattachement demande de revoir son périmètre.
- **TVA** : le rapport social exige un régime renseigné. Les encaissements d’une entreprise soumise à la TVA restent à rapprocher des factures tant que le registre ne fournit pas leur ventilation HT/TVA. Aucun taux actuel n’est appliqué rétrospectivement.
- **Remboursements Stripe** : le registre connaît le montant cumulé remboursé mais pas les dates de chaque remboursement. Les paiements concernés et un remboursement non daté restent à vérifier, y compris en cas de remboursement intégral. Aucun remboursement n’est imputé arbitrairement au mois du paiement d’origine.

Le modèle social prépare une base d’encaissements, sans calcul des taux de cotisation ni envoi à un organisme. Le périmètre par logements et catégories reste à adapter à la démarche de l’entreprise. Le montant HT encaissé, sans déduction de charges, est le principe présenté par l’[Urssaf](https://www.urssaf.fr/files/live/sites/urssaffr/files/LP/mespremiersmois/index.html) et [Service Public](https://entreprendre.service-public.gouv.fr/vosdroits/F23257).

Les corrections ponctuelles motivées concernent les rapports internes. Les rapports sociaux et de nuitées se corrigent dans les données sources. La ventilation par moyen de paiement reste consultable, sans filtre d’exclusion.

## Historique et conservation

Les anciennes déclarations sociales et de nuitées apparaissent dans un historique distinct avec leurs montants d’origine. Les anciennes règles et lignes justificatives ne sont pas reconstruites. L’indicateur historique `frais_optionnels_declares` n’entre pas dans les nouveaux calculs ; les statistiques historiques existantes restent disponibles sous « Ancien calcul fiscal ». Les anciens boutons de confirmation dans Réservations sont remplacés par des accès aux rapports de la période. Les options et les exports de réservations affichent un seul montant, sans commutateur déclaré/non déclaré.

La préparation est invalidée si les règles ou les sources changent. La confirmation conserve une copie des règles et opérations de la période. Une seule confirmation par rapport et période est autorisée ; elle ne peut pas être écrasée. Une modification ultérieure montre l’écart avec le calcul courant. Une période sans recette peut être confirmée à zéro.

Les brouillons sont conservés dans l’onglet, séparément par utilisateur et organisation. Une panne d’enregistrement conserve le brouillon et affiche une erreur. Les règles appliquées et confirmations sont sur le serveur. Les anciennes données fictives du prototype ne sont jamais importées. Un échec API ne fait jamais apparaître d’exemples à la place des données réelles.

## Migration et validation

La migration `20261029120000_finance_reports` ajoute la table de rapports et la ventilation facultative des prestations. Elle ne réécrit ni les anciens paiements ni les déclarations. Les schémas et migrations SQLite/PostgreSQL sont fournis. En production, sauvegarde récupérable et déploiement complet sont nécessaires conformément à `AGENTS.md`.

```sh
npm run migrate
npm run test
npm run test:reports-browser -w client
npm run build
```

Les tests serveur utilisent une base SQLite temporaire migrée et vérifient les encaissements, les arrondis, les séjours groupés, les frontières de période, les annulations, la TVA, la taxe de séjour, les remboursements, les ventilations, les conflits et l’isolation des organisations. Le parcours navigateur utilise une API de test isolée ; il vérifie les commandes envoyées, erreurs, brouillons, copies figées, liens sources, CSV, droits et présentations sur ordinateur/mobile. Les captures sont enregistrées dans un dossier temporaire configurable avec `REPORTS_SCREENSHOT_DIR`.

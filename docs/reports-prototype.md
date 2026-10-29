# Rapports et déclarations : prototype interactif

Premier lot de la refonte du suivi financier. Accessible dans **Rapports · Aperçu**,
à l’adresse `/rapports`, avec les droits de consultation des statistiques, l’accès
aux montants et le module Finances activé. Les actions d’édition nécessitent aussi
le droit d’écriture des statistiques.

## Périmètre de ce lot

- Accueil avec période, recherche, favoris et éléments à examiner.
- Détail des opérations incluses, à vérifier et hors périmètre, avec explications.
- Corrections ponctuelles motivées et annulation de la dernière correction.
- Création depuis quatre modèles et édition avec aperçu immédiat.
- Brouillons distincts des règles appliquées.
- Préparation, confirmation simulée et copie figée consultable dans l’historique.
- Export CSV des opérations du calcul courant ou d’une copie confirmée.
- Parcours adaptés aux petits écrans et aux thèmes de l’application.
- Alertes avec accès direct à un formulaire de rattachement du gîte ou de saisie
  de l’encaissement. Les corrections de ces données recalculent les rapports
  concernés, sans modifier les copies confirmées.
- Ventilation des recettes d’hébergement par virement, chèque, espèces ou carte,
  sans filtre d’exclusion par mode de paiement. Les anciens réglages de filtre
  sont supprimés des rapports et brouillons à la reprise des essais. Les copies
  confirmées conservent leurs montants et leurs opérations historiques.
- En-têtes communs compacts : retour visible, titre et statut sur une même ligne,
  période et destinataire regroupés. Le bouton « Réglages » conserve son libellé
  même lorsqu’un brouillon existe ; celui-ci est indiqué dans l’éditeur.
- Explication du choix de date : un paiement reçu le 25 octobre pour une arrivée
  le 2 novembre apparaît en octobre avec la date du paiement, et en novembre
  avec la date d’arrivée.

Toutes les données sont fictives. Aucun appel financier ni envoi à un organisme
n’est réalisé. Les règles des exemples n’ont pas de valeur réglementaire. Le suivi
des nuitées utilise le début du séjour et ne calcule pas le montant d’une taxe.

Les essais sont conservés dans le `sessionStorage` de l’onglet, pas dans la base.
Une fermeture de l’onglet peut les perdre. Si le stockage est indisponible, un
message le précise et le parcours reste utilisable en mémoire. La réinitialisation
ne concerne que ces exemples. Les fonctions financières existantes sont inchangées.
Les formulaires ouverts depuis les alertes ne modifient que ces exemples. Les
essais de la première version sont repris automatiquement, y compris les
brouillons et les montants des copies confirmées.

## Vérification

```sh
npm run test -w client
npm run test:reports-browser -w client
npm run build
```

Le parcours navigateur lance son propre serveur Vite et intercepte tous les appels
API avec des réponses fictives. Il ne dépend ni d’un compte utilisateur ni d’une
base de données. Il utilise le Chromium de Playwright déjà requis par le serveur.
Les captures sont écrites dans un dossier temporaire, configurable avec
`REPORTS_SCREENSHOT_DIR`.

## Lots suivants

Après revue des parcours : modèle serveur par organisation, moteur de calcul commun
adossé aux encaissements, versionnement complet des règles et des confirmations,
puis reprise historique avec rapprochement des résultats. Le modèle de ce prototype
est volontairement local et ne constitue pas une migration des données actuelles.

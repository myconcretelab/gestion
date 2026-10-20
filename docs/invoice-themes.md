# Thèmes de facture

Le modèle se choisit dans l’aperçu du formulaire. Il est enregistré par document dans `clauses.invoice_theme` et suit le brouillon, le PDF émis et l’avoir. Les factures sans réglage conservent Héritage. Les PDF déjà archivés restent inchangés.

## Ajouter un thème

1. Ajouter une entrée dans `packages/shared/src/invoiceThemes.ts` avec un identifiant stable, un nom, une description, les quatre couleurs de miniature et le chemin de sa feuille de style.
2. Créer cette feuille dans `server/templates/invoices/themes/`. Horizon et Signature donnent des exemples de typographie, de tableaux et de présentation des totaux. Le sélecteur, la validation et le chargement des styles utilisent directement le catalogue.
3. Vérifier le rendu avec une facture simple, plusieurs séjours, un nom long, un acompte, des conditions B2B et un avoir. Pour les documents longs, vérifier chaque page du PDF, les en-têtes répétés et les totaux.

Le HTML sémantique commun reste dans `server/templates/invoice.html`. Les thèmes modifient uniquement sa présentation : aucun calcul, aucune mention, aucune donnée fiscale ne doit être recréé dans une feuille de style. Ne pas masquer des champs métier ou des lignes pour faire tenir un document.

## Conventions

- Les tailles `--invoice-brand-size`, `--invoice-number-size` et `--invoice-date-size` pilotent les titres et leur réduction progressive : un thème conserve ses proportions pendant la compaction.
- Les couleurs d’impression utilisent les variables `--paper`, `--paper-strong`, `--ink`, `--ink-soft`, `--sage-deep`, `--coral`, `--line` et `--line-strong`. Les noms historiques restent compatibles avec Héritage.
- Les ressources sont locales : aucune police ni image distante n’est requise pour générer le PDF.
- Les classes `compact-*` réduisent progressivement l’espacement des factures courtes. Si cela ne suffit pas, `invoice-multipage` conserve une taille de texte confortable et active la pagination commune.
- Les groupes `.invoice-stay-group`, les lignes, les totaux et le bloc bancaire gardent leurs règles de coupure de page. Le tableau répète ses en-têtes sur chaque page.
- Le thème ne modifie ni le total, ni la ventilation fiscale, ni les vérifications déjà cochées. Changer de thème constitue toutefois une modification du brouillon à enregistrer.
- Les identifiants entrants sont validés par le catalogue. Un identifiant historique inconnu se replie sur Héritage à la lecture ; il ne devient jamais un chemin de fichier.

## Vérification

`npm test` vérifie les réglages, leur sauvegarde et l’archive, la présence du même contenu dans chaque thème et la génération de PDF sur plusieurs pages. `npm run build` vérifie également le sélecteur React et les types partagés.

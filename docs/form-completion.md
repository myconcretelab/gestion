# Assistance de validation des formulaires

`client/src/pages/shared/FormCompletionAssistant.tsx` affiche le cadre flottant
commun aux factures et aux fiches gîtes. Il reçoit les éléments manquants
(`label`, `target`), une progression entre 0 et 100, les textes de contexte et
éventuellement un gestionnaire `onNavigate(target)`.

Les règles métier restent dans `invoiceFormCompletion.ts` et
`giteFormCompletion.ts`. Le composant n’impose aucune règle d’enregistrement.
`formCompletionProgress` pondère les rubriques à parts égales : ajouter plusieurs
champs manquants dans une même rubrique ne fausse pas la progression.

Pour une autre page :

1. Produire la liste des informations manquantes depuis l’état du formulaire.
2. Affecter un identifiant stable à chaque champ ciblé.
3. Fournir la progression et les textes adaptés à la page.
4. Pour les rubriques masquées, les ouvrir avec `onNavigate`, puis appeler
   `focusFormField` après le rendu. Ce helper ouvre aussi les éléments `details`
   et les éditeurs contrôlés par un bouton `aria-controls`, fait défiler la page
   et met le champ en évidence.

Les fiches gîtes suivent l’identité, les capacités, le rattachement de
facturation et son SIRET, les coordonnées de contact, la banque, la taxe de
séjour, les services, horaires, tarifs et caractéristiques. La publication web
activée ajoute le titre, slug, textes de présentation, surface, capacité,
couchages et au moins une photo. Les intégrations, compléments d’adresse, BIC,
traductions et SEO restent facultatifs ; les montants à zéro et les options
désactivées sont acceptés.

Le champ historique de taxe de séjour reste dans les données pour les anciens
séjours. Il ne s’affiche plus dans le formulaire et sert encore à initialiser
le tarif fixe lors d’une configuration explicite.

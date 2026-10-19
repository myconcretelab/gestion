# Établissements et gîtes : parcours de configuration

Le volet **Établissements** de `/parametres/entreprises` regroupe désormais le
choix des gîtes existants, le SIRET et les coordonnées de l’établissement.
Le volet **Récapitulatif** permet de vérifier les rattachements enregistrés.
SuperPDP reste une étape de test distincte et facultative ; ces changements
n’activent aucun échange ni aucune connexion.

## Utilisation

1. Enregistrer l’identité réelle de l’entreprise.
2. Choisir un établissement existant ou « Nouvel établissement ».
3. Cocher les gîtes facturés par cet établissement. Plusieurs gîtes peuvent
   partager un établissement : ne pas créer automatiquement un SIRET par gîte.
4. Lors de la première sélection pour un nouvel établissement, le nom et les
   lignes d’adresse disponibles du gîte préremplissent les champs vides.
   Le bouton de préremplissage permet aussi de choisir une autre fiche source.
   Il ne remplace aucune saisie. Les adresses historiques des gîtes étant du
   texte libre, le code postal et la ville ne sont pas devinés. Vérifier les
   coordonnées officielles et renseigner le véritable SIRET.
5. Enregistrer ensemble l’établissement et les rattachements. Le récapitulatif
   s’ouvre ensuite ; aucune facture n’est transmise.

La fiche gîte affiche le SIRET de son établissement facturant en lecture seule.
Le lien ouvre les paramètres de cet établissement dans un nouvel onglet ; le
SIRET n’est pas stocké une seconde fois dans `Gite`. Enregistrer les saisies de
la fiche gîte avant d’ouvrir les paramètres et recharger la fiche après un
changement de rattachement.

## Garanties

- Pas de migration ni de nouvelle colonne : réutilisation de `FiscalEstablishment`
  et `Gite.fiscal_establishment_id`.
- Les écritures existantes sans `gite_links` restent compatibles.
- Les changements explicites de sélection sont les seuls appliqués. Décocher
  un gîte lié à cet établissement le détache sans supprimer le gîte ; les autres
  gîtes non cochés ne sont pas touchés.
- Un rattachement existant à un autre établissement exige une confirmation.
- Création/modification et changements de rattachement sont transactionnels.
  Un gîte inaccessible ou une sélection périmée annule toute l’opération.
- Isolation par organisation, contrôle SIREN/SIRET et protection des SIRET liés
  à des factures conservés. Aucune modification des factures historiques.
- Les changements de gîtes exigent `gites:write` en plus de `settings:write`.
- La version de l’établissement et les anciens rattachements sont comparés
  avant écriture pour refuser les sauvegardes concurrentes périmées. La fiche
  gîte transmet aussi son ancien rattachement lors de son enregistrement.

## Vérifications

Tests serveur : création/rattachement multiples, détachement ciblé, confirmation
de transfert entre entreprises, doublons, sélection périmée, isolation,
annulation transactionnelle et ancienne fiche gîte périmée.

Tests client : différences de sélection, préremplissage non destructif, absence
d’identifiants inventés, états des cases, droits et SIRET dérivé en lecture seule.

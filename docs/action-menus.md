# Menus d’actions partagés

`client/src/pages/shared/ActionMenu.tsx` est le menu commun aux listes de réservations, contrats et factures. Il remplace les anciennes palettes d’icônes ouvertes au survol. Les liens principaux « Détails » restent accessibles directement.

Le bouton affiche uniquement l’icône de liste, avec un nom accessible et une infobulle fournis par `ariaLabel`. Il mesure 36 px (42 px sur mobile). Les groupes `table-actions--menu` reviennent à la ligne si la cellule est trop étroite pour « Détails » et l’icône.

## Ajouter une action

Passer un tableau d’`ActionMenuItem` : un `id` stable, un `label` explicite, une `icon` issue d’`ActionIcon`, puis **un seul** comportement : `onSelect`, `to` pour une route React ou `href` pour un lien. Les liens externes utilisent `external: true`.

Les pages conservent leurs conditions d’autorisation, confirmations et états de chargement. Une action indisponible reçoit `disabled` et une `description` expliquant pourquoi. Les actions destructrices utilisent `danger: true` et `separatorBefore: true`. La suppression ne se déclenche jamais à l’ouverture du menu.

Le composant se charge de l’ouverture au clic, d’un seul menu ouvert à la fois, du clic extérieur, d’Échap, des flèches, de Début/Fin, de la recherche au clavier et du retour du focus. Tab ferme le menu et poursuit la navigation. L’action choisie ferme le menu avant d’ouvrir un dialogue, de modifier une ligne ou de naviguer.

Le panneau est affiché dans un portail pour sortir des conteneurs de tableau qui défilent. Il se repositionne au défilement/redimensionnement et s’ouvre vers le haut si nécessaire. Sa hauteur reste limitée à l’écran ; ses actions restent accessibles par défilement. Les styles partagés sont importés depuis `client/src/styles.css` et utilisent les couleurs primaires de l’application pour la sélection et le focus.

Pour une nouvelle icône, compléter le petit catalogue SVG `ActionIcon.tsx`. Ne pas réintroduire d’emoji, de lettre isolée ou de palette au survol pour représenter les actions.

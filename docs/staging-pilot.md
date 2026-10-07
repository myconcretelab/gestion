# Environnements et pilote de staging

## Séparation obligatoire

| Environnement | Base et stockage | Secrets | Paiement | Données admises |
| --- | --- | --- | --- | --- |
| Développement local | SQLite et répertoire `data/` locaux, jetables | `.env` local | aucun ou doubles de test | uniquement données fictives |
| Staging pilote | base et stockage dédiés, sauvegardés, sans montage partagé avec la production | coffre ou fichier d’environnement propre au staging | Stripe **test** uniquement | copie historique contrôlée + organisation pilote fictive |
| Production | PostgreSQL et stockage de production | secrets de production séparés | Stripe live uniquement après autorisation | données réelles |

Une même base, un même répertoire de documents, une clé Stripe, un secret de webhook ou un Customer Stripe ne doivent jamais être partagés entre ces environnements. `APP_PUBLIC_URL`, `CLIENT_ORIGIN`, `DATABASE_URL` et `DATA_DIR` doivent identifier sans ambiguïté l’environnement courant.

## Organisation pilote fictive

La commande est idempotente et n’active que les modules cœur (réservations, contrats et factures). Les intégrations iCal, Pump, Smart Life, WordPress, SMS, Telegram et e-mail quotidien restent désactivées.

```bash
npm run staging:pilot -w server -- provision --apply --confirm=org_pilot_fictif
```

Elle crée `org_pilot_fictif`, un propriétaire `pilote.proprietaire@example.invalid`, un hébergement non publié et deux réservations datées de 2030. Le mot de passe aléatoire est conservé avec des permissions `0600` dans `data/pilot-staging-credentials.json`, fichier ignoré par Git. La commande ne crée aucun administrateur de plateforme et ne contacte pas Stripe.

## Inventaire des identités techniques

```bash
npm run staging:pilot -w server -- inventory
```

Le rapport est limité aux organisations non historiques et aux identités reconnaissables comme techniques (`test`, `pilot`, domaine `.invalid`). Il n’affiche ni mot de passe, ni hash, ni secret, ni identité historique.

## Contrôle visuel reproductible

Après un build, lancer une instance de staging isolée puis contrôler les parcours d’accueil et d’abonnement des deux organisations :

```bash
STAGING_BASE_URL=http://localhost:4001 npm run staging:visual-check -w server
```

La commande se connecte au pilote avec le fichier local protégé, crée une session historique temporaire, vérifie les deux forfaits attendus et produit quatre captures dans `/tmp`. Les sessions qu’elle crée sont supprimées à la fin, y compris en cas d’échec du contrôle. Elle ne contacte ni Stripe ni une intégration externe.

## Nettoyage contrôlé

Commencer par une prévisualisation :

```bash
npm run staging:pilot -w server -- cleanup-preview
```

Le nettoyage n’est jamais automatique. Il exige une sauvegarde validée, son chemin absolu et la confirmation exacte de l’organisation :

```bash
npm run staging:pilot -w server -- cleanup --apply --confirm=org_pilot_fictif --backup=/chemin/absolu/sauvegarde-validee.tar.gz
```

Cette opération supprime exclusivement l’organisation pilote et son utilisateur global dédié via les contraintes relationnelles. Ne jamais l’utiliser si l’inventaire montre qu’un utilisateur ou une donnée réelle a été rattaché au pilote.

## Sauvegarde et preuve de restauration

Avant une migration significative :

1. exécuter `npm run multitenant:parity -w server` et conserver le rapport hors du dépôt ;
2. créer l’archive avec `npm run backup -- /chemin/sauvegarde.tar.gz` ;
3. valider le manifeste avec `npm run restore:preview -- /chemin/sauvegarde.tar.gz` ;
4. restaurer dans une base et un stockage temporaires dédiés en redéfinissant `DATABASE_URL` et `DATA_DIR` ;
5. relancer la parité sur cette copie et comparer comptes, documents, totaux et empreintes ;
6. seulement ensuite appliquer la migration au staging, puis comparer le rapport après migration.

La restauration de test ne doit jamais pointer vers la base ou le stockage actifs.

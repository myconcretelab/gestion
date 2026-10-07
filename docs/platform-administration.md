# Administration de plateforme

Les propriétaires d’organisation ne deviennent jamais administrateurs de plateforme automatiquement. La commande cible exclusivement l’identifiant technique d’un utilisateur global existant ; une adresse e-mail seule n’est pas acceptée.

Lister les administrateurs actifs :

```bash
npm run platform-admin -w server -- list
```

Accorder le rôle, après validation explicite :

```bash
npm run platform-admin -w server -- grant --apply --user=ID_UTILISATEUR --actor=IDENTIFIANT_OPERATEUR --reason="Validation du pilote staging"
```

Retirer le rôle :

```bash
npm run platform-admin -w server -- revoke --apply --user=ID_UTILISATEUR --actor=IDENTIFIANT_OPERATEUR --reason="Fin du besoin d’administration"
```

Les commandes sont idempotentes. Chaque changement effectif produit une entrée dans `platform_administrator_events`. Les motifs ne doivent contenir aucun secret. Le staging ne doit recevoir son premier administrateur qu’après validation de l’utilisateur ; la production suit une validation séparée.

# Configuration Stripe du pilote (mode test uniquement)

Le code refuse une clé `sk_live_` et toute valeur de `STRIPE_MODE` différente de `test`. Aucune commande du dépôt ne crée de produit, prix, webhook, Customer ou abonnement Stripe automatiquement.

## Éléments à créer après validation explicite

Dans l’environnement Stripe de test « Gestion App » :

1. créer un produit de test nommé provisoirement **Gestion App – Pilote** ;
2. créer un prix récurrent mensuel en EUR, montant à valider ;
3. créer un prix récurrent annuel en EUR, montant à valider ;
4. activer/configurer le portail client de test (moyen de paiement, factures et résiliation selon la politique retenue) ;
5. créer un endpoint webhook de test vers `APP_PUBLIC_URL/api/billing/webhook/stripe` avec les événements :
   - `checkout.session.completed` ;
   - `customer.subscription.created` ;
   - `customer.subscription.updated` ;
   - `customer.subscription.deleted` ;
   - `invoice.paid` ;
   - `invoice.payment_failed`.

Ne renseigner aucune valeur dans le dépôt. Les variables du staging sont :

```text
STRIPE_MODE=test
STRIPE_SECRET_KEY=sk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…
APP_PUBLIC_URL=https://staging.example.com
STRIPE_PILOT_PRODUCT_ID=prod_…
STRIPE_PILOT_MONTHLY_PRICE_ID=price_…
STRIPE_PILOT_ANNUAL_PRICE_ID=price_…
STRIPE_GRACE_PERIOD_DAYS=7
```

Le produit et les prix sont associés localement au forfait `pilot_provisional` dans `billing_prices`. Les montants ne sont jamais inscrits en dur dans le code. Le Customer Stripe est créé au premier Checkout et rattaché côté serveur à l’organisation. Le navigateur ne fournit jamais l’identifiant de l’organisation au webhook, au portail ou au Checkout.

## Contrôles avant activation

- confirmer dans Stripe que le mode **Test** est visible ;
- vérifier que la clé commence par `sk_test_` sans l’afficher dans un journal ;
- vérifier HTTPS et l’URL publique exacte du staging ;
- déclencher un événement signé avec Stripe CLI ou le tableau de bord de test ;
- vérifier signature invalide = HTTP 400, signature valide = HTTP 200 ;
- rejouer le même événement et vérifier `duplicate: true` ;
- contrôler que le Customer et l’abonnement sont associés à `org_pilot_fictif`, jamais à l’organisation historique ;
- vérifier le portail puis un paiement échoué, la grâce, la suspension et la récupération ;
- ne copier aucun identifiant de test vers la production.

## Resynchronisation

Le back-office met `billing.reconcile` en file. Le worker prend le job avec un lease, appelle Stripe test, rejoue l’état courant de façon idempotente et conserve chaque tentative, son résultat ou son erreur. Un échec d’organisation n’interrompt pas les autres.

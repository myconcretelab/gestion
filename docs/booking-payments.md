# Réservations : paiement Stripe en environnement de test

Le client choisit, après ses coordonnées et options :

- **Paiement sur place** : demande en attente, approbation manuelle et blocage habituel de 24 h.
- **Arrhes par carte** : montant `arrhes_theoriques` du devis existant (taux du gîte sur l’hébergement). Les options restent comprises dans le total du séjour et le solde restant.
- **Totalité par carte** : montant `total_global`, options et taxe collectée comprises.

Le serveur recalcule le devis. Aucune somme envoyée par le navigateur ne fixe le prix encaissé. Les coordonnées bancaires sont saisies chez Stripe Checkout ; elles ne transitent pas par WordPress ou Gestion.

## Configuration séparée

Les variables `BOOKING_STRIPE_*` concernent exclusivement l’encaissement des séjours. Ne pas réutiliser les variables `STRIPE_*` de facturation des abonnements de Gestion.

Dans un fichier privé non versionné, droits `600` :

```dotenv
BOOKING_STRIPE_SECRET_KEY=sk_test_...
BOOKING_STRIPE_WEBHOOK_SECRET=whsec_...
BOOKING_STRIPE_ORGANIZATION_ID=identifiant_organisme
BOOKING_STRIPE_ACCOUNT_ID=acct_...
BOOKING_STRIPE_RETURN_URL=https://votre-site/confirmation-reservation/
```

La page de retour doit charger le widget Booked. L’URL est imposée par la configuration du serveur, sans paramètres ni fragment. `http` est accepté uniquement en développement pour localhost ou un domaine `.local`. Seules les clés **de test** sont autorisées dans cette première version. Le fournisseur vérifie aussi que la clé appartient au compte configuré et que l’organisme courant est autorisé.

En développement local, le rapprochement périodique et la page de retour peuvent vérifier les sessions par l’API Stripe sans exposer Local à Internet. Le lanceur local des gîtes charge sa configuration privée hors des dépôts ; seuls les appels HTTPS vers `api.stripe.com:443` sont ajoutés à son isolation réseau. Les courriels restent capturés par Mailpit.

Sur un serveur en mode production, le paiement en ligne reste masqué sans secret de webhook. Configurer une destination Stripe vers :

```
POST https://votre-gestion/api/booked/webhook/stripe
```

Événements : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`. La signature est contrôlée sur le corps brut avant tout traitement. Ce raccordement n’active pas les encaissements réels.

## Confirmation et suivi

Checkout expire après environ 31 minutes ; les dates sont bloquées environ 34 minutes. Un retour « succès » du navigateur ne suffit jamais à confirmer : le serveur attend une session réellement payée et contrôle sa référence, son organisme, le mode test, le montant et la devise.

Un verrou de base de données protège les allocations concurrentes du parcours Booked. La confirmation et la création de réservation se font dans la même transaction. Les notifications sont reprises en cas d’échec d’envoi ; elles peuvent exceptionnellement être répétées si le processus s’interrompt après l’envoi et avant son enregistrement.

Une demande liée à un paiement est protégée contre les actions manuelles de modification, approbation, rejet ou réouverture. Les notes internes restent éditables. Une somme reçue après réattribution des dates ou avec un montant inattendu reste enregistrée avec un signalement **à vérifier** ; elle ne crée pas de seconde réservation. Les remboursements signalés par Stripe sont suivis sans annuler automatiquement le séjour. La gestion manuelle d’un remboursement se fait depuis Stripe.

Le détail d’une demande affiche les montants encaissés et le solde. Le contrat créé depuis cette réservation reprend les arrhes reçues et marque le solde réglé si le séjour est payé en entier. Un changement de dates ou de total du contrat est bloqué pour demander une vérification du paiement.

Les emails de confirmation au client et au propriétaire contiennent le détail des options, le paiement reçu, le solde et la référence. Aucun email d’attente d’approbation n’est envoyé pour le parcours carte.

## Vérifications

- `npm run test` et `npm run build` dans Gestion.
- Dans Booked, importer et exécuter `runBookingFlowChecks`, `runBookingI18nChecks` et `runBookingPaymentChecks` avec Chromium Playwright.
- Essais du vrai bac à sable : totalité, refus de carte, arrhes et annulation ; vérifier le reçu et Mailpit, ainsi que l’absence de double réservation.
- Les migrations SQLite et PostgreSQL ajoutent uniquement le registre `booking_payments`. Appliquer les migrations à la base locale après sauvegarde. Un futur déploiement serveur nécessitera une sauvegarde récupérable et le déploiement complet ; un simple déploiement léger ne suffit pas.

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

Le détail d’une demande et la fiche de réservation affichent les montants encaissés, la date du paiement et le solde. La fiche tient aussi compte d’un solde ensuite marqué réglé sur le contrat. Le contrat créé depuis cette réservation reprend les arrhes reçues et marque le solde réglé si le séjour est payé en entier. Un changement de dates ou de total du contrat est bloqué pour demander une vérification du paiement.

Les emails de confirmation au client et au propriétaire contiennent le détail des options, le paiement reçu, le solde et la référence. Aucun email d’attente d’approbation n’est envoyé pour le parcours carte.

## Textes et présentation des emails

Dans **Paramètres → Emails**, les messages de réservation reprennent les textes enregistrés et leurs variables. Le même modèle **Confirmation de réservation** sert après une approbation manuelle et après un paiement Stripe. `{{stayPaymentInstruction}}` adapte la consigne au paiement reçu ; `{{paymentSummary}}` affiche les arrhes ou le paiement reçu et le solde. Une ancienne confirmation qui omet ce dernier bloc reçoit automatiquement les informations de règlement. `{{optionsSummary}}` détaille tarifs, quantités, nuits et montants des options sélectionnées.

Les accusés de réception, notifications propriétaire, refus, reçus de liens de paiement et messages de vérification ou de remboursement ont aussi leurs textes personnalisables. Ils partagent avec les contrats et factures une présentation HTML adaptée au mobile : identité de l’organisation, logo, photo principale publique du gîte et coordonnées. Une version texte reste fournie. Les images et informations absentes sont simplement omises ; les textes personnalisés restent conservés. Un logo peut être configuré dans l’identité de l’organisation, avec une URL HTTPS ou un chemin local servi par Gestion.

En local, consulter les messages dans Mailpit (`http://127.0.0.1:10000`). Les réservations de démonstration doivent utiliser des noms **TEST** et des adresses fictives. Les tests automatisés des modèles emploient un dossier temporaire pour ne pas modifier les textes enregistrés sur l’installation locale.

## Liens courts depuis une réservation

Dans le menu d’actions d’une ligne de réservation : **Lien de paiement Stripe**. Le panneau propose les arrhes encore dues ou le montant restant du séjour, puis un lien à copier dans un SMS. Un contrat existant fixe les montants ; sinon le calcul utilise les montants de la réservation, ses frais et sa taxe enregistrée. Les règlements Stripe et les paiements reçus renseignés sur le contrat sont déduits. Pour une réservation de plateforme, vérifier les sommes déjà encaissées avant de demander un paiement.

Le lien privé est de la forme `APP_PUBLIC_URL/p/<code aléatoire de 22 caractères>`, valable sept jours. Il ne contient aucune coordonnée du client et sa page n’est pas indexable. Un aperçu SMS en GET ne crée pas de session Stripe : le client doit appuyer sur le bouton de paiement. La session carte expire après environ 31 minutes ; le même lien reste réutilisable tant qu’il est actif. Aucun lien déjà payé ne permet un second paiement.

Chaque reçu est rattaché à la réservation existante, sans nouvelle demande ni réservation. Le contrat et le récapitulatif des paiements cumulent les arrhes et le solde, y compris si les arrhes proviennent initialement de Booked. Un lien peut être annulé ; toute session ouverte doit d’abord être clôturée chez Stripe. Les dates, montants et règlements sont revérifiés au lancement et à la réception du paiement. Un changement concurrent ou un remboursement impose une vérification manuelle plutôt qu’un nouveau prélèvement.

`APP_PUBLIC_URL` doit désigner l’adresse publique HTTPS de Gestion. En local, les liens `http://localhost:4001/p/…` fonctionnent uniquement sur cet ordinateur. Cette version reste limitée au bac à sable Stripe ; les liens et emails de test ne doivent pas être envoyés aux clients comme moyens d’encaissement réels.

## Présentation des fiches WordPress locales

Le partage du code par liens symboliques ne synchronise pas la base WordPress. Pour retrouver la présentation des fiches de production, attribuer aux pages locales le modèle `page-gite` (métadonnée `_wp_page_template`) et le gîte local (`_booked_default_gite_id`). Ce modèle apporte la galerie, le contenu à gauche et le formulaire Booked à droite ; les colonnes s’empilent sur mobile. Éviter de conserver un second calendrier ou une seconde galerie dans le corps de la page. Sauvegarder le contenu et les métadonnées avant de modifier une attribution existante.

La page `test-reservation-options` est une page d’essai du formulaire seul. Les fiches locales de démonstration permettent de tester le parcours complet dans la présentation du site.

## Vérifications

- `npm run test` et `npm run build` dans Gestion.
- Dans Booked, importer et exécuter `runBookingFlowChecks`, `runBookingI18nChecks` et `runBookingPaymentChecks` avec Chromium Playwright.
- Essais du vrai bac à sable : totalité, refus de carte, arrhes et annulation ; vérifier le reçu et Mailpit, ainsi que l’absence de double réservation.
- Les migrations SQLite et PostgreSQL ajoutent le registre `booking_payments` et les liens `reservation_payment_links`, avec rattachement facultatif des paiements à une réservation existante. Appliquer les migrations à la base locale après sauvegarde. Un futur déploiement serveur nécessitera une sauvegarde récupérable et le déploiement complet ; un simple déploiement léger ne suffit pas.

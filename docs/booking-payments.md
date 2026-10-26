# Réservations : paiement Stripe en test ou en réel

Le client choisit, après ses coordonnées et options :

- **Paiement sur place** : demande en attente, approbation manuelle et blocage habituel de 24 h.
- **Arrhes par carte** : montant `arrhes_theoriques` du devis existant (taux du gîte sur l’hébergement). Les options restent comprises dans le total du séjour et le solde restant.
- **Totalité par carte** : montant `total_global`, options et taxe collectée comprises.

Le serveur recalcule le devis. Aucune somme envoyée par le navigateur ne fixe le prix encaissé. Les coordonnées bancaires sont saisies chez Stripe Checkout ; elles ne transitent pas par WordPress ou Gestion.

## Configuration séparée

Les variables `BOOKING_STRIPE_*` concernent exclusivement l’encaissement des séjours. Ne pas réutiliser les variables `STRIPE_*` de facturation des abonnements de Gestion.

Dans un fichier privé non versionné, droits `600` :

```dotenv
BOOKING_STRIPE_MODE=test
BOOKING_STRIPE_SECRET_KEY=sk_test_...
BOOKING_STRIPE_WEBHOOK_SECRET=whsec_...
BOOKING_STRIPE_ORGANIZATION_ID=identifiant_organisme
BOOKING_STRIPE_ACCOUNT_ID=acct_...
BOOKING_STRIPE_RETURN_URL=https://votre-site/confirmation-reservation/
```

La page de retour doit charger le widget Booked. L’URL est imposée par la configuration du serveur, sans paramètres ni fragment. `http` est accepté uniquement en développement pour localhost ou un domaine `.local`. Le mode est choisi explicitement par `BOOKING_STRIPE_MODE` :

| Environnement | Mode | Clé | Conditions |
| --- | --- | --- | --- |
| Local | `test` (valeur par défaut) | `sk_test_…` | HTTP local autorisé ; webhook facultatif pour les essais avec rapprochement API |
| Production en préparation | `test` | `sk_test_…` | Retour HTTPS et webhook de test configuré |
| Production avec encaissements | `live` | `sk_live_…` | `NODE_ENV=production`, retour HTTPS public et webhook réel configuré |

`NODE_ENV=production` ne déclenche jamais à lui seul le mode réel. Un choix inconnu, une clé incompatible ou une configuration incomplète masque le paiement en ligne ; le parcours sur place avec approbation manuelle reste disponible. Le réel est refusé hors production et vers une page de retour locale. Le fournisseur vérifie aussi que la clé appartient au compte configuré et que l’organisme courant est autorisé.

Les configurations, clés, secrets de webhook et bases de données de chaque installation restent séparés. Le réglage `STRIPE_MODE` des abonnements de Gestion n’influence pas les encaissements de séjours. Aucun réglage ni secret ne doit être transmis par le navigateur ou enregistré dans Git.

En développement local, le rapprochement périodique et la page de retour peuvent vérifier les sessions par l’API Stripe sans exposer Local à Internet. Le lanceur local des gîtes charge sa configuration privée hors des dépôts ; seuls les appels HTTPS vers `api.stripe.com:443` sont ajoutés à son isolation réseau. Les courriels restent capturés par Mailpit. Le lanceur local impose aussi `BOOKING_STRIPE_MODE=test`, indépendamment de la configuration de production.

Sur un serveur en mode production, le paiement en ligne reste masqué sans secret de webhook. Configurer une destination Stripe vers :

```
POST https://votre-gestion/api/booked/webhook/stripe
```

Événements : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `charge.refunded`. La signature est contrôlée sur le corps brut avant tout traitement. Créer cette destination dans le même environnement Stripe que la clé configurée, avec les événements au format **snapshot**. Chaque destination possède son propre secret de signature. L’enveloppe de l’événement et la session Checkout doivent correspondre au mode configuré ; les événements de l’autre mode sont refusés.

Pour activer les encaissements après déploiement, renseigner dans la configuration privée du serveur `BOOKING_STRIPE_MODE=live`, la clé réelle du compte des gîtes, son identifiant `acct_…`, le secret du webhook réel, l’organisme et l’URL HTTPS de confirmation, puis redémarrer le service. Le poste local garde ses réglages de test. Vérifier que le compte Stripe est autorisé à encaisser avant l’ouverture aux clients. Références : [clés et environnements Stripe](https://docs.stripe.com/keys), [webhooks Stripe](https://docs.stripe.com/webhooks).

## Confirmation et suivi

Checkout expire après environ 31 minutes ; les dates sont bloquées environ 34 minutes. Un retour « succès » du navigateur ne suffit jamais à confirmer : le serveur attend une session réellement payée et contrôle sa référence, son organisme, le mode configuré, le montant et la devise.

Un verrou de base de données protège les allocations concurrentes du parcours Booked. La confirmation et la création de réservation se font dans la même transaction. Les notifications sont reprises en cas d’échec d’envoi ; elles peuvent exceptionnellement être répétées si le processus s’interrompt après l’envoi et avant son enregistrement.

Une demande liée à un paiement est protégée contre les actions manuelles de modification, approbation, rejet ou réouverture. Les notes internes restent éditables. Une somme reçue après réattribution des dates ou avec un montant inattendu reste enregistrée avec un signalement **à vérifier** ; elle ne crée pas de seconde réservation. Les remboursements signalés par Stripe sont suivis sans annuler automatiquement le séjour. La gestion manuelle d’un remboursement se fait depuis Stripe.

Le détail d’une demande et la fiche de réservation affichent les montants encaissés, la date du paiement et le solde. La fiche tient aussi compte d’un solde ensuite marqué réglé sur le contrat. Le contrat créé depuis cette réservation reprend les arrhes reçues et marque le solde réglé si le séjour est payé en entier. Un changement de dates ou de total du contrat est bloqué pour demander une vérification du paiement.

Les emails de confirmation au client et au propriétaire contiennent le détail des options, le paiement reçu, le solde et la référence. Aucun email d’attente d’approbation n’est envoyé pour le parcours carte.

## Textes et présentation des emails

Dans **Paramètres → Emails**, les messages de réservation reprennent les textes enregistrés et leurs variables. Le même modèle client **Confirmation de réservation** sert après une approbation manuelle et après un paiement Stripe. `{{stayPaymentInstruction}}` adapte la consigne au paiement reçu ; `{{paymentSummary}}` affiche les arrhes ou le paiement reçu et le solde. Une ancienne confirmation qui omet ce dernier bloc reçoit automatiquement les informations de règlement. `{{optionsSummary}}` détaille tarifs, quantités, nuits et montants des options sélectionnées.

Les accusés de réception, notifications propriétaire, refus, reçus de liens de paiement et messages de vérification ou de remboursement ont aussi leurs textes personnalisables. Ils partagent avec les contrats et factures une présentation HTML adaptée au mobile : identité de l’organisation, logo, photo principale publique du gîte et coordonnées. Une version texte reste fournie. Les images et informations absentes sont simplement omises ; les textes personnalisés restent conservés. Un logo peut être configuré dans l’identité de l’organisation, avec une URL HTTPS ou un chemin local servi par Gestion.

Les notifications destinées au propriétaire affichent un bouton **Voir la demande**. Après confirmation par paiement des arrhes ou de la totalité, le bouton **Voir la réservation** ouvre Gestion sur l’année, le mois et le gîte concernés, avec défilement et mise en évidence de la réservation. Le lien est aussi fourni dans la version texte. Ces liens internes utilisent `APP_PUBLIC_URL`, nécessitent la connexion habituelle à Gestion et ne sont ajoutés ni aux messages client ni à la page de confirmation publique.

Les propriétaires ont des modèles dédiés pour les confirmations après paiement, les reçus de paiements sur réservation existante, les paiements à vérifier et les remboursements. Leurs sujets identifient le client et le gîte ; le corps présente les coordonnées du client, les dates, les options et le règlement à la troisième personne. Ils ne reprennent pas les salutations, conseils touristiques ou formules d’accueil adressés au client. Ces modèles restent personnalisables indépendamment des messages clients dans **Paramètres → Emails**.

## Notifications Telegram

Les demandes classiques et approbations manuelles contiennent les coordonnées du client, les dates, le total et le calcul détaillé des options, ainsi qu’un lien vers la demande ou la réservation. Une confirmation par paiement Stripe n’est pas présentée comme une demande en attente : elle indique les arrhes ou le paiement reçu, le solde et le lien vers la réservation, avec sélection du gîte et de la période puis défilement vers sa ligne.

Les paiements par lien sur une réservation existante, paiements à vérifier et remboursements ont aussi leur message propriétaire. Un paiement à vérifier n’annonce aucune confirmation ; un remboursement n’annonce pas l’annulation du séjour. Les options utilisent le même calcul à partir du devis enregistré que les emails.

Dans **Paramètres → Telegram**, l’option **Réservations confirmées et suivi des paiements** couvre les approbations manuelles et les événements Stripe. Elle conserve le réglage existant `notify_booking_request_approved`. Les demandes restent contrôlées par leur option distincte. Les alertes concernant les contrats, factures et contrôles de ménage conservent leur fonctionnement.

Les alertes Stripe sont enregistrées dans la file de tâches existante, séparément par paiement, état et destinataire. Le worker des paiements les traite généralement sous une minute, avec reprises en cas d’échec, sans renvoyer les emails ou notifications déjà remis aux autres destinataires. Une notification devenue obsolète, un destinataire retiré ou un événement désactivé sont ignorés. Le worker de tâches doit être activé (`ORGANIZATION_JOB_WORKER_ENABLED`). Une interruption après remise au fournisseur mais avant enregistrement du succès peut exceptionnellement répéter un message. Les paiements anciens dont la notification email a déjà été traitée ne sont pas rejoués rétroactivement.

En local, consulter les messages dans Mailpit (`http://127.0.0.1:10000`). Les réservations de démonstration doivent utiliser des noms **TEST** et des adresses fictives. Les tests automatisés des modèles emploient un dossier temporaire pour ne pas modifier les textes enregistrés sur l’installation locale.

## Page de retour après paiement

Après vérification du paiement, Booked affiche une fiche de confirmation avec la même identité et la même photo publique que l’email : dates, voyageurs, options du devis enregistré, somme déjà réglée et solde. Le texte personnalisé complet de la confirmation est disponible dans une rubrique dépliable. Le formulaire de réservation est masqué pour éviter une nouvelle demande. Il redevient disponible après une annulation ou une expiration ; un paiement à vérifier ne propose pas de recommencer à payer.

Pour une page de retour dédiée, créer une page WordPress avec le shortcode `[booked_confirmation]` et configurer `BOOKING_STRIPE_RETURN_URL` sur son URL. Aucun formulaire n’est chargé sur cette page. Le retour fonctionne aussi sur une page qui contient déjà un formulaire Booked ; celui-ci est alors masqué après confirmation.

Les détails sont délivrés uniquement pour une réservation confirmée, après contrôle du jeton privé de retour et de l’organisme. La réponse n’est pas mise en cache. Le jeton est retiré de l’URL puis conservé au maximum une heure dans la session de l’onglet, uniquement pour la page de retour, ce qui permet de recharger la confirmation sans perturber les autres fiches de gîte. Le bouton **Retour au site** efface cette session de retour.

## Liens courts depuis une réservation

Dans le menu d’actions d’une ligne de réservation : **Lien de paiement Stripe**. Le panneau propose les arrhes encore dues ou le montant restant du séjour, puis un lien à copier dans un SMS. Un contrat existant fixe les montants ; sinon le calcul utilise les montants de la réservation, ses frais et sa taxe enregistrée. Les règlements Stripe et les paiements reçus renseignés sur le contrat sont déduits. Pour une réservation de plateforme, vérifier les sommes déjà encaissées avant de demander un paiement.

Le lien privé est de la forme `APP_PUBLIC_URL/p/<code aléatoire de 22 caractères>`, valable sept jours. Il ne contient aucune coordonnée du client et sa page n’est pas indexable. Un aperçu SMS en GET ne crée pas de session Stripe : le client doit appuyer sur le bouton de paiement. La session carte expire après environ 31 minutes ; le même lien reste réutilisable tant qu’il est actif. Aucun lien déjà payé ne permet un second paiement.

Chaque reçu est rattaché à la réservation existante, sans nouvelle demande ni réservation. Le contrat et le récapitulatif des paiements cumulent les arrhes et le solde, y compris si les arrhes proviennent initialement de Booked. Un lien peut être annulé ; toute session ouverte doit d’abord être clôturée chez Stripe. Les dates, montants et règlements sont revérifiés au lancement et à la réception du paiement. Un changement concurrent ou un remboursement impose une vérification manuelle plutôt qu’un nouveau prélèvement.

`APP_PUBLIC_URL` doit désigner l’adresse publique HTTPS de Gestion. En local, les liens `http://localhost:4001/p/…` fonctionnent uniquement sur cet ordinateur. La mention « Mode test » est affichée uniquement en test, sur la page du lien, dans le panneau de Gestion et dans le formulaire Booked.

Le mode est enregistré sur chaque paiement et lien. Les anciennes lignes sont conservées comme `test` lors de la migration. Un lien de l’autre mode est inutilisable ; aucun rapprochement, remboursement ou notification de cet autre mode n’est appliqué. Une réservation contenant déjà des règlements de l’autre mode ne peut pas recevoir un nouveau lien de paiement. Ne pas transférer les réservations fictives de la base locale vers la production.

## Présentation des fiches WordPress locales

Le partage du code par liens symboliques ne synchronise pas la base WordPress. Pour retrouver la présentation des fiches de production, attribuer aux pages locales le modèle `page-gite` (métadonnée `_wp_page_template`) et le gîte local (`_booked_default_gite_id`). Ce modèle apporte la galerie, le contenu à gauche et le formulaire Booked à droite ; les colonnes s’empilent sur mobile. Éviter de conserver un second calendrier ou une seconde galerie dans le corps de la page. Sauvegarder le contenu et les métadonnées avant de modifier une attribution existante.

La page `test-reservation-options` est une page d’essai du formulaire seul. Les fiches locales de démonstration permettent de tester le parcours complet dans la présentation du site.

## Vérifications

- `npm run test` et `npm run build` dans Gestion.
- Dans Booked, importer et exécuter `runBookingFlowChecks`, `runBookingI18nChecks` et `runBookingPaymentChecks` avec Chromium Playwright.
- Essais du vrai bac à sable : totalité, refus de carte, arrhes et annulation ; vérifier le reçu et Mailpit, ainsi que l’absence de double réservation.
- La migration `20261024220000_booking_stripe_mode` ajoute le mode aux paiements et aux liens, sans supprimer de données ; les lignes existantes restent de test.
- Les migrations SQLite et PostgreSQL ajoutent le registre `booking_payments` et les liens `reservation_payment_links`, avec rattachement facultatif des paiements à une réservation existante. Appliquer les migrations à la base locale après sauvegarde. Un futur déploiement serveur nécessitera une sauvegarde récupérable et le déploiement complet ; un simple déploiement léger ne suffit pas.

## Origine et règlements de la réservation

La colonne **Origine** et les formulaires de réservation indiquent désormais le canal : Direct, Airbnb, Abritel, Gîtes de France, HomeExchange, Autre ou À préciser. Ce choix est enregistré dans `booking_source`. L'ancien champ `source_paiement` est conservé pour préserver les classements historiques des déclarations et des imports. Modifier l'origine ou ajouter un règlement ne le réécrit pas. Les nouvelles réservations directes utilisent la catégorie distincte Direct ; les anciennes catégories conservent leurs règles. La répartition du chiffre d'affaires par origine utilise le nouveau canal.

La tuile **Total** des fiches Aujourd'hui et Calendrier ouvre le détail des règlements. L'action **Origine et règlements** de la liste ouvre également ce suivi sur ordinateur. Il est utilisable sans contrat et sans gîte attribué. **Ajouter un règlement** enregistre un montant, une date reçue, un moyen (chèque, virement, espèces, carte, versement plateforme ou autre), sa nature et une note facultative. Plusieurs versements peuvent coexister ; le reçu, le restant et l'état payé sont calculés en centimes. Une saisie erronée peut être annulée ; sa trace reste visible. Cela ne déclenche ni encaissement ni remboursement bancaire.

Les arrhes et soldes déjà marqués reçus sur un contrat sont présentés comme historiques, sans inventer les dates manquantes. Un ancien libellé Chèque ou Espèces seul indique un moyen historique, sans créer un montant reçu fictif. Au premier ajout ou à la première annulation, les règlements historiques connus sont matérialisés une seule fois dans `reservation_recorded_payments`, puis le registre devient la référence. Les reçus Stripe restent issus de Stripe et ne sont pas ressaisis dans ce registre. Les anciens segments d'un séjour partagent le même suivi.

Les statuts du contrat suivent alors les règlements ; ses anciens interrupteurs ne peuvent plus les remplacer. Les liens Stripe déduisent les versements manuels actifs, y compris après annulation d'une saisie. Un paiement Stripe en cours bloque une modification concurrente du registre ; les remboursements nécessitent une vérification. Les requêtes d'ajout utilisent un identifiant idempotent pour éviter les doublons après une interruption réseau. L'accès au registre et aux annulations exige les droits de modification des réservations et d'accès aux montants. Une réservation contenant des écritures, même annulées, est conservée.

Le déploiement de cette évolution exige le mode complet et la migration `20261026120000_reservation_payment_ledger`, disponible pour SQLite et PostgreSQL. Elle ajoute les champs et le registre sans modifier les valeurs historiques ni créer de paiements. Une sauvegarde récupérable est requise avant la migration en production.

## Règlements des plateformes

Dans **Paramètres → Hébergements → Règlements**, le réglage **Considérer automatiquement l’argent des plateformes comme reçu** est activé par défaut, séparément pour chaque compte. Il couvre Airbnb, Abritel et Gîtes de France ; HomeExchange est exclu.

Seul l’hébergement, remise déduite, est considéré reçu. Les draps, les options ajoutées dans Gestion et la taxe à collecter sur place restent à encaisser. Par exemple, 1 000 € d’hébergement et 60 € de draps affichent 1 000 € considérés reçus et 60 € restants. Le paiement des options peut être saisi depuis le popover du listing. Les liens Stripe portent uniquement sur les suppléments à encaisser sur place, même si le versement de la plateforme reste attendu.

Le popover identifie le montant considéré reçu automatiquement, sans lui attribuer de date de versement. Désactiver le réglage retire cet automatisme, y compris sur l’historique, et permet de saisir les encaissements réels avec le moyen **Versement plateforme**. Les paiements déjà enregistrés restent conservés et ne sont pas comptés deux fois. Le montant automatique est recalculé, sans créer de paiement dans le registre ; il ne peut pas être annulé comme une saisie manuelle.

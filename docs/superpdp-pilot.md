# SuperPDP — recette et préparation du pilote (étape 8)

## État et limites de cette livraison

Cette étape prépare le pilote ; **elle ne déploie rien, n’utilise pas les accès `.PDP`, ne réalise pas de consentement et ne soumet aucune facture ni déclaration**. Les flux développés aux étapes 4 à 7 sont exclusivement sandbox, désactivés par défaut. Le connecteur de production n’est pas implémenté : un simple changement de variable, de secret ou d’URL ne peut pas le rendre opérationnel. Le domaine API SuperPDP est commun aux deux environnements ; seul le domaine ne permet pas de les distinguer.

Trois autorisations sont distinctes : déployer le code sur une installation de test, effectuer une recette avec le vrai fournisseur en sandbox, puis développer/déployer/activer un connecteur de production sur un périmètre approuvé. Aucune de ces autorisations ne doit être déduite d’un bilan local sans anomalie. La consigne actuelle reste **aucun déploiement**.

Références vérifiées le 16/10/2026 : [OpenAPI officielle](https://www.superpdp.tech/openapi/) et [document source `1.37.0.beta`](https://api.superpdp.tech/openapi/superpdp.json), [authentification](https://www.superpdp.tech/documentation/4/), [synchronisation](https://www.superpdp.tech/documentation/14/), [e-reporting](https://www.superpdp.tech/documentation/15/). Vérifier les évolutions de contrat avant une recette ultérieure. Les choix fiscaux et le périmètre réglementaire doivent être qualifiés avec le conseil de l’entreprise.

## Bilan local dans l’application

Ouvrir **Paramètres → Organisation → Entreprises → entreprise → Dernière étape — préparation de la recette**, puis **Établir le bilan local de préparation**. Seul un propriétaire authentifié du même compte y accède. Le bilan est disponible même lorsque les connecteurs sont désactivés.

L’API `GET /api/fiscal-entities/:entityId/superpdp/readiness` porte `Cache-Control: no-store` et `Referrer-Policy: no-referrer`. Elle lit les données du compte et de l’entité demandés : inventaire fiscal, dernière observation de connexion, réglages serveur, compteurs d’émission/encaissement/réception et anomalies historiques. Elle n’appelle ni OAuth ni SuperPDP, ne lit aucun fichier d’accès, ne déchiffre aucun secret, ne crée aucune tâche et ne modifie aucun document, curseur ou paiement. Elle n’expose ni secrets/jetons, même chiffrés, ni contenu de facture, ni URL de configuration.

Le bilan n’est pas une surveillance automatique ni une photographie transactionnelle de toute la base : les lectures peuvent croiser une opération en cours. Actualiser après une intervention et confronter les observations aux journaux des documents et à SuperPDP.

- **Observation locale** : présence d’une information enregistrée, pas validation externe. Un `connected` observé il y a moins de 24 heures reste une donnée historique ; la validité actuelle du consentement n’est pas vérifiée.
- **À examiner** : configuration incomplète/désactivée, connexion ancienne/incohérente/interrompue, résultat inconnu, suspension après restauration, préparation en échec, état non reconnu, erreur distante historique ou réception à revoir.
- **À vérifier séparément** : absence de preuve locale ou validation humaine nécessaire. Un rapprochement d’achat manquant n’est pas nécessairement une anomalie ; il ne doit pas créer de dépense automatiquement.

Les événements distants ne sont pas une machine à états exclusive. Les rejets historiques restent visibles à examiner même après résolution ; leur compteur n’est pas le nombre de factures actuellement rejetées. Un dépôt confirmé ou un reçu 212 ne prouve pas l’acceptation de la déclaration par l’administration. Une paire de champs chiffrés présente en base ne prouve pas qu’elle soit déchiffrable : le contrôle OAuth réel est distinct.

Les validations humaines ne peuvent pas être cochées pour « débloquer » la production. La réponse reste toujours `production.enabled=false`, `production.status=blocked` ; au mieux le résumé vaut `manual_checks_required`. Aucun accès de production n’est créé et aucun nouveau schéma de base n’est nécessaire pour ce bilan.

## Préparer la recette réelle — sans l’exécuter maintenant

1. Faire choisir une installation de test distincte par le responsable : URL/site Alwaysdata, base, `DATA_DIR`, clé et secrets propres ; aucun stockage partagé avec l’application active. Une copie de production ne suffit pas : ne pas transmettre de données personnelles/réelles aux outils de test. Neutraliser également les emails, SMS, synchronisations et intégrations annexes de la copie.
2. Désigner l’administrateur applicatif, le responsable de recette, le conseil fiscal et le contact support SuperPDP. Définir les entreprises fictives A et B et les opérations autorisées. Ne pas modifier le SIREN d’une entreprise de facturation existante pour la transformer en société fictive.
3. Générer des factures/PDF entièrement fictifs, cohérents entre eux et avec les identités de test SuperPDP. Conserver les documents existants : aucun remplacement automatique d’identité dans leurs PDF ni réémission silencieuse d’historiques.
4. Enregistrer manuellement l’URL exacte de callback dans l’application OAuth. Utiliser les autorisations adaptées à la délégation entreprise par entreprise ; vérifier les capacités effectives de l’application OAuth plutôt que déduire le mode d’autorisation du seul `client_id`.
5. Stocker la configuration backend dans un fichier non versionné de mode `600`. Ne rien placer dans `VITE_*`, les captures, le navigateur, le dépôt ou les journaux. Sur Alwaysdata, ne pas utiliser les valeurs d’environnement du site pour les secrets, susceptibles d’apparaître dans les logs de démarrage. Faire expurger les codes et `state` des URL de callback dans les journaux d’accès.
6. Sur ce seul environnement de test autorisé, préparer les interrupteurs des lots réellement testés. `SUPERPDP_SANDBOX_ENABLED` est requis ; émission, réception et B2C ont leurs interrupteurs séparés. Le worker exige `ORGANIZATION_JOB_WORKER_ENABLED`. Ne jamais activer les lots pour obtenir artificiellement un bilan sans avertissement.
7. Avant toute migration sur une installation active, préparer une sauvegarde récupérable, sa clé/phrase séparée, son manifeste et une preuve de restauration isolée. Suivre [la procédure de staging existante](staging-pilot.md). Aucun reset/seed de production, aucune copie des jetons rotatifs vers un second serveur actif.

Les valeurs réelles ne doivent pas être inscrites dans ce guide. Les accès de `.PDP` restent locaux et ignorés par Git ; leur présence n’est pas une autorisation de les utiliser automatiquement. Un consentement humain et une autorisation explicite de recette réelle sont encore nécessaires.

## Variante locale sur localhost:5173

La recette peut commencer sur `http://localhost:5173/`, sans site Alwaysdata supplémentaire ni déploiement. Vite transmet `/api` au serveur Node local sur le port `4000`. Le callback repasse par ce proxy ; conserver le même navigateur, la même session propriétaire et le même nom d’hôte pendant tout le consentement. `localhost` et `127.0.0.1` ne sont pas interchangeables pour la session et l’URL enregistrée.

Avant d’utiliser les données présentes, vérifier le fichier SQLite réellement ouvert par le processus Node, le `DATA_DIR` résolu et les éventuels liens symboliques. Une URL locale ne garantit pas une base locale. Faire une sauvegarde SQLite cohérente et privée avant les migrations ; appliquer les migrations existantes sur cette seule base, sans reset ni seed, puis vérifier l’intégrité, les clés étrangères et la conservation des données métier. La présence du code dans Git ne signifie pas que ces migrations ont été appliquées à la base utilisée par le serveur de développement.

En développement uniquement, le connecteur accepte ce retour HTTP local, à enregistrer **à l’identique** dans l’application OAuth SuperPDP :

```text
http://localhost:5173/api/fiscal-entities/superpdp/oauth/callback
```

La configuration Node doit employer `APP_PUBLIC_URL=http://localhost:5173`, `CLIENT_ORIGIN=http://localhost:5173` et cette valeur pour `SUPERPDP_SANDBOX_REDIRECT_URI`, avec une clé cryptographique propre à ce serveur dans `SUPERPDP_SECRETS_KEY`. Ne jamais afficher cette clé ni les valeurs de `.PDP`. Protéger les fichiers d’environnement et les sauvegardes avec le mode `600`. Les modifications d’environnement nécessitent un redémarrage maîtrisé du serveur ; ne pas arrêter un processus ni activer des automatisations annexes sans vérifier son rôle.

Commencer avec tous les lots désactivés. Après configuration et autorisation de la recette, activer seulement la connexion sandbox, faire le consentement humain et contrôler l’identité attendue ; l’émission, la réception et le B2C s’activent séparément quand leur scénario est prêt. Leur activation n’est pas un effet implicite de la migration ou de l’ajout de données de démonstration.

Si aucune entreprise fiscale n’est encore enregistrée, sa seule raison sociale permet de créer une fiche locale pour préparer la connexion sandbox : laisser le SIREN et le SIRET vides si aucune identité légale de test n’est fournie. Dans la configuration OAuth de cette fiche, renseigner séparément le champ `number` de l’entreprise SuperPDP comme **numéro sandbox**, sous forme de texte en conservant les zéros initiaux. Ce numéro ne doit pas être recopié dans le SIREN/SIRET ; l’adresse Peppol ne constitue pas davantage une preuve d’identité légale.

Le consentement et le contrôle d’identité sandbox ne nécessitent pas de SIREN local. La connexion conserve l’absence de SIREN comme `NULL` : tout ajout/changement ultérieur reste verrouillé tant qu’elle est configurée et exige une déconnexion, puis une nouvelle configuration après mise à jour de la fiche. Le serveur vérifie toujours l’environnement `sandbox`, le schéma d’identifiant, le numéro exact, l’application OAuth et, une fois enregistré, l’identifiant distant de l’entreprise. Une connexion sandbox sans SIREN ne prouve ni une identité fiscale française ni une aptitude à émettre.

Avant la première émission française, les identités de test doivent être qualifiées, avec leurs établissements et les rattachements des gîtes. L’émission locale exige toujours les informations fiscales requises, dont SIREN/SIRET ; le transport refuse également une connexion sans SIREN même si un instantané défectueux contient lui aussi un SIREN absent. Utiliser un exemple fournisseur cohérent ou des identités fictives explicitement qualifiées pour la recette ; ne pas figer un PDF sous une identité inventée puis essayer de la remplacer pour le dépôt. Aucun brouillon ne doit être émis automatiquement pour simplement tester l’interface.

La réception actuelle interroge l’API depuis Node : aucun webhook ni tunnel public n’est nécessaire pour ce parcours. Le serveur local doit rester démarré pendant le retour OAuth et les traitements ; un redémarrage ne doit pas rejouer un dépôt ou un encaissement incertain.

### Préparation locale du 16/10/2026

Sur l’installation de développement locale uniquement, l’URL de retour ci-dessus a été enregistrée dans l’application OAuth **Burger Queen — bac à sable**, après autorisation, puis vérifiée en rouvrant son formulaire. Cela ne constitue pas un consentement OAuth.

La configuration privée du serveur est préparée dans le fichier racine `.env.update`, ignoré par Git et protégé en mode `600`. Ce fichier est chargé en dernier lorsque le serveur est lancé depuis `server/`. Il fixe les deux origines à `http://localhost:5173`, le retour OAuth exact et une clé aléatoire locale de 32 octets, encodée en base64. Conserver cette clé : ne pas la régénérer après enregistrement de secrets chiffrés, ni copier ce fichier vers une autre installation.

Seule la disponibilité de la connexion sandbox est activée (`SUPERPDP_SANDBOX_ENABLED=true`). Les interrupteurs d’émission, de réception et B2C restent `false`. Les workers de tâches et le planificateur multi-comptes sont également désactivés dans cette configuration locale afin de ne pas démarrer de traitements annexes pendant la préparation. Les lots et workers nécessaires à une future recette devront être réactivés explicitement, après revue du périmètre.

Le contrôle local du chargement de configuration et du chiffrement/déchiffrement a réussi, y compris le refus de déchiffrement sous un autre compte. Les 80 tests ciblés OAuth, émission et réception ont réussi avec un fournisseur simulé : ils ne constituent pas une recette avec SuperPDP. Aucune valeur secrète n’a été affichée ou versionnée et le fichier `.PDP` n’a pas été utilisé.

Le serveur de développement a été redémarré par son superviseur existant, sans migration ni réinitialisation. Le contrôle de santé via le proxy `localhost:5173` est positif ; le nouveau processus utilise toujours la base SQLite locale initiale et son contrôle d’intégrité est positif.

Les accès OAuth doivent ensuite être enregistrés chiffrés côté backend sur la fiche de l’entreprise de test ; le consentement reste une action séparée. La qualification d’un SIREN/SIRET de test est nécessaire avant une émission française, mais ne conditionne plus la connexion sandbox. Le numéro sandbox fournisseur ne remplace pas ces identités légales. Aucune entreprise, facture, connexion, demande OAuth ou tâche SuperPDP n’a été créée par la préparation initiale du serveur ; aucun consentement, appel fournisseur ou déploiement n’a été réalisé.

L’adaptation de la connexion sans SIREN comporte une migration SQLite et PostgreSQL (`20261016233000_superpdp_sandbox_identity`). Elle rend uniquement l’instantané `local_siren` nullable pour les connexions sandbox, sans modifier les SIREN des entreprises ni leurs documents. Les lignes non-sandbox restent soumises à une contrainte de présence en base. Les clés étrangères composites, unicités et données chiffrées existantes sont conservées. Sauvegarder avant application ; aucun reset, seed, consentement ou accès fournisseur n’est nécessaire pour cette migration. Le connecteur de production reste non implémenté et bloqué.

Sur l’installation localhost, cette migration a été appliquée après sauvegarde SQLite privée et cohérente. La comparaison avant/après n’a révélé aucun changement de données métier ; seule l’activité de session (`last_seen_at`) avait évolué. L’intégrité et les clés étrangères ont été contrôlées. Une fiche **Burger Queen — bac à sable**, sans SIREN/SIRET, établissement ni rattachement de gîte, a ensuite été créée depuis l’interface pour vérifier le parcours. Sa connexion est toujours **Non configuré** : aucun accès `.PDP`, consentement, facture ou traitement SuperPDP n’a été utilisé/créé pour cette vérification.

La suite automatisée complète, la compilation et le lint ont réussi (36 avertissements de hooks préexistants, aucune erreur). Les tests renforcés couvrent notamment le numéro sandbox avec zéros initiaux, le chiffrement et l’isolement sans SIREN, les identités distantes inattendues, le changement d’identité après configuration et le refus d’émission locale/de préparation de transport. La migration a également été vérifiée sur une base PostgreSQL temporaire isolée : chaîne complète, conservation de lignes préexistantes, acceptation du SIREN absent uniquement en sandbox et maintien des clés étrangères. Ce serveur temporaire a été arrêté ; aucun déploiement ni modification de production n’a été effectué.

## Matrice de recette avec preuves

Avant l’exécution, identifier chaque scénario comme **à faire**, **réussi**, **échoué** ou **hors périmètre approuvé** dans un compte rendu privé. Rien n’est attesté comme réalisé par ce document. Les tests automatisés et leurs fournisseurs simulés sont des preuves de comportement local uniquement.

| Scénario | Contrôle attendu | Preuve à conserver hors du dépôt |
| --- | --- | --- |
| R01 — deux entreprises fictives | Consentements, identités sandbox et comptes distants distincts ; aucun accès croisé, y compris avec le même identifiant OAuth si permis | Entités locales, comptes distants, dates et résultat du contrôle d’isolement |
| R02 — OAuth complet | Callback exact, session d’origine, PKCE, expiration, rotation et révocation ; production ou identité inattendue refusée | Résultats expurgés et identifiants d’audit, jamais code/token/secret |
| R03 — facture B2B France | Brouillon contrôlé → émission figée → conversion réelle → validation positive → dépôt explicitement confirmé une seule fois | Numéro, SHA-256 du PDF original/Factur-X, rapport fournisseur, référence et événements distants |
| R04 — avoir B2B | Avoir intégral lié à l’original et numérotation propre ; original inchangé ; validation/dépôt acceptés dans le périmètre de test | Références liées, empreintes, rapport et résultat fournisseur |
| R05 — erreurs et réponse perdue | Échec de validation bloquant ; résultat de POST inconnu non renvoyable ; recherche de référence en lecture seule | Tests simulés de panne et procédure d’investigation ; ne pas provoquer volontairement une incertitude réelle sans protocole approuvé |
| R06 — réception | Adresse de réception/consentement vérifiés séparément ; achat fictif reçu, original archivé, extraction éventuellement différée | Références distantes/locales, empreintes, avancement des deux curseurs |
| R07 — rapprochement achat | Confirmation humaine d’une dépense existante du même périmètre ; aucun nouveau coût ni changement comptable ; détection d’une dépense modifiée | Instantané et audit du lien/retrait, contrôle des totaux avant/après |
| R08 — B2C facturé | Profil uniquement biens ou services, note BAR/B2C, régime TVA/option débits cohérents ; aucune route parallèle d’agrégats ; pas de routage au particulier | Factur-X validé, `processing_rule=B2C`, transaction extraite dans SuperPDP, preuve d’absence de doublon |
| R09 — encaissements B2C | Saisie datée réelle et TTC par taux, acomptes de paiement partiels et multi-taux, plafonds exacts ; 212 distinct de l’enregistrement local | Références uniques des mouvements, ventilation/date et reçus, rapprochement avec les données de paiement SuperPDP |
| R10 — régimes sans e-reporting de paiement dans ce lot | Biens/option débits : journal local sans 212 automatique ; régime de franchise/exonération et cas exclus correctement qualifiés | Confirmation fiscale et observation fournisseur, ou exclusion explicite du scénario |
| R11 — reprise et concurrence | Relance du processus, deux demandes concurrentes, pagination/doublons ; aucun double POST ni saut de curseur ; propriétaire révoqué bloqué | Tests locaux, résultats de reprise et contrôle des références uniques |
| R12 — sauvegarde/incident | Restauration isolée, documents et empreintes conservés, secrets protégés/retirés selon format, transmissions/encaissements suspendus, tâches neutralisées | Manifeste, comparaison de parité, preuve d’arrêt de la source et test de non-rejeu |

Les factures B2C internationales ou mixtes, acomptes déduits partiellement à l’émission, remboursements/corrections d’encaissement et journaux de paiement comportant exonération, taux zéro ou sommes hors TVA (taxe de séjour notamment) restent exclus du premier lot. Une activité de location ne doit pas être déclarée prête au e-reporting global si ses factures habituelles entrent dans ces exclusions. Prévoir une recette et un développement dédiés ; ne pas supprimer une ligne fiscale pour contourner le blocage.

## Conditions de décision avant un futur pilote réel

Un responsable humain examine le compte rendu, les rejets/incertitudes et les exclusions. Un résultat inconnu n’est jamais « résolu » par absence dans une recherche, restauration d’une ancienne sauvegarde ou ressaisie sous une autre référence. Contacter le support pour connaître l’effet réel avant correction. Aucun effacement du journal ni rejeu de POST n’est autorisé par ce guide.

Le pilote ne pourra être considéré que lorsque les points suivants sont documentés :

- recette réelle passée pour chaque parcours retenu, avec références fournisseur et preuve d’absence de doubles déclarations ;
- qualification fiscale explicite et couverture des cas réellement utilisés par l’entreprise ;
- gestion des identités/permissions, secrets, journaux, sauvegardes et incidents validée ;
- responsable de surveillance, fréquence des contrôles, seuils d’alerte, assistance et procédure de rapprochement des incertitudes définis ; le bilan actuel ne notifie personne automatiquement ;
- entreprise/SIREN pilote, établissement/gîtes, documents autorisés, début/fin, volume maximal et critères d’arrêt déterminés ; pas de rattrapage automatique de l’historique ;
- chantier de connecteur de production réalisé et testé, puis autorisations explicites de déploiement et d’activation distinctes.

### Chantier de production encore nécessaire

Il ne suffit pas d’accepter `env=production` dans le contrôle sandbox existant. Conserver le refus de production dans les parcours sandbox et concevoir séparément :

1. configuration/consentements/clés de production indépendants, contrôle effectif de l’identité légale française attendue et du compte distant ;
2. stockage et contraintes reliant compte, entité, connexion, environnement et documents sans mélange avec la sandbox ; les tables de transport actuelles sont contraintes à `sandbox` ;
3. sélection explicite et limitée de l’entreprise/document pilote, permissions fortes, arrêt par lot et confirmations sans reprise des anciennes tâches ;
4. qualification des formats et profils réels, validation fournisseur, annuaire/mandats requis et responsabilités de réception ;
5. supervision effective et alertes, gestion des résultats inconnus et corrections, sauvegarde testée et procédure d’arrêt qui conserve le suivi ;
6. tests d’isolement production/sandbox, de concurrence/rotation et de non-rejeu après copie/restauration, sans utiliser de données réelles pour les tests automatisés.

Ce chantier n’est pas réalisé ou autorisé par le bouton de bilan. Aucune variable `SUPERPDP_PRODUCTION_*` n’est ajoutée dans cette livraison.

### Déploiement éventuel sur Alwaysdata, après nouvelle autorisation

Préférer d’abord une installation de test distincte. Lorsqu’un déploiement sera expressément demandé, suivre `AGENTS.md` : tests/build, revue de la révision et de l’état du serveur, sauvegarde récupérable, version destinée à `origin/main`, puis **déploiement complet**, car les étapes précédentes ajoutent une dépendance OAuth et des migrations Prisma. Ne pas exécuter le script de production depuis le checkout local, ne pas choisir le mode léger pour ces migrations. Le présent guide ne demande pas d’exécuter cette procédure maintenant.

Un déploiement du code avec tous les interrupteurs SuperPDP désactivés ne constitue ni un raccordement opérationnel ni une autorisation d’émettre. Vérifier révision, redémarrage, santé et actifs de l’interface ; un succès de build/push ou de `/api/health` ne prouve pas la recette fiscale.

## Arrêt et retour contrôlé

En incident, arrêter les nouvelles demandes du lot concerné et identifier les tâches/opérations déjà engagées avant tout redémarrage. Désactiver un interrupteur ne rappelle pas un POST déjà parti. Conserver archives, références distantes, reçus, intentions d’envoi et audits. Le suivi en lecture seule peut nécessiter de rétablir le connecteur dans un périmètre maîtrisé ; ne pas créer de nouvel envoi pour vérifier un ancien.

Une restauration de base n’annule aucune facture ni déclaration déjà reçue par SuperPDP. Ne jamais relancer aveuglément les anciennes tâches après retour de version. Comparer avec l’état fournisseur et réautoriser la bonne entreprise avant reprise. Les corrections commerciales ou fiscales passent par leurs parcours dédiés, pas par suppression du PDF, réutilisation de numéro ou réécriture de l’instantané.

## Modèle de compte rendu privé

Conserver séparément du code et des secrets :

- date, responsable et révision testée ; environnement et entreprise fictive visés ;
- scénario et périmètre, état initial, étapes effectivement réalisées, résultat observé et statut de recette ;
- références locales/distantes et empreintes utiles, sans tokens, URL de callback complète, données personnelles ni secret ;
- anomalies, impact, investigation du résultat réel, correction/exclusion et nouveau contrôle ;
- décision, périmètre limité et signataire ; autorisations de déploiement/activation si elles sont obtenues ultérieurement.

Un rapport de tests simulés, un bilan local sans anomalie ou ce modèle non rempli ne vaut pas procès-verbal de recette réussie.

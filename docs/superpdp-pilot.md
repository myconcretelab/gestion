# SuperPDP — recette et préparation du pilote (étape 8)

## État et limites de cette livraison

Cette étape prépare le pilote ; **elle ne déploie rien, n’utilise pas les accès `.PDP`, ne réalise pas de consentement et ne soumet aucune facture ni déclaration**. Les flux développés aux étapes 4 à 7 sont exclusivement sandbox, désactivés par défaut. Le connecteur de production n’est pas implémenté : un simple changement de variable, de secret ou d’URL ne peut pas le rendre opérationnel. Le domaine API SuperPDP est commun aux deux environnements ; seul le domaine ne permet pas de les distinguer.

Trois autorisations sont distinctes : déployer le code sur une installation de test, effectuer une recette avec le vrai fournisseur en sandbox, puis développer/déployer/activer un connecteur de production sur un périmètre approuvé. Aucune de ces autorisations ne doit être déduite d’un bilan local sans anomalie. La consigne actuelle reste **aucun déploiement**.

Références vérifiées le 16/10/2026 : [OpenAPI officielle](https://www.superpdp.tech/openapi/) et [document source `1.37.0.beta`](https://api.superpdp.tech/openapi/superpdp.json), [authentification](https://www.superpdp.tech/documentation/4/), [synchronisation](https://www.superpdp.tech/documentation/14/), [e-reporting](https://www.superpdp.tech/documentation/15/). Vérifier les évolutions de contrat avant une recette ultérieure. Les choix fiscaux et le périmètre réglementaire doivent être qualifiés avec le conseil de l’entreprise.

## Bilan local dans l’application

Ouvrir **Paramètres → Organisation → Entreprises → entreprise → SuperPDP → C · Bilan de préparation des tests**, puis **Établir le bilan local de préparation**. Seul un propriétaire authentifié du même compte y accède. Le bilan est disponible même lorsque les connecteurs sont désactivés.

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

### Reprise des contrôles réels du 16/10/2026 — sans dépôt

Contrôles réalisés sur localhost à partir de la révision `92fd5e6`, avec l'entreprise fictive Burger Queen et sa connexion sandbox existante. La vérification normale depuis l'interface a confirmé l'identité attendue et renouvelé les accès via le backend. La session fournisseur, l'entreprise sandbox et ses deux adresses Peppol ont été contrôlées en lecture seule. Aucun secret ni jeton n'a été affiché ou versionné.

Un exemple Factur-X généré par l'API fournisseur, sans création de facture distante, a passé les 182 contrôles de son rapport de validation. Une seconde preuve isolée a réutilisé le moteur PDF de l'application et son constructeur de données structurées avec des identités fictives fournies explicitement par l'exemple SuperPDP : deux lignes, deux taux, 150 EUR HT, 25 EUR de TVA et 175 EUR TTC. Elle n'a créé ni facture locale, ni numéro officiel, ni transmission, ni paiement.

Cette preuve a identifié trois écarts à corriger dans le connecteur applicatif avant de poursuivre :

- aligner le format source de conversion sur `from=en16931`, au lieu de `from=json`, conformément au contrat OpenAPI vérifié ;
- limiter les prix unitaires nets à six décimales au maximum, au lieu des huit actuellement générées (`BR-FR-DEC-03 / BT-146`) ;
- fournir les notes structurées de paiement B2B requises, notamment l'indemnité de recouvrement (`BR-FR-05 / BT-22`, code PMT), avec des conditions qualifiées et cohérentes avec le PDF. Les valeurs de démonstration du fournisseur ne constituent pas des paramètres métier à reprendre automatiquement.

Ces adaptations ont été appliquées uniquement au script de diagnostic temporaire, pas au code applicatif. L'exemple fournisseur n'ayant pas de SIRET, ses identifiants optionnels ont également été repris sans fabriquer de SIRET ; cette facilité du test isolé ne modifie pas les contrôles d'émission locale.

Avec ces adaptations, la conversion réelle et la validation réelle ont réussi : Factur-X EN16931, 191 contrôles, zéro échec. L'XML embarqué contient les totaux attendus. Les rendus raster du PDF source et du Factur-X sont identiques ; le document d'une page a été inspecté visuellement. Les PDF et preuves expurgées sont conservés hors Git. Cette preuve confirme la réutilisation du rendu actuel, **pas** le succès du parcours complet R03 : aucune émission figée, aucun dépôt ni suivi de facture distante n'a été effectué.

Le contrôle final de la base locale retrouve zéro facture, transmission, facture reçue et paiement électronique. L'identité fiscale locale est inchangée : SIREN/SIRET absents, régime TVA et adresse à compléter après qualification. Ne pas remplacer le SIREN par le numéro sandbox ni modifier une identité connectée sans suivre le parcours de déconnexion/reconfiguration. Émission, réception, B2C et workers restent désactivés. Aucun déploiement, changement de production ou modification du connecteur n'a été réalisé pendant cette reprise. Les corrections ci-dessus restent à autoriser et à intégrer avec leurs tests avant la suite de la recette.

Références du contrat consulté : [documentation officielle](https://www.superpdp.tech/openapi/) et [OpenAPI JSON](https://api.superpdp.tech/openapi/superpdp.json), version observée `1.37.0.beta`. Les rapports et empreintes de cette exécution restent privés conformément au modèle de preuve ci-dessous.

### Corrections autorisées après le diagnostic du 16/10/2026

Les trois corrections ci-dessus sont désormais intégrées au code de travail, sans déploiement ni activation de lot : conversion `from=en16931`, prix nets limités à six décimales et mentions de paiement B2B explicites. Pour les grandes quantités, lorsque l'arrondi du prix unitaire modifierait le montant de ligne, le prix est exprimé pour la quantité totale via la quantité de base EN16931 ; les totaux monétaires existants restent inchangés.

Le brouillon fiscal conserve les textes de pénalités de retard, d'indemnité de recouvrement et d'escompte. Ils sont saisis dans l'éditeur de facture pour un client entreprise, sans taux ni montant prérempli, après qualification des conditions applicables. Les mêmes textes alimentent le PDF et les notes structurées PMD, PMT et AAB, y compris pour un avoir. Le bloc imprimé conserve des sauts de ligne sans multiplier les marges des paragraphes. Le particulier n'hérite pas de ces mentions B2B et le traitement BAR/B2C existant est conservé.

Le champ JSON ajouté est rétrocompatible à la lecture des anciens brouillons et ne demande pas de migration. Une mention manquante bloque l'émission B2B avant toute attribution de numéro. Une facture B2B déjà figée sans ces mentions ne peut pas être préparée pour SuperPDP et n'est jamais corrigée automatiquement : son PDF et son instantané restent intacts. Faire examiner ce document avant de choisir un parcours de correction approprié.

Une nouvelle preuve isolée réutilise le PDF et le constructeur corrigés, puis le transport réel sans réécriture de requête, de prix ni de notes. Résultat observé : Factur-X valide, 189 contrôles, zéro échec ; PDF source d'une page inspecté visuellement. Comme précédemment, cette preuve utilise les identités fictives explicitement données par SuperPDP et omet uniquement le SIRET optionnel absent de son exemple, sans toucher aux fiches locales ni aux gardes d'émission. Elle ne constitue pas une émission depuis l'application ni un dépôt de facture.

**Prérequis B2B supplémentaire découvert pendant cette preuve :** le validateur exige le mode de facturation BT-23 (`business_process_type`, règle BR-FR-08). Le parcours de préparation B2B actuel ne le renseigne pas ; la preuve isolée fixe explicitement `S1` pour sa prestation fictive non payée. Cette valeur ne doit pas être appliquée par défaut aux factures métier. Il reste à concevoir et autoriser la sélection/qualification biens, services ou mixte, avec le mode correspondant et ses contrôles, avant de considérer R03 prêt à être poursuivi. Le traitement B2C existant renseigne déjà son propre mode et n'est pas élargi par ces corrections.

Les nouveaux tests couvrent notamment les requêtes multipart réelles au niveau du contrat simulé, la précision et les quantités extrêmes, la lecture des anciens brouillons, les mentions absentes/vides/trop longues, l'échappement HTML, la cohérence PDF/notes, la conservation dans l'avoir et le refus de réécrire une facture figée. Les tests d'intégration utilisent des bases temporaires ; aucune facture, transmission ou réception n'a été ajoutée à la base localhost de l'utilisateur. Les interrupteurs d'émission/réception/B2C restent désactivés.

Vérification finale : suite complète réussie (14 tests partagés, 385 serveur et 102 client, soit 501), compilation complète réussie et lint sans erreur (36 avertissements de hooks préexistants). La suite a été exécutée avec une base de repli temporaire et sans alias `DATABASE_URL_SQLITE` hérité, afin que les scénarios d'installation puissent migrer leurs propres bases isolées. Aucun reset ni seed de la base utilisateur n'a été exécuté.

### Nature d'opération B2B — ajout autorisé du 16/10/2026

Le prérequis BT-23 ci-dessus est désormais pris en charge pour le lot B2B ordinaire. Dans le brouillon, après le choix d'un client entreprise, un sélecteur permet de qualifier explicitement **biens**, **services** ou **mixte** (biens et services distincts, non simplement plusieurs taux de TVA). La valeur initiale et la lecture des anciens JSON restent `unknown` ; rien n'est déduit du gîte, du libellé, du gestionnaire ou des taux. Reproposer les lignes ne remplace pas le choix déjà saisi et toute modification du choix retire la confirmation de revue fiscale.

Le champ `operation_kind` est conservé dans les données fiscales existantes et dans l'instantané structuré à l'émission, sans nouvelle table ni migration. Un choix absent bloque l'émission d'une nouvelle facture B2B avant numérotation. Les cadres ordinaires B1/S1/M1 ou entièrement payés B2/S2/M2 sont déterminés à partir du choix et des seuls montants réellement reçus figés à l'émission. Un solde nul sans somme reçue ne suffit pas à déclarer une facture « déjà payée ». Le statut de paiement courant et les encaissements ultérieurs ne recalculent jamais ce cadre.

Les avoirs du nouveau parcours reprennent la nature de leur facture source ; l'avoir intégral sans paiement utilise le cadre ordinaire correspondant. Les avoirs d'anciens documents peuvent rester possibles localement sans inventer une nature absente, mais ils ne deviennent pas transmissibles pour autant. Les factures déjà émises et leurs PDF ne sont pas modifiés. La fiche de facture et le panneau SuperPDP présentent les informations figées ; aucun choix de nature n'est accepté au moment du dépôt.

La préparation B2B exige une nature figée et un mode compatible avec elle, le type de document et les montants. Un cadre absent, incohérent ou particulier est bloqué avant conversion ; le contrôle est également appliqué aux tâches de préparation/dépôt et aux demandes directes de dépôt. Une ancienne préparation ne reçoit pas de valeur de repli. Le suivi d'un dépôt déjà tenté reste consultable sans réautoriser son renvoi.

Ce lot ne qualifie pas les factures de solde après acompte, les opérations déjà déclarées, la sous-traitance, les factures multi-vendeurs ou les autres cadres particuliers. Les paiements partiels à l'émission sont bloqués pour une nouvelle facture B2B et pour sa préparation, au lieu de leur attribuer un cadre ordinaire par défaut. Faire examiner ces cas avant de développer leur parcours. Le choix B2B ne détermine pas le profil de e-reporting B2C ; ses confirmations, régimes, limites et exclusion du mixte restent inchangés.

Références techniques consultées : [OpenAPI SuperPDP](https://api.superpdp.tech/openapi/superpdp.json) `1.37.0.beta`, schéma `process_control` (BT-23), et nomenclature BR-FR-08 des cadres de facturation de la norme AFNOR XP Z12-012, référencée par la [DGFiP](https://www.impots.gouv.fr/specifications-externes-b2b). La validation fournisseur complète reste requise pour chaque document préparé : ces mappings ne certifient pas la qualification fiscale d'une location.

Les tests couvrent les trois choix, les factures ordinaires/payées/à total nul, les avoirs, les valeurs malformées, l'enregistrement des brouillons, le refus avant numérotation, le gel après émission, le transport du cadre sans recalcul, les anciennes données/tâches et le parcours B2C inchangé. Les fournisseurs sont simulés dans les tests automatisés, avec bases temporaires ; aucun consentement, dépôt réel ou activation de worker n'est impliqué par cette livraison.

Vérification finale de cet ajout : 512 tests réussis (17 partagés, 391 serveur, 104 client), compilation complète réussie, lint sans erreur et 36 avertissements de hooks préexistants. Le serveur localhost répond au contrôle de santé ; la base utilisateur ne contient toujours aucune facture, transmission ni réception. Aucun appel réel à SuperPDP, modification des identités locales, déploiement ou activation des lots n'a été effectué pendant cet ajout.

### Reprise après réorganisation de la page — 16/10/2026

Contrôles effectués sur localhost après la révision `5477da5`, sans dépôt ni appel OAuth/fournisseur :

- Le bilan de Burger Queen retrouve sa dernière observation de connexion sandbox vérifiée. Sa fiche reste sans SIREN, régime de TVA ni adresse de siège ; l'établissement reste sans SIRET. Ce constat ne valide pas l'identité fiscale et ne justifie pas une émission.
- Le passage à Tricatel montre une configuration OAuth vide et un bilan distinct, sans reprendre la connexion de Burger Queen. Aucun consentement Tricatel n'a été réalisé. Le scénario multi-entreprise R01 n'est donc pas encore terminé avec le fournisseur.
- Les bilans propres à chaque entreprise sont accessibles depuis le nouveau volet SuperPDP. Émission, réception, B2C et worker restent désactivés ; aucun interrupteur n'a été modifié pour la recette.
- Un nouveau test d'API reproduit quatre gîtes dans un même compte, répartis entre deux entreprises et deux contacts. Il vérifie les rattachements par identifiants, leur conservation lors d'un changement de gestionnaire, l'inventaire et l'absence d'accès depuis un autre compte. Ses identités synthétiques restent dans sa base temporaire, pas dans les fiches localhost ni chez SuperPDP.

La suite complète réussit : **520 tests (17 partagés, 392 serveur, 111 client)**, sans échec ni test ignoré. La compilation complète réussit et le lint ne relève aucune erreur (36 avertissements de hooks préexistants). Les scénarios SuperPDP utilisent un fournisseur simulé ; ils ne prouvent pas la réussite des échanges réels. Le premier lancement général avait une base temporaire de repli vide : les tests historiques qui l'utilisent échouaient faute de tables. Après application des migrations à cette seule base temporaire, le lancement complet réussit. Aucun reset/seed ni migration de la base utilisateur n'a été effectué.

Le contrôle de santé localhost est positif. La lecture de la base utilisateur retrouve toujours zéro facture, transmission, achat reçu et paiement électronique. Aucune identité ni connexion locale n'a été modifiée pendant ces contrôles. L'autorisation de modifier les fiches de test ne dispense pas de disposer d'identités fictives cohérentes pour une future émission ni du consentement humain requis pour une nouvelle connexion.

La prochaine étape du parcours réel multi-entreprise est de configurer et autoriser Tricatel avec les accès adaptés et son numéro sandbox, sans réutiliser ce numéro comme SIREN. Avant R03, qualifier séparément les identités de test (dont le SIRET), les données fiscales et le document à émettre ; ne pas contourner les gardes pour obtenir un dépôt. Aucun déploiement ni passage en production n'a été réalisé.

### Parcours guidé et contrôle des deux connexions — 16/10/2026

Les boutons des volets Entreprise et Établissements deviennent **Enregistrer et continuer**. Après validation du formulaire, confirmation serveur et actualisation des données, ils ouvrent respectivement les volets Établissements et Gîtes rattachés. En cas d'échec, le volet reste ouvert pour correction. L'arrivée sur les établissements reprend le premier établissement existant si aucune sélection ni saisie d'établissement n'est en cours ; un brouillon déjà saisi n'est pas remplacé.

Le volet Gîtes ne possède pas de sauvegarde propre : les liens s'enregistrent dans les fiches gîtes. Son bouton **Actualiser et continuer vers SuperPDP** relit les rattachements avant d'ouvrir le dernier volet, uniquement pour les utilisateurs autorisés à gérer les intégrations. Une absence de gîte est signalée mais n'empêche pas la préparation d'une connexion sandbox. Le parcours s'arrête à SuperPDP : aucune configuration OAuth, autorisation, émission ni activation n'est déclenchée par cette navigation. L'avancement confirme un enregistrement, pas la complétude fiscale ; les contrôles de facturation restent inchangés.

Recette manuelle sur Tricatel, après sauvegarde SQLite privée : un SIREN trop court est refusé sans changement de volet, puis le champ est remis à sa valeur vide initiale. Le réenregistrement de la fiche existante ouvre son établissement déjà créé ; le réenregistrement de cet établissement ouvre le gîte rattaché ; la continuation ouvre SuperPDP. Les champs métier des entreprises, établissements et gîtes sont identiques à la sauvegarde avant test, hors dates de mise à jour.

Les deux connexions déjà consenties par l'utilisateur ont ensuite été vérifiées séparément depuis l'interface : Tricatel, numéro sandbox `000000001`, puis Burger Queen, numéro `000000002`, avec confirmation de leurs identités attendues par le backend. Cela constitue un contrôle réel des connexions, pas une preuve de recette complète d'échange ou du cycle OAuth. Aucun nouveau consentement ni changement d'annuaire/mandat n'a été réalisé ; les jetons restent gérés par le backend sans être exposés. Aucune facture, transmission, réception ni paiement électronique n'a été créé.

Les 113 tests client réussissent, dont les transitions du parcours et son arrêt selon les droits. La compilation complète et le lint réussissent (36 avertissements de hooks préexistants, aucune erreur). Aucun changement serveur, migration ou déploiement n'est impliqué. La centralisation des identifiants OAuth de l'éditeur pour un futur SaaS reste un chantier distinct de cette amélioration de navigation.

### Échange réel avec le générateur fournisseur — 16/10/2026

Après autorisation explicite de l'utilisateur, une facture Factur-X a été téléchargée depuis le générateur officiel SuperPDP pour Burger Queen, puis sa destination Tricatel a été confirmée contre les adresses d'annuaire des deux connexions sandbox. Le PDF et ses identités n'ont pas été modifiés. Ses deux pages ont été inspectées visuellement ; le rapport réel fournisseur est positif : **182 contrôles, zéro erreur**.

Un dépôt B2B unique a été effectué avec le transport Node existant, après création d'une référence externe unique et d'une intention d'envoi durable dans les preuves privées. Le contrôle synchrone n'a pas été désactivé. Les accès ont utilisé le service OAuth existant, ses verrous et ses contrôles d'identité/environnement, dans le contexte du compte et d'une session propriétaire locale active. Aucun secret ni jeton n'a été affiché et `.PDP` n'a pas été utilisé.

Le suivi réel relève les événements `api:uploaded`, `fr:200`, `fr:201`, `fr:203` et `fr:202`. Une seule facture correspond à la référence côté émetteur et une réception correspondante existe côté Tricatel. Les trois PDF comparés (générateur, original émetteur, original destinataire) ont la même empreinte SHA-256. Cela confirme la réception technique de cet exemple ; les événements ne prouvent ni paiement ni acceptation par l'administration.

Les références exactes, empreintes, rapports, intentions, réponses et observations restent hors Git dans le dossier privé `server/data/superpdp-recette/20261016-generator-3d76375a/`. **Ne jamais rejouer ce dépôt** : se référer à son compte rendu et à son journal privé, y compris après une restauration ou depuis un autre poste. Le PDF témoin est disponible localement dans `output/pdf/superpdp-echange-sandbox-20261016.pdf`, hors Git.

Ce test valide un échange du **document généré par SuperPDP**, pas l'émission depuis les factures propres de l'application ni l'import métier de ses achats. L'original reçu est archivé dans les preuves, sans créer d'achat dans l'application. Les tables métier, identités, rattachements, compteurs, séquences et tâches ont été comparés à la sauvegarde antérieure et sont inchangés ; les mises à jour OAuth et leur audit sont attendus. Factures, transmissions, réceptions et paiements électroniques locaux restent à zéro. Les contrôles SQLite sont positifs.

Aucun code applicatif n'a été modifié pour cet échange, aucun worker ni interrupteur applicatif d'émission/réception/B2C n'a été activé, et aucun déploiement n'a été réalisé. Les parcours natifs de R03/R06, l'avoir, le e-reporting B2C, les incidents et les conditions SaaS/production ne sont pas attestés par cette seule preuve.

### Réception native et parcours fictif isolé — 16/10/2026

La recette réelle a été prolongée avec l'autorisation explicite de l'utilisateur. Le document du générateur précédemment échangé est maintenant archivé dans les achats de Tricatel avec ses événements et son original intact ; une seconde lecture n'a créé aucun doublon.

Un [parcours opérateur sandbox distinct](superpdp-sandbox-recipe.md) a ensuite été développé pour les seules entreprises fictives du fournisseur. Il réutilise le calcul fiscal, le constructeur EN16931 et le générateur PDF de l'application, sans inventer de SIRET ni modifier les SIREN locaux, et sans assouplir les contrôles des factures normales. Il ne crée pas de facture métier et n'utilise aucune séquence comptable. Ce parcours est local, manuel et hors des routes HTTP/automatisations ; ce n'est pas une nouvelle interface de facturation client.

Sa facture de test de 175 EUR TTC a passé la validation réelle (191 contrôles, zéro échec) et la vérification visuelle de sa page unique. Un unique dépôt a été confirmé, suivi d'une réception correspondante chez Tricatel et d'un import natif dans les achats de l'application. L'original est identique au Factur-X envoyé, les valeurs structurées concordent après normalisation de représentation du fournisseur, et le deuxième passage ne crée aucun doublon. Les références et preuves privées sont précisées dans le guide dédié : **ne pas rejouer ces dépôts**.

Les deux achats reçus restent non rapprochés ; aucun enregistrement de dépense ou de paiement n'a été créé. La réception n'a été activée que dans les processus de recette ciblés, puis arrêtée ; aucun worker général ni fichier de configuration n'a été activé. Les données fiscales légales, rattachements, factures et séquences restent inchangés. Aucun déploiement n'a été réalisé. R06 bénéficie ainsi d'une preuve d'import réel ; R03 reste partiel tant que le cycle brouillon/émission métier avec ses identités légales propres n'a pas été qualifié. L'avoir, le B2C, les incidents et la production restent distincts.

## Matrice de recette avec preuves

### Complément du 18/10/2026 : atelier web

L'[atelier web local](superpdp-workshop.md) ajoute une recette technique depuis l'interface, isolée des factures métier : copie du seul montant d'une réservation fictive, vérification, émission PDF figée, conversion/validation, dépôt unique et suivi, puis avoir intégral distinct. La facture de 420 EUR TTC a réussi 151 contrôles réels, l'avoir 154 ; tous deux ont été reçus et importés dans les achats Tricatel avec leurs originaux intacts et sans doublon. La séparation des données/compteurs habituels et la lecture seule après redémarrage ont été vérifiées. Aucun déploiement, dépense ou paiement créé. Les références, limites et preuves privées sont dans le guide ; ne pas rejouer les dépôts.

Ce complément atteste le parcours technique web et l'avoir sandbox de ce scénario, pas une complétude réglementaire des factures ordinaires. Les cas métier, le B2C, les rapprochements humains, les incidents plus larges et la production restent distincts.

Avant l’exécution, identifier chaque scénario comme **à faire**, **réussi**, **échoué** ou **hors périmètre approuvé** dans un compte rendu privé. Les résultats effectivement observés sont ceux des comptes rendus datés ci-dessus ; cette matrice décrit les contrôles attendus, pas une liste de réussites. Les tests automatisés et leurs fournisseurs simulés sont des preuves de comportement local uniquement.

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

# Atelier B2C SuperPDP — recette technique locale

## Périmètre

Accès : **Factures → Atelier de facturation test → Créer un nouveau test → Particulier fictif** (`/factures/test-superpdp`). Même permission administrateur, activation explicite par session et barrières localhost/base SQLite de développement que l’[atelier B2B](superpdp-workshop.md). Aucun flux ordinaire, worker ou mode de production n’est activé.

Le scénario ne copie **aucune réservation**, identité client, contact, date de séjour ou coordonnée bancaire. Il utilise Burger Queen, le client « Client particulier fictif » et une adresse synthétique. Aucun SIREN/SIRET légal local n’est ajouté ou modifié. Les identifiants fictifs du fournisseur ne sont pas des identités utilisables en production.

Scénario figé : prestation de services de **120 EUR TTC, 100 EUR HT, 20 EUR de TVA**, régime mensuel sans option sur les débits, aucune somme reçue à l’émission, puis **deux encaissements fictifs de 60 EUR**. Ce taux/profil est une donnée de recette explicite, pas une qualification fiscale de l’hébergement. Les paiements partiels après émission ne constituent pas une prise en charge des factures de solde avec acompte déduit.

Le même calcul fiscal, constructeur EN16931 et générateur PDF sont réutilisés. Le document porte `BAR=B2C`, cadre `S1`, exigibilité `432`, sans identifiant légal/TVA ni adresse électronique de l’acheteur. Pas de pénalités B2B héritées. Conversion/validation fournisseur positives et relecture du Factur-X sont nécessaires avant l’unique dépôt `processing_rule=B2C`. Le PDF n’est pas acheminé au particulier ; ce parcours ne teste pas l’envoi client par courriel.

## Parcours et preuves

1. Créer, vérifier et émettre la facture fictive ; PDF et instantané figés par empreintes, sans `Facture` métier ni séquence comptable.
2. Préparer le Factur-X puis confirmer son dépôt unique. Le serveur vérifie l’identité sandbox et le profil TVA distant. Aucun changement du profil distant n’est automatique ; un profil absent ou différent bloque la préparation.
3. **Vérifier les statuts, sans renvoyer** : recherche par référence externe unique, contrôle de l’original par empreinte et lecture de la transaction extraite via `GET /v1.beta/b2c_transactions?invoice_id=…`. La transaction n’est marquée vérifiée que s’il existe exactement une correspondance complète, sans pagination résiduelle, de type services/vente, date, devise, bases, TVA et taux attendus. Une absence reste en attente, un doublon/écart est signalé.
4. Saisir explicitement la date du mouvement fictif 1 (60 EUR), entre émission et aujourd’hui à Paris, puis l’enregistrer **sans envoi**. Référence figée `<UUID>-P1`. Confirmer séparément son unique message `fr:212`, avec détails `MEN`, TTC/date/devise/taux exacts. Répéter pour `<UUID>-P2`, seulement après confirmation du premier message. Aucun transfert de fonds.
5. Actualiser pour vérifier chaque extraction de paiement via `GET /v1.beta/b2c_payments?invoice_event_id=…`, liée au reçu exact, jamais rapprochée sur le seul montant/date. Les deux mouvements totalisent au maximum le montant fixe de 120 EUR. Aucune modification du solde métier, des réservations ou du PDF d’origine.
6. Lorsque les données extraites portent un `ppf_ereporting_id`, lire seulement cette déclaration via `GET /v1.beta/ereportings/{id}`. Contrôler entreprise, rôle vendeur, type et période. Afficher ses événements sans déduire une acceptation administrative d’un dépôt ou d’un accusé technique. Les déclarations sont différées ; leur absence ne justifie jamais de rejouer un dépôt ou un paiement. Aucun polling automatique, agrégat parallèle ou déclenchement manuel de déclaration.

Les lectures de paiements/déclarations se limitent aux identifiants rattachés à ce scénario. Il n’existe aucun POST `/b2c_transactions` ou `/b2c_payments` dans l’atelier : cela déclarerait à nouveau les données déjà extraites de la facture et des messages 212.

## Protections

- Conservation des protections de l’atelier B2B : compte/session propriétaire, origine, hôte local, absence de cache, secrets OAuth chiffrés uniquement au backend, contrôle réel d’identité/consentement, fichiers privés hors Git, révisions/verrou et empreinte mémoire, aucune reprise d’écriture après redémarrage/restauration.
- Avant chaque message 212 : nouveau contrôle du profil TVA distant, de la facture distante B2C, de l’historique complet et des extractions antérieures. Rejet, historique tronqué, message externe 212 non reconnu, précédent résultat incertain ou extraction antérieure absente/erronée bloquent tout nouvel envoi. Une déclaration liée présentant un rejet bloque également.
- Barrière en mémoire avant état `sending` durable, puis fichier exclusif `payment-N-intent.json` avant POST. Le reçu brut est conservé dans `payment-N-provider.json` et doit correspondre exactement à la demande avant de confirmer le mouvement. Aucune relance automatique. Un résultat inconnu reste bloqué, y compris après actualisation ; sa correction exige un rapprochement humain, pas une correspondance approximative ni un nouveau mouvement.
- Les observations et réponses utiles sont conservées sans jeton dans des preuves append-only `reporting-<UUID>.json`. Une extraction en attente n’est pas une confirmation. Les identifiants 64 bits restent des chaînes ; comparaisons décimales exactes sans tolérance flottante.
- Anciens journaux sans les nouveaux champs : lus comme B2B, sans migration ni réécriture des archives initiales. Le B2B et l’avoir intégral existants restent distincts. Avoirs/remboursements B2C refusés côté serveur et non proposés à l’écran.

Exclusions : situations fiscales réelles de location non qualifiées, biens/mixte/international, taxe de séjour et hors-champ, exonérations/franchise/taux zéro, acomptes déduits à l’émission, trop-perçus, remboursements/corrections, avoirs B2C, ventes sans facture et déclaration par agrégats, automatisation SaaS/production. Ne jamais retirer une vraie ligne fiscale pour contourner une exclusion.

## Contrat fournisseur

Vérifié le 18/10/2026 : [guide e-reporting](https://www.superpdp.tech/documentation/15/) et [OpenAPI officielle 1.37.0.beta](https://api.superpdp.tech/openapi/superpdp.json). Le guide documente l’extraction depuis les factures B2C (`BAR=B2C`) et les événements 212, l’absence d’acheminement au particulier et l’interdiction de doublonner avec les déclarations directes. La configuration TVA se lit via `GET /v1.beta/companies/me` et se modifie, uniquement sur accord explicite, via **`PATCH /v1.beta/companies`**, pas `/companies/me`.

Le contrat comporte quelques incohérences `required`/`properties` dans les schémas de paiements ; le lecteur ne synthétise aucun champ manquant. Il exige les valeurs nécessaires à la preuve, conserve les montants/types connus et refuse les réponses inexploitables. Ce contrat doit être revérifié avant une nouvelle recette.

## Essai réel du 18/10/2026 — interrompu avant dépôt

Deux PDF natifs d’une page ont été générés depuis l’interface et inspectés. Aucun dépôt de facture ou message 212 n’a été effectué ; aucun Factur-X n’a été obtenu. Aucun paiement réel, nouvelle réservation, facture métier, séquence ou écriture comptable n’a été créé. Ne pas rejouer ces UUID.

- `265e2308-3202-44c9-a581-36fee8f485ba`, `TEST-B2C-20261018-265e23083202` : arrêt au contrôle du profil distant, car `vat_regime` était vide. Archive conservée en lecture seule après redémarrage, aucun appel de dépôt.
- Accord explicite de l’utilisateur obtenu dans ce chat pour modifier **seulement Burger Queen sandbox**, entreprise `114214`, numéro sandbox `000000002`, régime mensuel sans option débits. Le contrôle OAuth existant a revérifié l’identité avant l’opération. Une première requête PATCH à `/companies/me` a répondu 404, sans changement ; la route documentée `/v1.beta/companies` a ensuite réussi. Relecture confirmée : `env=sandbox`, `vat_regime=monthly`, `has_vat_on_debits=false`. Les paramètres fiscaux des fiches locales et Tricatel ne sont pas modifiés. Preuves privées `b2c-profile-20261018*-intent.json` et `b2c-profile-20261018-documented-result.json` à côté des journaux.
- `24ca2208-395f-4e1c-a2f9-8334b27f0465`, `TEST-B2C-20261018-24ca2208395f` : profil vérifié, PDF/instantané figés. Le convertisseur public `POST /v1.beta/invoices/convert?from=en16931&to=factur-x` retourne **HTTP 400**. La réponse cite notamment **BR-FR-05** (mentions PMT/PMD/AAB) et **BR-FR-12/BT-49** (adresse électronique de l’acheteur obligatoire), plus un avertissement PEPPOL-EN16931-R008 sur un élément de livraison vide. Le document comporte pourtant `BAR=B2C`, acheteur particulier sans identifiant/adresse électronique, `S1`, exigibilité `432`, 100 HT +20 TVA =120 TTC.

Les mentions et le routage B2B n’ont pas été ajoutés pour contourner le refus. Ce résultat ne suffit pas à conclure que toute l’API B2C est indisponible : il faut demander à SuperPDP comment obtenir **une conversion et une validation B2C conformes sans adresse de destinataire ni conditions B2B** avec cette version et ce profil. Ne pas passer directement au dépôt sans validation, ne pas utiliser de paramètre non documenté, ne pas envoyer les agrégats en parallèle. Le parcours métier B2C ordinaire peut partager cette limite et n’est pas attesté par les tests simulés.

Preuve privée de conversion : `conversion-diagnostic.json` dans le répertoire du second UUID ; contient la réponse de cette opération publique et uniquement les identités fictives du scénario, sans jeton. Les diagnostics répètent seulement la conversion publique pour conserver la preuve ; aucun appel à `/invoices` n’est effectué. L’écran signale la qualification inachevée et aucun bouton de dépôt n’est proposé après ce refus.

Les vérifications automatisées avec fournisseur simulé attestent les contrôles locaux (dont deux paiements partiels et leurs extractions/déclarations), **pas une réussite réelle des étapes dépôt/transaction/paiements/retours administratifs**, qui restent à exécuter après clarification et accord de reprise.

Vérification finale : **555 tests réussis** (17 partagés, 417 serveur, 121 client), aucun échec ni test ignoré. Compilation complète réussie ; lint sans erreur, 36 avertissements de hooks préexistants. Les tests couvrent aussi les nouvelles routes protégées, le refus de conversion et sa preuve sûre, les archives B2B historiques, le profil distant vide/incohérent, les identifiants 64 bits, les lectures sans POST parallèle, la transaction absente/dupliquée, l’extraction erronée et les retours liés à une autre entreprise.

Comparaison SQLite avec la sauvegarde privée prise avant les essais : entreprises, établissements, gîtes, réservations, contrats, factures, séquences/compteurs, dépenses, transmissions/paiements/événements métier, achats entrants et synchronisations entrantes identiques. Seuls les journaux privés et les écritures normales OAuth/audit de vérification sont attendus dans ce périmètre. Contrôle SQLite positif ; `/api/health` local sain. Aucun fichier d’environnement, worker, flux ordinaire ou production activé. Aucun déploiement.

PDF natif témoin (pas Factur-X) : `output/pdf/atelier-superpdp-b2c-natif-20261018.pdf`, une page inspectée. Capture finale : `server/data/superpdp-recette/web-v1/atelier-b2c-20261018.png`. Preuves et sauvegarde privées hors Git. L’atelier est laissé non activé, les deux essais sont en lecture seule et sans possibilité de dépôt.

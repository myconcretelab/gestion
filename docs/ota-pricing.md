# Prix saisis en brut ou en net propriétaire

Dans **Paramètres → Règlements des réservations → Canaux et commissions**, chaque OTA possède :

- ses taux datés et leur date de référence ;
- un arrondi au centime ou à l’euro le plus proche ;
- une commission portant sur l’hébergement seul ou sur l’hébergement et les options.

Pour les relevés Gîtes de France fournis : taux de 10 %, arrondi à l’euro, hébergement uniquement. Aucun taux ni changement de date d’effet n’est imposé automatiquement aux données existantes.

Dans le détail des règlements d’une réservation de plateforme, **Saisir un prix brut ou un net propriétaire** permet de choisir :

1. **Prix de location, hors options** : saisir par exemple 1 750 € et sélectionner 120 € de ménage et 135 € de draps inclus.
2. **Total brut, options incluses** : saisir 2 005 € avec les mêmes options.
3. **Net propriétaire, options incluses** : saisir 1 830 € avec les mêmes options.

Les trois saisies donnent 1 750 € d’hébergement, 255 € d’options, 175 € de commission et 1 830 € nets. Tous les montants de cette saisie sont hors taxe de séjour et caution. Le collecteur de la taxe est conservé ; le réglage « prix taxe comprise » est désactivé pour cette saisie explicitement hors taxe.

Activer d’abord les prestations dans les options du séjour. Dans le formulaire des montants, cocher celles qui sont comprises dans le versement de la plateforme et renseigner leur **valeur totale réelle**. Une option incluse reste une prestation payée : elle ne devient pas offerte et n’est pas ajoutée une seconde fois. Les autres suppléments restent à encaisser. Les options incluses apparaissent également comme telles dans les détails, SMS, contrats et factures.

La commission réelle du relevé peut être saisie, y compris zéro, et prime sur le taux. Si aucun taux daté ne s’applique, elle est nécessaire. Un net arrondi n’a pas toujours un prix brut unique : par exemple, à 10 % arrondis à l’euro, 4,50 € et 5,50 € bruts peuvent tous deux donner 4,50 € nets. Le formulaire demande alors une commission réelle ou une saisie brute au lieu de choisir un montant arbitraire.

Le serveur recalcule et valide les montants. Il conserve le prix brut comprenant les options dans le séjour et la saisie initiale dans les options JSON, avec les valeurs incluses et la règle utilisée. Les rapports distinguent l’hébergement, le ménage, le linge et les autres prestations, en brut comme en net, sans changer leurs anciennes copies confirmées. Les séjours groupés conservent les centimes de chaque réservation. Une modification des tarifs du logement ou des règles OTA ne réécrit pas ces montants enregistrés. Une modification incompatible du prix ou de l’origine de la réservation rend le calcul à vérifier.

Cette saisie concerne la préparation des montants d’un séjour sans règlement ni document déjà enregistré. Elle ne crée pas de règlement bancaire constaté ; la date du versement automatique reste estimée. Si des règlements ou documents existent déjà, le formulaire les protège et invite à corriger les données dans leur parcours habituel. Les imports de relevés et leurs montants exacts restent prioritaires.

Le stockage utilise les champs JSON existants ; aucune migration de base n’est nécessaire. La version du cache des rapports est incrémentée pour reconstruire les données dérivées avec les nouvelles ventilations.

Validation : `npm test`, `npm run build` et `npm run test:ota-pricing-browser -w client`.

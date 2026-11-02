# Prix saisis en brut ou en net propriétaire

Dans **Paramètres → Règlements des réservations → Canaux et commissions**, chaque OTA possède ses taux datés, leur date de référence, un arrondi au centime ou à l’euro le plus proche et une commission portant sur l’hébergement seul ou sur l’hébergement et les options. Le sens du brut indiqué par la plateforme est également configurable : prix de location hors options pour Gîtes de France, total brut options comprises pour Airbnb par défaut.

Les relevés fournis correspondent aux règles suivantes :

- **Gîtes de France** : 10 %, commission arrondie à l’euro, hébergement uniquement ;
- **Airbnb** : 15,5 %, commission arrondie au centime, hébergement et options. 820 € bruts donnent 127,10 € de commission et 692,90 € nets. Les 12,80 € de taxe de séjour figurant sur le relevé voyageur restent séparés.

Aucun taux ni date d’effet n’est imposé automatiquement aux réglages existants.

Dans le détail des règlements d’une réservation de plateforme, **Saisir un prix brut ou un net propriétaire** présente deux choix : **Brut** et **Net propriétaire**. Un seul montant est obligatoire. Cocher ensuite les options comprises dans le versement : leurs tarifs proviennent de l’application, avec la quantité existante ou une quantité initiale de un. Les quantités de lits, de personnes ou d’animaux peuvent être ajustées ; le tarif des animaux tient compte du nombre de nuits. Il est possible de cocher une prestation directement dans ce formulaire, sans l’activer au préalable ailleurs.

Pour Gîtes de France, saisir 1 750 € en brut (la ligne « Prix location ») ou 1 830 € en net et cocher 120 € de ménage et neuf lits à 15 €. Les deux saisies donnent 1 750 € d’hébergement, 255 € d’options, 175 € de commission et 1 830 € nets.

Airbnb propose **Net propriétaire** dès l’ouverture. Pour les réservations Pump, le montant importé est déjà le versement net : il est repris automatiquement, y compris si le réglage général du canal indiquait une autre base. Après enregistrement d’un calcul explicite, la saisie et le suivi réutilisent le calcul enregistré. Un brut existant dont la base est connue peut être converti en net ; si sa base est inconnue, le formulaire demande le net sans le deviner. Pour Airbnb, les options cochées sont comprises dans les 820 € bruts ou les 692,90 € nets : elles ne sont pas ajoutées au total.

Tous les montants saisis sont hors taxe de séjour et caution. Le collecteur de la taxe est conservé ; le réglage « prix taxe comprise » est désactivé pour cette saisie explicitement hors taxe. Une option incluse reste payée et ne devient pas offerte. Les anciens suppléments sélectionnés sont retirés du restant dû sans doubler les options ; les autres restent à encaisser. Les options incluses apparaissent dans les détails, SMS, contrats et factures.

La section facultative **Précision sur la commission** permet de saisir la commission réelle du relevé, y compris zéro, qui prime sur le taux. Elle s’ouvre si aucun taux daté ne s’applique ou si un net arrondi ne détermine pas un brut unique. Par exemple, à 10 % arrondis à l’euro, 4,50 € et 5,50 € bruts peuvent tous deux donner 4,50 € nets. Une commission réelle ou une saisie brute est alors nécessaire.

Le serveur valide les tarifs, les quantités et la révision avant d’enregistrer. Il conserve le brut comprenant les options dans le séjour, et la saisie initiale, les montants inclus et la règle dans les options JSON. Les rapports ventilent hébergement et prestations en brut comme en net, sans changer les copies déjà confirmées. Les séjours groupés conservent les centimes de chaque réservation. Les changements ultérieurs de tarifs ou de règles ne réécrivent pas un calcul enregistré. Une modification incompatible du prix ou de l’origine du séjour rend le calcul à vérifier.

Cette saisie prépare les montants d’un séjour sans règlement ni document déjà enregistré. Elle ne crée pas de règlement bancaire constaté ; la date du versement automatique reste estimée. Les règlements et documents existants sont protégés. Les imports de relevés et leurs montants exacts restent prioritaires.

## Copier un montant pour une déclaration

Le total d’un rapport monétaire propose **Copier sans centimes**. Le bouton copie uniquement un nombre entier sans espace ni symbole : 3 364,37 € donne `3364`, 3 364,50 € donne `3365`. L’arrondi se fait à l’euro le plus proche. Le montant copié est celui du total affiché, y compris dans une copie confirmée ou un rapport contenant encore des commissions non renseignées. Le rapport et ses avertissements restent inchangés. La copie est disponible en lecture seule si les montants sont visibles ; un échec d’accès au presse-papiers est signalé.

Le stockage utilise les champs JSON existants ; aucune migration n’est nécessaire. La version du cache des rapports est incrémentée pour reconstruire les données dérivées.

Validation : `npm test`, `npm run build`, `npm run test:ota-pricing-browser -w client` et `npm run test:reports-browser -w client`.

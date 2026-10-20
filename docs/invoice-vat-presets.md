# Préréglage de TVA des factures à un particulier

Vérification des sources officielles : 20 octobre 2026.

Le statut de particulier ne détermine ni l’exonération ni le taux de TVA. La
location meublée d’habitation est en principe exonérée au titre de l’article
261 D, 4° du CGI, mais des exceptions existent notamment pour les prestations
hôtelières et para-hôtelières. La franchise en base constitue un régime distinct.

## Comportement du formulaire

Le préréglage utilise le régime et le pays de l’entreprise fiscale effectivement
rattachée au gîte sélectionné, renvoyés par la préparation de la facture.

| Situation enregistrée | Préréglage des lignes encore vierges |
| --- | --- |
| Particulier, entreprise française en franchise en base | E, sans TVA, mention « TVA non applicable, article 293 B du CGI » |
| Particulier, entreprise française déclarée exonérée | E, sans TVA ; référence juridique à compléter pour chaque prestation |
| Régime réel, inconnu, hors champ, entreprise étrangère ou informations absentes | Aucun choix automatique |
| Plusieurs séjours regroupés | Vérification par réservation et prestation ; aucun choix automatique |

Le formulaire ne décide pas de l’éligibilité à la franchise et n’infère pas
l’exonération de l’hébergement à partir du seul mot « gîte ». Il n’invente aucun
taux pour un régime réel et ne renseigne pas l’article 261 D sur des prestations
annexes dont le traitement n’est pas établi.

Les choix saisis ou enregistrés sont conservés. Les suggestions créées pendant
la saisie sont retirées si le gîte ou son régime change ; une modification
manuelle n’est pas remplacée. Le total TTC reste inchangé et la vérification
finale de la facture reste nécessaire. Les règles d’émission côté serveur
restent applicables.

## Sources

- [Impôts : prestations aux non-assujettis](https://www.impots.gouv.fr/professionnel/prestations-aux-non-assujettis)
- [BOFiP : hébergement et locations meublées, § 1 et suivants](https://bofip.impots.gouv.fr/bofip/124-PGP.html/identifiant=BOI-TVA-CHAMP-10-10-50-20-20250326)
- [BOFiP : conséquences de la franchise en base, § 50-60](https://bofip.impots.gouv.fr/bofip/1079-PGP.html/identifiant=BOI-TVA-DECLA-40-10-20-20260701)

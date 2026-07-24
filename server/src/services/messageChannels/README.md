# Modes d'envoi de messages

Tous les envois applicatifs passent par `sendMessage`, exporté par `index.ts`.
Chaque mode implémente le contrat `MessageChannel` dans son propre fichier.

Pour ajouter un mode :

1. créer `nouveauMode.ts` et y exporter un `MessageChannel` ;
2. l'ajouter au tableau `channels` de `index.ts` ;
3. fournir ses réglages dans `request.options` si le transport en a besoin.

Le registre expose aussi `listMessageChannels` pour construire à terme un
sélecteur dans l'interface, et `getMessageChannelAvailability` pour ne proposer
que les modes correctement configurés.

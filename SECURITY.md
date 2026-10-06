# Sécurité

Signalez une vulnérabilité en privé au mainteneur de l'installation. N'ouvrez pas de ticket public contenant un secret, des données personnelles ou une méthode d'exploitation complète.

Incluez la version, l'impact, les préconditions et une reproduction minimale. Le mainteneur accuse réception, qualifie la gravité et coordonne un correctif avant publication.

Les secrets doivent rester hors de Git. Une installation de production utilise PostgreSQL, HTTPS, des sauvegardes chiffrées, des comptes individuels et uniquement les modules nécessaires. Après une fuite, révoquez les jetons et sessions avant toute purge d'historique.

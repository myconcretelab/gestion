# Contribuer

Utilisez Node.js 22.12+, installez avec `npm ci --include=optional` et créez une base locale dédiée. N'utilisez jamais un export client réel comme fixture.

Avant une proposition :

```bash
npm run typecheck
npm run test
npm run build
npm audit --omit=dev
```

Ajoutez une migration SQLite et PostgreSQL pour chaque évolution de schéma. Les nouvelles intégrations doivent être facultatives, désactivées par défaut, protégées par une permission métier et testées sans secrets réels.

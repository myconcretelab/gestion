import fs from "node:fs";
import path from "node:path";

const routesDir = path.resolve(process.cwd(), "src/routes");
const allowedLegacyRoutes = new Set([
  "booked.ts", "bookingRequests.ts", "contracts.ts", "documentShares.ts", "gites.ts", "guestNightDeclarations.ts",
  "installation.ts", "intervenantHours.ts", "intervenants.ts", "invoices.ts", "managers.ts", "personalExpenses.ts",
  "planningRelayPeriods.ts", "productSettings.ts", "professionalExpenses.ts", "publicCleaningCheck.ts", "publicGites.ts",
  "reservations.ts", "settings.ts", "statistics.ts", "today.ts", "urssafDeclarations.ts", "userInterventions.ts", "users.ts",
]);
const files = fs.readdirSync(routesDir).filter((name) => name.endsWith(".ts"));
const directImports = files.filter((name) => /from\s+["'][^"']*db\/prisma\.js["']/.test(fs.readFileSync(path.join(routesDir, name), "utf8")));
const directCalls = files.reduce((total, name) => {
  const source = fs.readFileSync(path.join(routesDir, name), "utf8");
  return total + (source.match(/\bprisma\.[A-Za-z_]+/g)?.length ?? 0);
}, 0);
const newViolations = directImports.filter((name) => !allowedLegacyRoutes.has(name));
if (newViolations.length) {
  console.error(`Nouveaux accès Prisma directs interdits dans les routes: ${newViolations.join(", ")}`);
  process.exit(1);
}
if (directCalls > 384) {
  console.error(`Le nombre d'accès Prisma directs dans les routes a augmenté: ${directCalls} (plafond: 384).`);
  process.exit(1);
}
console.log(`Architecture: ${directImports.length} routes et ${directCalls} appels Prisma directs historiques (plafonds: ${allowedLegacyRoutes.size}/384).`);

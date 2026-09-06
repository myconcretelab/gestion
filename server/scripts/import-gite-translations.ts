import fs from "node:fs/promises";
import { z } from "zod";
import prisma from "../src/db/prisma.js";
import { giteTranslationsSchema } from "../src/services/giteTranslations.js";
import { encodeJsonField, fromJsonString } from "../src/utils/jsonFields.js";

const filename = process.argv.find((value, index) => index > 1 && !value.startsWith("--"));
const apply = process.argv.includes("--apply");
if (!filename) throw new Error("Usage: tsx scripts/import-gite-translations.ts file.json [--apply]");
try {
  const rows = z.array(z.object({
    id: z.string().min(1), source_updated_at: z.string().datetime(),
    public_translations: giteTranslationsSchema,
  }).strict()).min(1).parse(JSON.parse(await fs.readFile(filename, "utf8")));
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Identifiant de gîte dupliqué.");
  await prisma.$transaction(async tx => {
    for (const row of rows) {
      if (!row.public_translations?.en || !row.public_translations?.es) throw new Error("Traductions EN et ES requises.");
      const gite = await tx.gite.findUniqueOrThrow({where: {id: row.id}});
      if (gite.updatedAt.toISOString() !== row.source_updated_at) throw new Error(`Le contenu source de ${gite.nom} a changé ; refaire la traduction.`);
      const existing = fromJsonString<Record<string, unknown>>(gite.public_translations, {}) ?? {};
      if (Object.keys(existing).length) throw new Error(`Des traductions existent déjà pour ${gite.nom} ; utiliser l’éditeur.`);
      if (apply) {
        const result = await tx.gite.updateMany({where: {id: row.id, updatedAt: gite.updatedAt}, data: {
          public_translations: encodeJsonField(row.public_translations),
        }});
        if (result.count !== 1) throw new Error(`Modification concurrente de ${gite.nom}.`);
      }
      console.log(`${apply ? "Importé" : "Validé"} : ${gite.nom} (EN, ES)`);
    }
  });
} finally {
  await prisma.$disconnect();
}

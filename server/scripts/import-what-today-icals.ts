import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import prisma from "../src/db/prisma.js";

type WhatTodaySource = {
  url: string;
  type: string;
  includeSummary?: string | string[];
  excludeSummary?: string | string[];
};

type WhatTodayGite = {
  id: string;
  nom: string;
  sources: WhatTodaySource[];
};

const normalizeTextKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const includesAny = (text: string, needles: string[]) => {
  const normalized = normalizeTextKey(text);
  return needles.some((needle) => normalized.includes(normalizeTextKey(needle)));
};

const toSummaryFilterText = (value: string | string[] | undefined) => {
  if (!value) return null;
  if (Array.isArray(value)) {
    const parts = value.map((item) => String(item).trim()).filter(Boolean);
    return parts.length > 0 ? parts.join(", ") : null;
  }
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
};

const resolveWhatTodayConfigPath = () => {
  const fromRepoRoot = path.resolve(process.cwd(), "..", "what-today", "backend", "config.js");
  const fromServerDir = path.resolve(process.cwd(), "..", "..", "what-today", "backend", "config.js");
  const candidates = [fromRepoRoot, fromServerDir];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Fichier introuvable: ${candidates.join(" ou ")}`);
  }
  return found;
};

const inferGiteMatch = (whatGite: WhatTodayGite, currentGites: Array<{ id: string; nom: string; prefixe_contrat: string }>) => {
  const whatId = normalizeTextKey(whatGite.id);

  const matchers: Record<string, string[]> = {
    phonsine: ["phonsine", "pho"],
    liberte: ["liberte", "liberte", "lib"],
    gree: ["gree", "gree", "gree", "gre", "la gree"],
    edmond: ["edmond", "edm"],
  };

  const hints = matchers[whatId] ?? [whatId];

  const exact = currentGites.find((gite) => includesAny(gite.nom, hints));
  if (exact) return exact;

  const byPrefix = currentGites.find((gite) => includesAny(gite.prefixe_contrat, hints));
  if (byPrefix) return byPrefix;

  return null;
};

const run = async () => {
  const configPath = resolveWhatTodayConfigPath();
  const configModule = await import(pathToFileURL(configPath).href);
  const sourceGites = Array.isArray(configModule.GITES) ? (configModule.GITES as WhatTodayGite[]) : [];

  if (sourceGites.length === 0) {
    throw new Error(`Aucun gîte trouvé dans ${configPath}`);
  }

  const dbGites = await prisma.gite.findMany({
    select: {
      id: true,
      nom: true,
      prefixe_contrat: true,
    },
    orderBy: [{ ordre: "asc" }, { nom: "asc" }],
  });

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const whatGite of sourceGites) {
    const matched = inferGiteMatch(whatGite, dbGites);
    if (!matched) {
      skipped += whatGite.sources.length;
      console.log(`Skipping ${whatGite.id}: aucun gîte correspondant dans la DB.`);
      continue;
    }

    let ordre = 0;
    for (const source of whatGite.sources ?? []) {
      const url = String(source.url ?? "").trim();
      const type = String(source.type ?? "").trim();
      if (!url || !type) {
        skipped += 1;
        continue;
      }

      const include_summary = toSummaryFilterText(source.includeSummary);
      const exclude_summary = toSummaryFilterText(source.excludeSummary);

      const existing = await prisma.icalSource.findFirst({
        where: {
          gite_id: matched.id,
          url,
        },
        select: { id: true },
      });

      if (existing) {
        await prisma.icalSource.update({
          where: { id: existing.id },
          data: {
            type,
            include_summary,
            exclude_summary,
            is_active: true,
            ordre,
          },
        });
        updated += 1;
      } else {
        await prisma.icalSource.create({
          data: {
            gite_id: matched.id,
            type,
            url,
            include_summary,
            exclude_summary,
            is_active: true,
            ordre,
          },
        });
        created += 1;
      }

      ordre += 1;
    }

    console.log(`Imported sources for ${whatGite.id} -> ${matched.nom}`);
  }

  console.log(`Done. created=${created}, updated=${updated}, skipped=${skipped}`);
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

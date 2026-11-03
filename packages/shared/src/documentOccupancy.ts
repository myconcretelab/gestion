export type DocumentOccupancyGite = {
  capacite_max: number;
  nb_adultes_max: number;
  nb_enfants_max?: number | null;
};

export type DocumentOccupancyField = "nb_adultes" | "nb_enfants_2_17";

const toSafeInt = (value: unknown, fallback: number) => {
  const normalized = Math.trunc(Number(value));
  return Number.isFinite(normalized) ? normalized : fallback;
};

export function getDocumentOccupancyLimits(
  gite: DocumentOccupancyGite,
  nbAdultes = 0,
) {
  const capaciteMax = Math.max(1, toSafeInt(gite.capacite_max, 1));
  const maxAdults = Math.min(
    capaciteMax,
    Math.max(1, toSafeInt(gite.nb_adultes_max, capaciteMax)),
  );
  const fallbackChildren = Math.max(0, capaciteMax - maxAdults);
  const configuredMaxChildren = Math.max(
    0,
    toSafeInt(gite.nb_enfants_max ?? fallbackChildren, fallbackChildren),
  );
  const remainingCapacity = Math.max(
    0,
    capaciteMax - Math.max(0, toSafeInt(nbAdultes, 0)),
  );
  return {
    capaciteMax,
    maxAdults,
    configuredMaxChildren,
    maxChildren: Math.min(configuredMaxChildren, remainingCapacity),
  };
}

export function documentOccupancyIssues(params: {
  gite: DocumentOccupancyGite;
  nbAdultes: number;
  nbEnfants: number;
}): { field: DocumentOccupancyField; message: string }[] {
  const limits = getDocumentOccupancyLimits(params.gite, params.nbAdultes);
  const issues: { field: DocumentOccupancyField; message: string }[] = [];
  if (params.nbAdultes > limits.maxAdults)
    issues.push({
      field: "nb_adultes",
      message: `Le nombre d'adultes ne peut pas dépasser ${limits.maxAdults} pour ce gîte.`,
    });
  if (params.nbEnfants > limits.maxChildren)
    issues.push({
      field: "nb_enfants_2_17",
      message:
        limits.configuredMaxChildren === 0
          ? "Aucun enfant n'est configuré pour ce gîte."
          : limits.maxChildren < limits.configuredMaxChildren
            ? `Avec ${params.nbAdultes} adulte(s), le nombre d'enfants ne peut pas dépasser ${limits.maxChildren} pour ce gîte.`
            : `Le nombre d'enfants ne peut pas dépasser ${limits.configuredMaxChildren} pour ce gîte.`,
    });
  return issues;
}

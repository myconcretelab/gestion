type GiteLike = {
  id?: string;
  nom?: string;
  prefixe_contrat?: string;
};

export const GITE_COLOR_PALETTE = ["#2D8CFF", "#43B77D", "#F5A623", "#7E5BEF", "#FE5C73"] as const;

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

const KNOWN_NAME_COLORS: Record<string, string> = {
  phonsine: GITE_COLOR_PALETTE[0],
  gree: GITE_COLOR_PALETTE[1],
  edmond: GITE_COLOR_PALETTE[2],
  liberte: GITE_COLOR_PALETTE[3],
};

export const getGiteColor = (gite: GiteLike | null | undefined, fallbackIndex = 0) => {
  if (!gite) return GITE_COLOR_PALETTE[fallbackIndex % GITE_COLOR_PALETTE.length];

  const candidates = [gite.nom ?? "", gite.prefixe_contrat ?? ""].map(normalize).filter(Boolean);
  for (const candidate of candidates) {
    for (const [key, color] of Object.entries(KNOWN_NAME_COLORS)) {
      if (candidate.includes(key)) return color;
    }
  }

  if (typeof gite.id === "string" && gite.id.length > 0) {
    const hash = [...gite.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return GITE_COLOR_PALETTE[hash % GITE_COLOR_PALETTE.length];
  }

  return GITE_COLOR_PALETTE[fallbackIndex % GITE_COLOR_PALETTE.length];
};

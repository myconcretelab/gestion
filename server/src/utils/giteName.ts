type GiteNameSource = {
  nom?: string | null;
  nom_avec_preposition?: string | null;
};

export const buildGiteNameWithPreposition = (gite?: GiteNameSource | null) => {
  const customValue = String(gite?.nom_avec_preposition ?? "").trim();
  if (customValue) return customValue;

  const name = String(gite?.nom ?? "").trim();
  if (!name) return "";

  const articleMatch = name.match(/^(les|le|la|l['’])\s*(.+)$/i);
  if (!articleMatch) return `de ${name}`;

  const [, article, remainder] = articleMatch;
  if (/^le$/i.test(article)) return `du ${remainder}`;
  if (/^les$/i.test(article)) return `des ${remainder}`;
  if (/^la$/i.test(article)) return `de la ${remainder}`;
  return `de l’${remainder}`;
};

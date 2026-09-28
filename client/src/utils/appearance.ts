export const APPEARANCE_KEY = "contrats:appearance:v1";
export const TEMPLATES = [
  { id: "classic", name: "Classique", description: "Clair, épuré et familier. L’apparence originale de votre espace." },
  { id: "retro", name: "Atelier rétro", description: "Bois chaleureux, cuivre brossé et commandes inspirées des amplis vintage." },
  { id: "midnight", name: "Minuit", description: "Bleu nuit profond, surfaces perle et accents bleus pour une ambiance feutrée." },
  { id: "garden", name: "Jardin", description: "Vert sauge, ivoire et lignes douces pour un espace naturellement apaisant." },
] as const;
export type Appearance = { template: (typeof TEMPLATES)[number]["id"]; wood: number; copper: number };
export const DEFAULT_APPEARANCE: Appearance = { template: "classic", wood: 70, copper: 60 };
export function normalizeAppearance(value: unknown): Appearance {
  const data = (value && typeof value === "object" ? value : {}) as Partial<Appearance>;
  const level = (value: unknown, fallback: number) => typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : fallback;
  return { template: TEMPLATES.some(template => template.id === data.template) ? data.template! : "classic", wood: level(data.wood, 70), copper: level(data.copper, 60) };
}
export function readAppearance(): Appearance {
  try { return normalizeAppearance(JSON.parse(localStorage.getItem(APPEARANCE_KEY) || "null")); }
  catch { return { ...DEFAULT_APPEARANCE }; }
}
export function applyAppearance(value: Appearance) {
  const root = document.documentElement;
  root.dataset.template = value.template;
  root.style.setProperty("--wood-shade", String(value.wood / 180));
  root.style.setProperty("--copper-light", `${78 - value.copper * 0.22}%`);
}
export function saveAppearance(value: Appearance): boolean {
  applyAppearance(value);
  try { localStorage.setItem(APPEARANCE_KEY, JSON.stringify(value)); return true; }
  catch { return false; }
}

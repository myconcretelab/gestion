import type { ContratOptions } from "./types";

export type ReservationOptionBadge = {
  key: "draps" | "linge_toilette" | "menage" | "depart_tardif" | "chiens";
  letter: string;
  label: string;
  color: string;
  muted?: boolean;
};

const OPTION_BADGE_DEFINITIONS = [
  { key: "draps", letter: "D", label: "Draps", color: "#2563eb" },
  { key: "linge_toilette", letter: "S", label: "Serviettes", color: "#0d9488" },
  { key: "menage", letter: "M", label: "Ménage", color: "#d97706" },
  { key: "depart_tardif", letter: "T", label: "Départ tardif", color: "#7c3aed" },
  { key: "chiens", letter: "C", label: "Chiens", color: "#db2777" },
] as const satisfies readonly ReservationOptionBadge[];

const parseOptions = (value: ContratOptions | string | null | undefined): ContratOptions => {
  if (!value) return {};
  if (typeof value !== "string") return value;

  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as ContratOptions) : {};
  } catch {
    return {};
  }
};

export const getReservationOptionBadges = (
  value: ContratOptions | string | null | undefined
): ReservationOptionBadge[] => {
  const options = parseOptions(value);
  return OPTION_BADGE_DEFINITIONS.filter(({ key }) => options[key]?.enabled).map((definition) => ({
    ...definition,
  }));
};

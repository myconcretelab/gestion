export const RESERVATION_SOURCES = [
  "Abritel",
  "Airbnb",
  "Chèque",
  "Espèces",
  "HomeExchange",
  "Virement",
  "A définir",
  "Gites de France",
] as const;

export const DEFAULT_RESERVATION_SOURCE = "A définir";

const PLATFORM_RESERVATION_SOURCES = new Set<string>([
  "Airbnb",
  "Abritel",
  "Gites de France",
  "HomeExchange",
]);

export const isPlatformReservationSource = (source: string | null | undefined) =>
  PLATFORM_RESERVATION_SOURCES.has(String(source ?? "").trim());

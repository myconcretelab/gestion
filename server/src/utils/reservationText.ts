export const normalizeReservationTextKey = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");

const COMMENT_PLACEHOLDER_KEYS = new Set([
  normalizeReservationTextKey("Reserved"),
  normalizeReservationTextKey("Airbnb (Not available)"),
]);

export const isUnknownHostName = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return true;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return true;
  }

  const normalized = normalizeReservationTextKey(trimmed);
  return normalized.length === 0 || normalized.includes("hoteinconnu") || normalized.includes("hostunknown");
};

export const normalizeImportedHostName = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed || isUnknownHostName(trimmed)) {
    return null;
  }

  return trimmed;
};

export const normalizeImportedComment = (value: unknown) => {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.replace(/\r?\n/g, " ").replace(/\s{2,}/g, " ").trim();
  if (!cleaned) {
    return null;
  }

  return COMMENT_PLACEHOLDER_KEYS.has(normalizeReservationTextKey(cleaned)) ? null : cleaned;
};

export const hasMeaningfulImportedComment = (value: unknown) => normalizeImportedComment(value) !== null;

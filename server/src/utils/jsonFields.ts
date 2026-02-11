const isSqlite = () => (process.env.DATABASE_URL ?? "").startsWith("file:");

export const encodeJsonField = (value: unknown) => {
  if (isSqlite()) return JSON.stringify(value ?? null);
  return value ?? null;
};

export const fromJsonString = <T>(value: unknown, fallback: T): T => {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "string") return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

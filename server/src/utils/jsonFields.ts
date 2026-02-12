const isSqlite = () => (process.env.DATABASE_URL ?? "").startsWith("file:");

// Return type is intentionally loose because the Prisma client schema differs between SQLite and Postgres.
export const encodeJsonField = (value: unknown): any => {
  const normalized = value ?? null;
  if (isSqlite()) return JSON.stringify(normalized);
  return normalized;
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

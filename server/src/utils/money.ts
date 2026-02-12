export type NumericLike = number | string | { toString(): string };

export const toNumber = (value: NumericLike | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number(value.toString());
};

export const round2 = (value: number): number => Math.round(value * 100) / 100;

export const formatEuro = (value: number): string =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value);

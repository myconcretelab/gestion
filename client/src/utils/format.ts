import { canCurrentUserViewAmounts } from "./auth";

export const formatEuro = (value: number | string | null | undefined, options?: Intl.NumberFormatOptions) =>
  canCurrentUserViewAmounts()
    ? new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    ...options,
      }).format(Number(value ?? 0))
    : "Montant masqué";

export const formatDate = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("fr-FR");
};

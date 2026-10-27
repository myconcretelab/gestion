type OptionKey = "draps" | "linge" | "menage" | "depart_tardif" | "chiens";
export type BookingOptionUnitPrices = Record<OptionKey, number>;

type Option = {
  enabled?: boolean;
  offert?: boolean;
  inclus?: boolean;
  nb_lits?: number;
  nb_personnes?: number;
  nb?: number;
};
type BookingOptionDetailsInput = {
  options?: {
    draps?: Option;
    linge_toilette?: Option;
    menage?: Option;
    depart_tardif?: Option;
    chiens?: Option;
  } | null;
  pricing_snapshot: {
    nb_nuits: number;
    options_detail?: Partial<Record<OptionKey, number>>;
    options_unit_prices?: Partial<BookingOptionUnitPrices>;
  };
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const money = (value: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
const plural = (quantity: number, singular: string) =>
  `${quantity} ${singular}${quantity > 1 ? "s" : ""}`;
const isAmount = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Use the saved quote, never today's gîte rates, for both the preview and the email. */
export const buildBookingRequestOptionsTemplateValues = (
  request: BookingOptionDetailsInput,
) => {
  const options = request.options;
  const snapshot = request.pricing_snapshot;
  const line = (
    label: string,
    key: OptionKey,
    option?: Option,
    quantity?: number,
    unit?: string,
  ) => {
    if (!option?.enabled) return "";
    const quantityLabel = quantity === undefined ? "" : plural(quantity, unit!);
    const nights = snapshot.nb_nuits;
    const context = [
      quantityLabel,
      key === "chiens" ? plural(nights, "nuit") : "",
    ]
      .filter(Boolean)
      .join(", ");
    if (key === "menage" && option.inclus)
      return `${label} : inclus dans le prix du séjour`;
    if (option.offert)
      return `${label} : offert${context ? ` (${context})` : ""}`;
    const amount = snapshot.options_detail?.[key];
    const fallback = `${label}${context ? ` (${context})` : ""}${isAmount(amount) ? ` : ${money(amount)}` : ""}`;
    if (!isAmount(amount)) return fallback;
    if (quantity === undefined) return `${label} : ${money(amount)} (forfait)`;
    const factor = quantity * (key === "chiens" ? nights : 1);
    if (!(factor > 0)) return fallback;
    const savedUnitPrice = snapshot.options_unit_prices?.[key];
    // Older quotes have totals only. Derive a unit price only when it reproduces
    // the recorded amount exactly to the cent; otherwise show the saved total.
    const unitPrice = isAmount(savedUnitPrice)
      ? savedUnitPrice
      : round2(amount / factor);
    if (round2(unitPrice * factor) !== round2(amount)) return fallback;
    const factors =
      key === "chiens"
        ? [quantity > 1 ? quantityLabel : "", plural(nights, "nuit")].filter(
            Boolean,
          )
        : [quantityLabel];
    return `${label} : ${money(unitPrice)} × ${factors.join(" × ")} = ${money(amount)}`;
  };
  const values = {
    optionsDraps: line(
      "Draps",
      "draps",
      options?.draps,
      options?.draps?.nb_lits ?? 0,
      "lit",
    ),
    optionsLingeToilette: line(
      "Linge de toilette",
      "linge",
      options?.linge_toilette,
      options?.linge_toilette?.nb_personnes ?? 0,
      "personne",
    ),
    optionsMenage: line("Ménage", "menage", options?.menage),
    optionsDepartTardif: line(
      "Départ tardif",
      "depart_tardif",
      options?.depart_tardif,
    ),
    optionsChiens: line(
      "Chiens",
      "chiens",
      options?.chiens,
      options?.chiens?.nb ?? 1,
      "chien",
    ),
  };
  const lines = Object.values(values).filter(Boolean);
  return {
    ...values,
    optionsSummary: lines.length
      ? `Options choisies :\n${lines.join("\n")}`
      : "",
  };
};

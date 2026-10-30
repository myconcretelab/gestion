import { z } from "zod";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return (
      Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value
    );
  }, "Date invalide.");
export const otaChannelSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    automatic: z.boolean(),
    storedPriceBasis: z.enum(["unknown", "net", "gross"]).default("unknown"),
    rateDateBasis: z.enum(["booking", "arrival", "payment"]).default("payment"),
    rates: z
      .array(
        z
          .object({
            effectiveFrom: date,
            percent: z.number().min(0).max(99.99),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
  .refine(
    (channel) =>
      new Set(channel.rates.map((rate) => rate.effectiveFrom)).size ===
      channel.rates.length,
    "Deux commissions ne peuvent pas commencer à la même date.",
  );
export type OtaChannel = z.infer<typeof otaChannelSchema>;
export function otaRate(channel: OtaChannel | undefined, day: string) {
  return channel?.rates
    .filter((rate) => rate.effectiveFrom <= day)
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
}
export type OtaSettlementAdjustment = {
  basis: "net" | "gross";
  sourceAmountCents: number;
  recordedAmountCents: number;
  adjustmentCents: number;
};
/** Only a unique one-cent rounding gap is eligible; source amounts stay exact. */
export function findOtaRoundingAdjustment(
  recordedAmountCents: number,
  grossCents: number,
  netCents: number,
): OtaSettlementAdjustment | null {
  if (
    ![recordedAmountCents, grossCents, netCents].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    recordedAmountCents === grossCents ||
    recordedAmountCents === netCents
  )
    return null;
  const candidates = (
    [
      { basis: "net", amount: netCents },
      { basis: "gross", amount: grossCents },
    ] as const
  ).filter((item) => Math.abs(recordedAmountCents - item.amount) === 1);
  if (
    !candidates.length ||
    new Set(candidates.map((item) => item.amount)).size !== 1
  )
    return null;
  const candidate = candidates[0];
  return {
    basis: candidate.basis,
    sourceAmountCents: candidate.amount,
    recordedAmountCents,
    adjustmentCents: recordedAmountCents - candidate.amount,
  };
}
export type OtaAmounts = {
  channel: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  category: "accommodation" | "cleaning" | "linen" | "extras" | "tourist_tax";
  source: "import" | "manual" | "rate";
  reference?: string;
  bookingDate?: string;
  settlementAdjustment?: OtaSettlementAdjustment;
  dateSource?: "platform" | "manual";
  effectiveRate?: { effectiveFrom: string; percent: number };
  allocations?: Array<{
    reservationId?: string;
    category: OtaAmounts["category"];
    grossCents: number;
    feeCents: number;
    netCents: number;
  }>;
};
export type AirbnbRow = {
  row: number;
  key: string;
  type: "payout" | "reservation" | "resolution";
  date: string;
  arrivalBy: string | null;
  code: string;
  payoutReference: string;
  bookingDate: string | null;
  start: string | null;
  end: string | null;
  guest: string;
  listing: string;
  details: string;
  grossCents: number;
  feeCents: number;
  netCents: number;
  cleaningCents: number;
  taxCents: number;
  raw: Record<string, string>;
};
/** RFC4180 including quoted newlines and escaped quotes. Source headers are never executed. */
export function csvRecords(text: string) {
  text = text.replace(/^\uFEFF/, "");
  const delimiter = text.slice(0, text.indexOf("\n")).includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || !cell) quoted = !quoted;
      else throw new Error("Guillemet CSV invalide.");
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("Guillemet CSV non terminé.");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  const headers =
    rows.shift()?.map((value) => value.replace(/^\uFEFF/, "").trim()) ?? [];
  if (!headers.length || new Set(headers).size !== headers.length)
    throw new Error("En-têtes CSV absents ou dupliqués.");
  return rows.map((values, index) => {
    if (values.length !== headers.length)
      throw new Error(`Ligne ${index + 2} : nombre de colonnes incorrect.`);
    return Object.fromEntries(headers.map((key, i) => [key, values[i].trim()]));
  });
}
export function parseAirbnbCsv(text: string): AirbnbRow[] {
  if (text.length > 5_000_000) throw new Error("Le fichier dépasse 5 Mo.");
  const records = csvRecords(text);
  if (!records.length || records.length > 10000)
    throw new Error("Le fichier doit contenir entre 1 et 10 000 lignes.");
  for (const column of [
    "Date",
    "Type",
    "Code de confirmation",
    "Code de référence",
    "Devise",
    "Montant",
    "Versé",
    "Frais de service",
    "Revenus bruts",
  ])
    if (!(column in records[0]))
      throw new Error(`Colonne Airbnb manquante : ${column}.`);
  const money = (value: string, row: number) => {
    const normalized = value.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".");
    if (!normalized) return 0;
    if (!/^-?\d+(\.\d{1,2})?$/.test(normalized))
      throw new Error(`Ligne ${row} : montant invalide.`);
    const result = Math.round(Number(normalized) * 100);
    if (!Number.isSafeInteger(result) || Math.abs(result) > 1_000_000_000)
      throw new Error(`Ligne ${row} : montant hors limites.`);
    return result;
  };
  const day = (value: string, row: number, required = false) => {
    if (!value && !required) return null;
    const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    const iso = match ? `${match[3]}-${match[1]}-${match[2]}` : value;
    if (!date.safeParse(iso).success)
      throw new Error(
        `Ligne ${row} : date Airbnb invalide (mois/jour/année attendu).`,
      );
    return iso;
  };
  let payout: AirbnbRow | undefined;
  const result: AirbnbRow[] = [];
  for (const [index, raw] of records.entries()) {
    const row = index + 2;
    const type =
      raw.Type === "Payout"
        ? "payout"
        : raw.Type === "Réservation" || raw.Type === "Reservation"
          ? "reservation"
          : raw.Type === "Versement de résolution"
            ? "resolution"
            : null;
    if (!type)
      throw new Error(
        `Ligne ${row} : type « ${raw.Type} » non pris en charge. Aucune ligne ne sera ignorée.`,
      );
    if (raw.Devise !== "EUR")
      throw new Error(
        `Ligne ${row} : seule la devise EUR est prise en charge.`,
      );
    const code = raw["Code de confirmation"].toUpperCase();
    const gross = money(raw["Revenus bruts"], row),
      fee =
        money(raw["Frais de service"], row) +
        money(raw["Frais de Versement sur carte bancaire"] ?? "", row);
    const net = money(type === "payout" ? raw.Versé : raw.Montant, row);
    const reference =
      type === "payout"
        ? raw["Code de référence"]
        : (payout?.payoutReference ?? "");
    if (!reference || (type !== "payout" && !/^HM[A-Z0-9]{8}$/.test(code)))
      throw new Error(
        `Ligne ${row} : référence de versement ou de réservation absente.`,
      );
    if (type !== "payout" && gross - fee !== net)
      throw new Error(
        `Ligne ${row} : le brut moins les frais ne correspond pas au net.`,
      );
    const item: AirbnbRow = {
      row,
      key: `${type}:${reference}:${code || "payout"}`,
      type,
      date: day(raw.Date, row, true)!,
      arrivalBy: day(raw["Arrivée au plus tard le"] ?? "", row),
      code,
      payoutReference: reference,
      bookingDate: day(raw["Date de réservation"] ?? "", row),
      start: day(raw["Date de début"] ?? "", row, type === "reservation"),
      end: day(raw["Date de fin"] ?? "", row, type === "reservation"),
      guest: raw.Voyageur ?? "",
      listing: raw.Logement ?? "",
      details: raw.Détails ?? "",
      grossCents: gross,
      feeCents: fee,
      netCents: net,
      cleaningCents: money(raw["Frais de ménage"] ?? "", row),
      taxCents: money(raw["Taxes reversées par Airbnb"] ?? "", row),
      raw,
    };
    if (item.cleaningCents < 0 || item.cleaningCents > Math.max(0, gross))
      throw new Error(`Ligne ${row} : frais de ménage incohérents.`);
    if (type === "payout") payout = item;
    else if (payout?.date !== item.date)
      throw new Error(`Ligne ${row} : date différente du versement associé.`);
    result.push(item);
  }
  if (new Set(result.map((row) => row.key)).size !== result.length)
    throw new Error("Des références sont dupliquées dans ce fichier.");
  for (const payout of result.filter((row) => row.type === "payout")) {
    const details = result.filter(
      (row) =>
        row.type !== "payout" && row.payoutReference === payout.payoutReference,
    );
    if (
      !details.length ||
      details.reduce((sum, row) => sum + row.netCents, 0) !== payout.netCents
    )
      throw new Error(
        `Versement ligne ${payout.row} : son détail ne correspond pas au total. Exportez les transactions complètes.`,
      );
  }
  return result;
}
export type OtaImportChoice = {
  key: string;
  reservationId: string;
  settlementBasis?: "net" | "gross" | "reservation";
  regularizeOneCent?: boolean;
  category?: OtaAmounts["category"];
  paymentId?: string;
};
export type OtaImportPreview = {
  fingerprint: string;
  rows: Array<
    Omit<AirbnbRow, "raw"> & {
      reservationId: string | null;
      reservationLabel: string;
      existingAmountCents: number | null;
      suggestedBasis: "net" | "gross" | null;
      roundingAdjustment?: OtaSettlementAdjustment | null;
      status: "new" | "imported" | "conflict";
      warning: string | null;
    }
  >;
  reservations: Array<{
    id: string;
    label: string;
    amountCents?: number;
    payments?: Array<{ id: string; label: string }>;
  }>;
  totals: {
    grossCents: number;
    feeCents: number;
    netCents: number;
    payouts: number;
    reservations: number;
    resolutions: number;
  };
};

/** Largest remainders: allocations always conserve every cent, including tiny receipts. */
export function allocateCents(total: number, weights: number[]) {
  const weight = weights.reduce((total, n) => total + n, 0);
  if (!weight) return weights.map(() => 0);
  const shares = weights.map((n) => Math.floor((total * n) / weight));
  const order = weights
    .map((n, i) => ({ i, rest: (total * n) % weight }))
    .sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (
    let left = total - shares.reduce((sum, n) => sum + n, 0), i = 0;
    left > 0;
    left--, i++
  )
    shares[order[i % order.length].i]++;
  return shares;
}

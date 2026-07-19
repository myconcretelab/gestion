const DAY_MS = 24 * 60 * 60 * 1000;

type WorkbookCell = unknown;

export type LegacyRevenueWorkbookSheet = {
  sheet: string;
  data: WorkbookCell[][];
};

export type LegacyRevenueSheetConfig = {
  sheetName: string;
  giteName: string;
};

export type LegacyRevenueRecord = {
  sheetName: string;
  rowNumber: number;
  giteName: string;
  originReference: string;
  guestName: string;
  arrival: Date;
  departure: Date;
  nights: number;
  adults: number;
  nightlyPrice: number;
  revenue: number;
  paymentSource: string;
};

export type LegacyRevenueParseResult = {
  records: LegacyRevenueRecord[];
  warnings: string[];
  skippedRows: number;
};

export const LEGACY_REVENUE_2020_SHEETS: LegacyRevenueSheetConfig[] = [
  { sheetName: "Gree2020", giteName: "La Grée" },
  { sheetName: "Phonsine2020", giteName: "Tante Phonsine" },
  { sheetName: "Edmond2020", giteName: "Edmond" },
];

const round2 = (value: number) => Math.round(value * 100) / 100;

const toUtcDateOnly = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const addUtcDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

const formatDate = (date: Date) => date.toISOString().slice(0, 10);

const normalizeText = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");

const toNumber = (value: WorkbookCell) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const parsed = Number(value.trim().replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const toDate = (value: WorkbookCell) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return toUtcDateOnly(value);
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * DAY_MS);
  }

  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (isoMatch) {
    const date = new Date(`${trimmed}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && formatDate(date) === trimmed ? date : null;
  }

  const frenchMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!frenchMatch) return null;
  const [, day, month, year] = frenchMatch;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date;
};

const normalizePaymentSource = (value: WorkbookCell) => {
  const label = String(value ?? "").trim();
  if (!label) return "A définir";
  const normalized = normalizeText(label).replace(/\s+/g, "");
  if (normalized === "homeexchange") return "HomeExchange";
  if (normalized === "cheque") return "Chèque";
  if (normalized === "especes") return "Espèces";
  return label;
};

const validateHeaders = (sheet: LegacyRevenueWorkbookSheet) => {
  const headers = sheet.data[0] ?? [];
  const expected = ["debut", "fin", "nb nuits", "nb adultes", "prix/nuits", "revenus", "paiement"];
  const actual = [headers[1], headers[2], headers[4], headers[5], headers[6], headers[7], headers[8]].map((value) =>
    normalizeText(String(value ?? ""))
  );

  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      throw new Error(
        `La feuille ${sheet.sheet} n'a pas le format attendu (colonne ${index + 1}: "${actual[index]}").`
      );
    }
  }
};

const findOverlaps = (records: LegacyRevenueRecord[]) => {
  const warnings: string[] = [];
  const byGite = new Map<string, LegacyRevenueRecord[]>();
  for (const record of records) {
    const current = byGite.get(record.giteName) ?? [];
    current.push(record);
    byGite.set(record.giteName, current);
  }

  for (const giteRecords of byGite.values()) {
    const ordered = [...giteRecords].sort(
      (left, right) => left.arrival.getTime() - right.arrival.getTime() || left.departure.getTime() - right.departure.getTime()
    );
    for (let index = 0; index < ordered.length; index += 1) {
      for (let nextIndex = index + 1; nextIndex < ordered.length; nextIndex += 1) {
        const current = ordered[index];
        const next = ordered[nextIndex];
        if (next.arrival.getTime() >= current.departure.getTime()) break;
        warnings.push(
          `${current.giteName}: chevauchement entre ${current.sheetName} ligne ${current.rowNumber} et ` +
            `${next.sheetName} ligne ${next.rowNumber} (${formatDate(next.arrival)}).`
        );
      }
    }
  }

  return warnings;
};

export const parseLegacyRevenue2020Sheets = (
  sheets: LegacyRevenueWorkbookSheet[],
  configs: LegacyRevenueSheetConfig[] = LEGACY_REVENUE_2020_SHEETS
): LegacyRevenueParseResult => {
  const records: LegacyRevenueRecord[] = [];
  const warnings: string[] = [];
  let skippedRows = 0;
  const sheetsByName = new Map(sheets.map((sheet) => [sheet.sheet, sheet]));

  for (const config of configs) {
    const sheet = sheetsByName.get(config.sheetName);
    if (!sheet) {
      throw new Error(`Feuille requise introuvable: ${config.sheetName}.`);
    }
    validateHeaders(sheet);

    sheet.data.slice(1).forEach((row, rowIndex) => {
      const rowNumber = rowIndex + 2;
      const arrival = toDate(row[1]);
      const sourceDeparture = toDate(row[2]);
      const nightsValue = toNumber(row[4]);
      const hasStayData = arrival !== null || sourceDeparture !== null || nightsValue !== null;
      if (!hasStayData) return;

      const nights = nightsValue === null ? 0 : Math.trunc(nightsValue);
      if (!arrival || !sourceDeparture) {
        warnings.push(`${config.sheetName} ligne ${rowNumber}: dates absentes ou invalides, ligne ignorée.`);
        skippedRows += 1;
        return;
      }
      if (nights <= 0) {
        warnings.push(`${config.sheetName} ligne ${rowNumber}: nombre de nuits nul, ligne ignorée.`);
        skippedRows += 1;
        return;
      }
      if (arrival.getUTCFullYear() !== 2020) {
        throw new Error(
          `${config.sheetName} ligne ${rowNumber}: arrivée hors de 2020 (${formatDate(arrival)}).`
        );
      }

      const departure = addUtcDays(arrival, nights);
      if (sourceDeparture.getTime() !== departure.getTime()) {
        warnings.push(
          `${config.sheetName} ligne ${rowNumber}: sortie ${formatDate(sourceDeparture)} remplacée par ` +
            `${formatDate(departure)} pour respecter ${nights} nuit(s).`
        );
      }

      const sourceNightlyPrice = toNumber(row[6]) ?? 0;
      const revenue = round2(toNumber(row[7]) ?? sourceNightlyPrice * nights);
      const nightlyPrice = round2(nights > 0 ? revenue / nights : sourceNightlyPrice);
      if (Math.abs(round2(sourceNightlyPrice * nights) - revenue) > 0.01) {
        warnings.push(
          `${config.sheetName} ligne ${rowNumber}: prix/nuit recalculé à ${nightlyPrice.toFixed(2)} € ` +
            `pour préserver le revenu de ${revenue.toFixed(2)} €.`
        );
      }

      records.push({
        sheetName: config.sheetName,
        rowNumber,
        giteName: config.giteName,
        originReference: `revenus-2020:${config.sheetName}:${rowNumber}`,
        guestName: String(row[0] ?? "").trim() || "Hôte non renseigné",
        arrival,
        departure,
        nights,
        adults: Math.max(0, Math.trunc(toNumber(row[5]) ?? 0)),
        nightlyPrice,
        revenue,
        paymentSource: normalizePaymentSource(row[8]),
      });
    });
  }

  warnings.push(...findOverlaps(records));
  return { records, warnings, skippedRows };
};

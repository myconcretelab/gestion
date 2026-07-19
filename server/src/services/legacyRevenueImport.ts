import { readSheet } from "read-excel-file/node";

const DAY_MS = 24 * 60 * 60 * 1000;

type WorkbookCell = unknown;
type WorkbookInput = string | Buffer;

export type LegacyRevenueWorkbookSheet = {
  sheet: string;
  data: WorkbookCell[][];
};

export type LegacyRevenueSheetConfig = {
  sheetName: string;
  giteName: string;
  allowBlankDateHeaders?: boolean;
  columns: {
    guest: number;
    arrival: number;
    departure: number;
    nights: number;
    adults?: number;
    nightlyPrice: number;
    revenue: number;
    paymentSource?: number;
  };
};

export type LegacyRevenueWorkbookConfig = {
  year: number;
  sheets: LegacyRevenueSheetConfig[];
  allowPreviousYearArrival?: boolean;
};

export type LegacyRevenueRecord = {
  year: number;
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
  year: number;
  sheetConfigs: LegacyRevenueSheetConfig[];
  records: LegacyRevenueRecord[];
  warnings: string[];
  skippedRows: number;
};

const COLUMNS_2020: LegacyRevenueSheetConfig["columns"] = {
  guest: 0,
  arrival: 1,
  departure: 2,
  nights: 4,
  adults: 5,
  nightlyPrice: 6,
  revenue: 7,
  paymentSource: 8,
};

const COLUMNS_2019: LegacyRevenueSheetConfig["columns"] = {
  guest: 0,
  arrival: 1,
  departure: 2,
  nights: 4,
  nightlyPrice: 5,
  revenue: 6,
};

const COLUMNS_2017_2018: LegacyRevenueSheetConfig["columns"] = {
  guest: 0,
  arrival: 1,
  departure: 2,
  nights: 4,
  nightlyPrice: 5,
  revenue: 7,
};

export const LEGACY_REVENUE_WORKBOOK_CONFIGS: LegacyRevenueWorkbookConfig[] = [
  {
    year: 2020,
    sheets: [
      { sheetName: "Gree2020", giteName: "La Grée", columns: COLUMNS_2020 },
      { sheetName: "Phonsine2020", giteName: "Tante Phonsine", columns: COLUMNS_2020 },
      { sheetName: "Edmond2020", giteName: "Edmond", columns: COLUMNS_2020 },
    ],
  },
  {
    year: 2019,
    sheets: [
      { sheetName: "Phonsine", giteName: "Tante Phonsine", columns: COLUMNS_2019 },
      { sheetName: "Gree", giteName: "La Grée", columns: COLUMNS_2019 },
    ],
  },
  {
    year: 2018,
    allowPreviousYearArrival: true,
    sheets: [
      { sheetName: "Phonsine 2018", giteName: "Tante Phonsine", columns: COLUMNS_2017_2018 },
      { sheetName: "Grée 2018", giteName: "La Grée", columns: COLUMNS_2017_2018 },
    ],
  },
  {
    year: 2017,
    sheets: [
      { sheetName: "Phonsine 2017", giteName: "Tante Phonsine", columns: COLUMNS_2017_2018 },
      {
        sheetName: "Grée 2017",
        giteName: "La Grée",
        allowBlankDateHeaders: true,
        columns: COLUMNS_2017_2018,
      },
    ],
  },
];

export const LEGACY_REVENUE_2020_SHEETS = LEGACY_REVENUE_WORKBOOK_CONFIGS[0].sheets;
export const LEGACY_REVENUE_2019_SHEETS = LEGACY_REVENUE_WORKBOOK_CONFIGS[1].sheets;
export const LEGACY_REVENUE_2018_SHEETS = LEGACY_REVENUE_WORKBOOK_CONFIGS[2].sheets;
export const LEGACY_REVENUE_2017_SHEETS = LEGACY_REVENUE_WORKBOOK_CONFIGS[3].sheets;

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

const validateHeaders = (sheet: LegacyRevenueWorkbookSheet, config: LegacyRevenueSheetConfig) => {
  const headers = sheet.data[0] ?? [];
  const expected = [
    {
      index: config.columns.arrival,
      values: config.allowBlankDateHeaders ? ["debut", "dtstart", ""] : ["debut", "dtstart"],
    },
    {
      index: config.columns.departure,
      values: config.allowBlankDateHeaders ? ["fin", "dtend", ""] : ["fin", "dtend"],
    },
    { index: config.columns.nights, values: ["nb nuits", "nb de nuits"] },
    { index: config.columns.nightlyPrice, values: ["prix/nuits", "prix/nuit"] },
    { index: config.columns.revenue, values: ["revenus"] },
  ];
  if (config.columns.adults !== undefined) {
    expected.push({ index: config.columns.adults, values: ["nb adultes"] });
  }
  if (config.columns.paymentSource !== undefined) {
    expected.push({ index: config.columns.paymentSource, values: ["paiement"] });
  }

  for (const item of expected) {
    const actual = normalizeText(String(headers[item.index] ?? ""));
    if (!item.values.includes(actual)) {
      throw new Error(
        `La feuille ${sheet.sheet} n'a pas le format attendu (colonne ${item.index + 1}: "${actual}").`
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
      (left, right) =>
        left.arrival.getTime() - right.arrival.getTime() ||
        left.departure.getTime() - right.departure.getTime()
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

export const parseLegacyRevenueSheets = (
  sheets: LegacyRevenueWorkbookSheet[],
  workbookConfig: LegacyRevenueWorkbookConfig
): LegacyRevenueParseResult => {
  const records: LegacyRevenueRecord[] = [];
  const warnings: string[] = [];
  let skippedRows = 0;
  const sheetsByName = new Map(sheets.map((sheet) => [sheet.sheet, sheet]));

  for (const config of workbookConfig.sheets) {
    const sheet = sheetsByName.get(config.sheetName);
    if (!sheet) {
      throw new Error(`Feuille requise introuvable: ${config.sheetName}.`);
    }
    validateHeaders(sheet, config);
    const firstRecordIndex = records.length;
    let declaredTotalNights: number | null = null;
    let declaredTotalRevenue: number | null = null;

    sheet.data.slice(1).forEach((row, rowIndex) => {
      const rowNumber = rowIndex + 2;
      const arrival = toDate(row[config.columns.arrival]);
      const sourceDeparture = toDate(row[config.columns.departure]);
      const nightsValue = toNumber(row[config.columns.nights]);
      const guestName = String(row[config.columns.guest] ?? "").trim();
      if (!arrival && !sourceDeparture && !guestName) {
        const summaryRevenue = toNumber(row[config.columns.revenue]);
        if (nightsValue !== null) declaredTotalNights = nightsValue;
        if (summaryRevenue !== null) declaredTotalRevenue = summaryRevenue;
        return;
      }
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
      const departure = addUtcDays(arrival, nights);
      const arrivalYear = arrival.getUTCFullYear();
      const previousYearArrivalAllowed =
        workbookConfig.allowPreviousYearArrival &&
        arrivalYear === workbookConfig.year - 1 &&
        departure.getUTCFullYear() === workbookConfig.year;
      if (arrivalYear !== workbookConfig.year && !previousYearArrivalAllowed) {
        throw new Error(
          `${config.sheetName} ligne ${rowNumber}: arrivée hors de ${workbookConfig.year} (${formatDate(arrival)}).`
        );
      }
      if (previousYearArrivalAllowed) {
        warnings.push(
          `${config.sheetName} ligne ${rowNumber}: séjour commencé en ${arrivalYear} et terminé en ${workbookConfig.year}, conservé tel quel.`
        );
      }
      if (sourceDeparture.getTime() !== departure.getTime()) {
        warnings.push(
          `${config.sheetName} ligne ${rowNumber}: sortie ${formatDate(sourceDeparture)} remplacée par ` +
            `${formatDate(departure)} pour respecter ${nights} nuit(s).`
        );
      }

      const sourceNightlyPrice = toNumber(row[config.columns.nightlyPrice]) ?? 0;
      const revenue = round2(toNumber(row[config.columns.revenue]) ?? sourceNightlyPrice * nights);
      const nightlyPrice = round2(nights > 0 ? revenue / nights : sourceNightlyPrice);
      if (Math.abs(round2(sourceNightlyPrice * nights) - revenue) > 0.01) {
        warnings.push(
          `${config.sheetName} ligne ${rowNumber}: prix/nuit recalculé à ${nightlyPrice.toFixed(2)} € ` +
            `pour préserver le revenu de ${revenue.toFixed(2)} €.`
        );
      }

      records.push({
        year: workbookConfig.year,
        sheetName: config.sheetName,
        rowNumber,
        giteName: config.giteName,
        originReference: `revenus-${workbookConfig.year}:${config.sheetName}:${rowNumber}`,
        guestName: guestName || "Hôte non renseigné",
        arrival,
        departure,
        nights,
        adults:
          config.columns.adults === undefined
            ? 2
            : Math.max(0, Math.trunc(toNumber(row[config.columns.adults]) ?? 2)),
        nightlyPrice,
        revenue,
        paymentSource:
          config.columns.paymentSource === undefined
            ? "A définir"
            : normalizePaymentSource(row[config.columns.paymentSource]),
      });
    });

    const sheetRecords = records.slice(firstRecordIndex);
    const computedNights = sheetRecords.reduce((sum, record) => sum + record.nights, 0);
    const computedRevenue = round2(sheetRecords.reduce((sum, record) => sum + record.revenue, 0));
    if (declaredTotalNights !== null && Math.abs(declaredTotalNights - computedNights) > 0.01) {
      warnings.push(
        `${config.sheetName}: le total affiché (${declaredTotalNights} nuits) ne correspond pas aux lignes (${computedNights} nuits).`
      );
    }
    if (declaredTotalRevenue !== null && Math.abs(declaredTotalRevenue - computedRevenue) > 0.01) {
      warnings.push(
        `${config.sheetName}: le total affiché (${round2(declaredTotalRevenue).toFixed(2)} €) ne correspond pas aux lignes (${computedRevenue.toFixed(2)} €).`
      );
    }
  }

  warnings.push(...findOverlaps(records));
  return {
    year: workbookConfig.year,
    sheetConfigs: workbookConfig.sheets,
    records,
    warnings,
    skippedRows,
  };
};

export const parseLegacyRevenue2020Sheets = (
  sheets: LegacyRevenueWorkbookSheet[],
  sheetConfigs: LegacyRevenueSheetConfig[] = LEGACY_REVENUE_2020_SHEETS
) => parseLegacyRevenueSheets(sheets, { year: 2020, sheets: sheetConfigs });

export const readLegacyRevenueWorkbook = async (
  input: WorkbookInput
): Promise<LegacyRevenueParseResult> => {
  for (const config of LEGACY_REVENUE_WORKBOOK_CONFIGS) {
    try {
      const sheets = await Promise.all(
        config.sheets.map(async (sheetConfig) => ({
          sheet: sheetConfig.sheetName,
          data: await readSheet(input, sheetConfig.sheetName),
        }))
      );
      return parseLegacyRevenueSheets(sheets, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/sheet .* not found/i.test(message)) throw error;
    }
  }

  throw new Error(
    "Classeur non reconnu. Formats acceptés: revenus historiques 2017, 2018, 2019 ou 2020."
  );
};

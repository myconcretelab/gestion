import { isApiError } from "../../utils/api";
import type { ContratOptions } from "../../utils/types";

export const defaultOptions: ContratOptions = {
  draps: { enabled: false, nb_lits: 0, offert: false },
  linge_toilette: { enabled: false, nb_personnes: 0, offert: false },
  menage: { enabled: false, offert: false },
  depart_tardif: { enabled: false, offert: false },
  chiens: { enabled: false, nb: 0, offert: false },
  regle_animaux_acceptes: false,
  regle_bois_premiere_flambee: false,
  regle_tiers_personnes_info: false,
};

export const DEFAULT_ARRHES_RATE = 0.2;

export const round2 = (value: number) => Math.round(value * 100) / 100;

export const formatDateInput = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

export const parseDateInput = (value: string) => {
  const parts = value.split("-");
  if (parts.length !== 3) return null;
  const [year, month, day] = parts.map((part) => Number(part));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
};

export const nextDayFromInput = (value: string) => {
  const date = parseDateInput(value);
  if (!date) return "";
  return formatDateInput(addDays(date, 1));
};

const utcDayFromInput = (value: string) => {
  const date = parseDateInput(value);
  if (!date) return null;
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / (1000 * 60 * 60 * 24);
};

export const nightsBetweenInputs = (startValue: string, endValue: string) => {
  const startDay = utcDayFromInput(startValue);
  const endDay = utcDayFromInput(endValue);
  if (startDay === null || endDay === null) return null;
  const diff = endDay - startDay;
  return diff > 0 ? diff : null;
};

export const toDateInputValue = (value?: string | null) => {
  if (!value) return "";
  return value.includes("T") ? value.split("T")[0] : value;
};

export const mergeOptions = (value?: ContratOptions | null): ContratOptions => ({
  ...defaultOptions,
  ...(value ?? {}),
  draps: { ...defaultOptions.draps, ...(value?.draps ?? {}) },
  linge_toilette: { ...defaultOptions.linge_toilette, ...(value?.linge_toilette ?? {}) },
  menage: { ...defaultOptions.menage, ...(value?.menage ?? {}) },
  depart_tardif: { ...defaultOptions.depart_tardif, ...(value?.depart_tardif ?? {}) },
  chiens: { ...defaultOptions.chiens, ...(value?.chiens ?? {}) },
});

export const extractValidationFieldErrors = <T extends string>(
  error: unknown,
  allowedFields: ReadonlySet<T>,
  dateFinField: T
): Partial<Record<T, string>> => {
  const result: Partial<Record<T, string>> = {};
  if (!isApiError(error)) return result;

  const rawFieldErrors = error.payload.details?.fieldErrors;
  if (rawFieldErrors && typeof rawFieldErrors === "object") {
    for (const [field, messages] of Object.entries(rawFieldErrors)) {
      if (!allowedFields.has(field as T) || !Array.isArray(messages)) continue;
      const firstMessage = messages.find(
        (message): message is string => typeof message === "string" && message.trim().length > 0
      );
      if (firstMessage) result[field as T] = firstMessage;
    }
  }

  const normalizedMessage = error.message.toLowerCase();
  if (!result[dateFinField] && normalizedMessage.includes("date de fin")) {
    result[dateFinField] = error.message;
  }

  return result;
};

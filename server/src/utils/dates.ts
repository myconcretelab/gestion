import { format } from "date-fns";

export const formatDate = (value: Date | string): string => {
  const date = typeof value === "string" ? new Date(value) : value;
  return format(date, "dd/MM/yyyy");
};

export const formatDateLong = (value: Date | string): string => {
  const date = typeof value === "string" ? new Date(value) : value;
  return format(date, "dd/MM/yyyy");
};

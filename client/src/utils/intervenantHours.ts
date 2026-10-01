export const formatWorkMinutes = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!remainder) return `${hours} h`;
  if (!hours) return `${remainder} min`;
  return `${hours} h ${String(remainder).padStart(2, "0")}`;
};

/** Free input is decimal hours; only whole minutes are accepted. */
export const parseWorkHours = (value: string) => {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const rawMinutes = Number(normalized) * 60;
  const minutes = Math.round(rawMinutes);
  if (!Number.isFinite(rawMinutes) || Math.abs(rawMinutes - minutes) > 0.000001 ||
      minutes < 1 || minutes > 1440) return null;
  return minutes;
};

export const getWorkerInitials = (name: string) =>
  name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part.slice(0, 1).toUpperCase()).join("") || "?";

export const getWorkerColor = (id: string) => {
  const palette = ["#2D8CFF", "#43B77D", "#F5A623", "#7E5BEF", "#FE5C73"];
  const hash = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return palette[hash % palette.length];
};

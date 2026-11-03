const parisDateTime = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Paris",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

/** Latest arrival day whose automatic platform receipt is due (18:00 in Paris). */
export const automaticPlatformReceiptThrough = (now: Date) => {
  const parts = Object.fromEntries(
    parisDateTime.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const day = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  if (Number(parts.hour) < 18) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
};

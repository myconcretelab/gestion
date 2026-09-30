export type ReservationsLocationPeriod = {
  year: number;
  month: number | 0;
};

export const getReservationsLocationPeriod = (
  search: string,
  fallbackYear: number,
): ReservationsLocationPeriod => {
  const params = new URLSearchParams(search);
  const requestedYear = Number.parseInt(params.get("year") ?? "", 10);
  const requestedMonth = Number.parseInt(params.get("month") ?? "", 10);

  return {
    year: Number.isFinite(requestedYear) && requestedYear > 0 ? requestedYear : fallbackYear,
    month:
      Number.isFinite(requestedMonth) && requestedMonth >= 0 && requestedMonth <= 12
        ? requestedMonth
        : 0,
  };
};

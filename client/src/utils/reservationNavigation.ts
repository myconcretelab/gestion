export type ReservationsLocationPeriod = {
  year: number;
  month: number | 0;
};

export const reservationPaymentsHref = (
  reservationId: string,
  stayDate?: string,
) => {
  const params = new URLSearchParams({
    focus: reservationId,
    tab: "all-gites",
    payments: "1",
    month: "0",
  });
  if (stayDate && /^\d{4}-/.test(stayDate))
    params.set("year", stayDate.slice(0, 4));
  return `/reservations?${params}#reservation-${encodeURIComponent(reservationId)}`;
};

export const getReservationsLocationPeriod = (
  search: string,
  fallbackYear: number,
): ReservationsLocationPeriod => {
  const params = new URLSearchParams(search);
  const requestedYear = Number.parseInt(params.get("year") ?? "", 10);
  const requestedMonth = Number.parseInt(params.get("month") ?? "", 10);

  return {
    year:
      Number.isFinite(requestedYear) && requestedYear > 0
        ? requestedYear
        : fallbackYear,
    month:
      Number.isFinite(requestedMonth) &&
      requestedMonth >= 0 &&
      requestedMonth <= 12
        ? requestedMonth
        : 0,
  };
};

const AIRBNB_CONFIRMATION_CODE_PATTERN = /(?:^|[^A-Z0-9])(HM[A-Z0-9]{8})(?=$|[^A-Z0-9])/i;

export const normalizeAirbnbConfirmationCode = (value: string | null | undefined) => {
  if (typeof value !== "string") return null;
  const match = value.trim().toUpperCase().match(/^HM[A-Z0-9]{8}$/);
  return match?.[0] ?? null;
};

export const extractAirbnbConfirmationCode = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const match = value.toUpperCase().match(AIRBNB_CONFIRMATION_CODE_PATTERN);
    if (match?.[1]) return match[1];
  }
  return null;
};

export const buildAirbnbPumpReference = (listingId: string, confirmationCode: string) =>
  `${listingId.trim()}|${confirmationCode.trim().toUpperCase()}`;

export const buildAirbnbReservationUrl = (confirmationCode: string) =>
  `https://www.airbnb.com/hosting/reservations/details/${confirmationCode.trim().toUpperCase()}`;

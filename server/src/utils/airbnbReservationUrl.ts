const cleanExtractedUrl = (value: string) => value.trim().replace(/[)>.,;]+$/g, "");

export const extractAirbnbReservationUrl = (description: string | null | undefined) => {
  if (!description) return null;

  const text = String(description);
  const direct = text.match(/Reservation URL:\s*(https?:\/\/\S+)/i);
  if (direct?.[1]) {
    return cleanExtractedUrl(direct[1]);
  }

  const fallback = text.match(/https?:\/\/(?:www\.)?airbnb\.[^\s\n]+/i);
  if (fallback?.[0]) {
    return cleanExtractedUrl(fallback[0]);
  }

  return null;
};

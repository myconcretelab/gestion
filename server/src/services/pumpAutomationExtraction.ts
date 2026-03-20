import fs from "node:fs";
import path from "node:path";

export type PumpLatestReservation = {
  id: string;
  type: "airbnb" | "blocked";
  source: string;
  confirmationCode: string | null;
  listingId: string | null;
  listingName: string | null;
  listingNickname: string | null;
  listingThumbnailUrl: string | null;
  guestName: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
  guestUserId: string | null;
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  guestCount: number | null;
  adults: number | null;
  children: number | null;
  infants: number | null;
  basePrice: number | null;
  currency: string | null;
  status: string | null;
  payout: number | null;
  payoutFormatted: string | null;
  note: string | null;
  busySubtype?: string | null;
  hostBusy?: boolean | null;
};

export type PumpLatestExtraction = {
  reservations: PumpLatestReservation[];
  stats: {
    inspectedResponses: number;
    matchedResponses: number;
  };
};

type SavedResponseMetadata = {
  filename?: string | null;
  url?: string | null;
};

const parseJsonFile = <T>(filePath: string) => JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;

const formatGuestName = (guestInfo: { firstName?: unknown; lastName?: unknown } = {}) =>
  [guestInfo.firstName, guestInfo.lastName]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join(" ");

const parseCurrencyAmount = (value: unknown) => {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s/g, "").replace(/[^\d,.-]/g, "").replace(",", ".");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
};

const normalizeString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
};

const isIsoDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

const addDays = (value: string, daysToAdd: number) => {
  if (!isIsoDate(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year, month - 1, day + daysToAdd));
  return utcDate.toISOString().slice(0, 10);
};

const getReservationKey = (listingId: string | null, confirmationCode: string | null, checkIn: string | null, checkOut: string | null) =>
  [listingId || "unknown", confirmationCode || "unknown", checkIn || "unknown", checkOut || "unknown"].join("|");

const getBlockedReservationKey = (listingId: string | null, checkIn: string | null, checkOut: string | null, note: string | null) =>
  [listingId || "unknown", "blocked", checkIn || "unknown", checkOut || "unknown", note || "no-note"].join("|");

const isListingsAndCalendarsResponse = (url: string | null | undefined, body: any) =>
  String(url || "").includes("multicalListingsAndCalendars") ||
  Boolean(body?.data?.patek?.getMultiCalendarListingsAndCalendars);

const isAdditionalReservationDataResponse = (url: string | null | undefined, body: any) =>
  String(url || "").includes("multicalAdditionalReservationData") ||
  Boolean(body?.data?.patek?.getAdditionalReservationData);

const mergeReservation = (existing: PumpLatestReservation | undefined, next: PumpLatestReservation): PumpLatestReservation => {
  if (!existing) return next;
  return {
    ...existing,
    ...Object.fromEntries(
      Object.entries(next).filter(([, value]) => value !== null && value !== undefined && value !== "")
    ),
    payout: next.payout ?? existing.payout ?? null,
    payoutFormatted: next.payoutFormatted || existing.payoutFormatted || null,
    listingNickname: next.listingNickname || existing.listingNickname || null,
    listingName: next.listingName || existing.listingName || null,
    guestName: next.guestName || existing.guestName || null,
    guestFirstName: next.guestFirstName || existing.guestFirstName || null,
    guestLastName: next.guestLastName || existing.guestLastName || null,
    note: next.note || existing.note || null,
  };
};

const collectListingDetails = (body: any, listingById: Map<string, Record<string, string | null>>) => {
  const listings =
    body?.data?.patek?.getMultiCalendarListingsAndCalendars?.multiCalendarListingsAttributes?.multiCalendarListings || [];

  for (const listing of listings) {
    const listingId = String(listing?.listingId || "").trim();
    if (!listingId) continue;
    listingById.set(listingId, {
      listingId,
      listingName: listing.listingNameOrPlaceholderName || null,
      listingNickname: listing.nickname || null,
      listingThumbnailUrl: listing.listingThumbnailUrl || null,
    });
  }
};

const getDayReservation = (day: any) => {
  const reservation = day?.unavailabilityReasons?.reservation;
  if (!reservation?.confirmationCode || !reservation?.startDate || !reservation?.endDate) return null;
  return reservation;
};

const getDayNote = (day: any) => {
  const candidates = [day?.notes, day?.note, day?.unavailabilityReasons?.notes, day?.unavailabilityReasons?.note];
  for (const candidate of candidates) {
    const normalized = normalizeString(candidate);
    if (normalized) return normalized;
  }
  return null;
};

const isOpenCalendarDay = (day: any) => day?.available === true && day?.bookable === true;

const collectReservations = (
  body: any,
  listingById: Map<string, Record<string, string | null>>,
  reservationsByKey: Map<string, PumpLatestReservation>
) => {
  const calendars = body?.data?.patek?.getMultiCalendarListingsAndCalendars?.hostCalendarsResponse?.calendars || [];

  for (const calendar of calendars) {
    for (const day of calendar?.days || []) {
      if (isOpenCalendarDay(day)) continue;
      const reservation = getDayReservation(day);
      if (!reservation) continue;

      const listingId = String(day?.listingId || reservation?.hostingId || "").trim() || null;
      const listing = (listingId && listingById.get(listingId)) || {};
      const guestName = formatGuestName(reservation.guestInfo);
      const nextReservation: PumpLatestReservation = {
        id: getReservationKey(listingId, reservation.confirmationCode, reservation.startDate, reservation.endDate),
        type: "airbnb",
        source: "airbnb",
        confirmationCode: reservation.confirmationCode,
        listingId,
        listingName: listing.listingName || null,
        listingNickname: listing.listingNickname || null,
        listingThumbnailUrl: listing.listingThumbnailUrl || null,
        guestName: guestName || null,
        guestFirstName: reservation?.guestInfo?.firstName || null,
        guestLastName: reservation?.guestInfo?.lastName || null,
        guestUserId: reservation?.guestInfo?.userId || null,
        checkIn: reservation.startDate || null,
        checkOut: reservation.endDate || null,
        nights: reservation.nights ?? null,
        guestCount: reservation.numberOfGuests ?? null,
        adults: reservation.numberOfAdults ?? null,
        children: reservation.numberOfChildren ?? null,
        infants: reservation.numberOfInfants ?? null,
        basePrice: reservation.basePrice ?? null,
        currency: reservation.hostCurrency || null,
        status: reservation.statusString || null,
        payout: null,
        payoutFormatted: null,
        note: getDayNote(day) || normalizeString(reservation?.notes),
      };

      reservationsByKey.set(nextReservation.id, mergeReservation(reservationsByKey.get(nextReservation.id), nextReservation));
    }
  }
};

const collectBlockedDateNotes = (body: any, blockedDaysByKey: Map<string, any>) => {
  const calendars = body?.data?.patek?.getMultiCalendarListingsAndCalendars?.hostCalendarsResponse?.calendars || [];

  for (const calendar of calendars) {
    for (const day of calendar?.days || []) {
      if (!isIsoDate(day?.day)) continue;
      if (isOpenCalendarDay(day)) continue;

      const reservation = getDayReservation(day);
      const note = getDayNote(day);
      const reasons = day?.unavailabilityReasons || {};
      if (reservation || !note) continue;

      const isBlockedByHost =
        day?.available === false &&
        day?.bookable === false &&
        reasons?.reservation == null &&
        (reasons?.hostBusy === true || reasons?.busySubtype === "HOST_BUSY");

      if (!isBlockedByHost) continue;

      const listingId = String(day?.listingId || calendar?.listingId || "").trim() || null;
      const key = `${listingId || "unknown"}|${day.day}`;
      const existing = blockedDaysByKey.get(key);

      blockedDaysByKey.set(key, {
        ...(existing || {}),
        listingId,
        note,
        day: day.day,
        busySubtype: existing?.busySubtype || reasons?.busySubtype || null,
        hostBusy: existing?.hostBusy ?? reasons?.hostBusy ?? null,
      });
    }
  }
};

const finalizeBlockedDateNotes = (
  blockedDaysByKey: Map<string, any>,
  listingById: Map<string, Record<string, string | null>>,
  reservationsByKey: Map<string, PumpLatestReservation>
) => {
  const blockedDays = [...blockedDaysByKey.values()].sort((left, right) => {
    if (left.listingId !== right.listingId) {
      return String(left.listingId || "").localeCompare(String(right.listingId || ""));
    }
    if (left.note !== right.note) {
      return String(left.note || "").localeCompare(String(right.note || ""));
    }
    return String(left.day || "").localeCompare(String(right.day || ""));
  });

  let currentBlock: any = null;
  const flushCurrentBlock = () => {
    if (!currentBlock) return;

    const listing = (currentBlock.listingId && listingById.get(currentBlock.listingId)) || {};
    const checkOut = addDays(currentBlock.endDate, 1) || currentBlock.endDate;
    const nextReservation: PumpLatestReservation = {
      id: getBlockedReservationKey(currentBlock.listingId, currentBlock.startDate, checkOut, currentBlock.note),
      type: "blocked",
      source: "calendar-note",
      confirmationCode: null,
      listingId: currentBlock.listingId || null,
      listingName: listing.listingName || null,
      listingNickname: listing.listingNickname || null,
      listingThumbnailUrl: listing.listingThumbnailUrl || null,
      guestName: null,
      guestFirstName: null,
      guestLastName: null,
      guestUserId: null,
      checkIn: currentBlock.startDate,
      checkOut,
      nights: currentBlock.dayCount,
      guestCount: null,
      adults: null,
      children: null,
      infants: null,
      basePrice: null,
      currency: null,
      status: "blocked",
      payout: null,
      payoutFormatted: null,
      note: currentBlock.note,
      busySubtype: currentBlock.busySubtype || null,
      hostBusy: currentBlock.hostBusy ?? null,
    };

    reservationsByKey.set(nextReservation.id, mergeReservation(reservationsByKey.get(nextReservation.id), nextReservation));
    currentBlock = null;
  };

  for (const blockedDay of blockedDays) {
    const expectedNextDay =
      currentBlock && currentBlock.listingId === blockedDay.listingId && currentBlock.note === blockedDay.note
        ? addDays(currentBlock.endDate, 1)
        : null;

    if (
      currentBlock &&
      currentBlock.listingId === blockedDay.listingId &&
      currentBlock.note === blockedDay.note &&
      expectedNextDay === blockedDay.day
    ) {
      currentBlock.endDate = blockedDay.day;
      currentBlock.dayCount += 1;
      currentBlock.busySubtype = currentBlock.busySubtype || blockedDay.busySubtype || null;
      currentBlock.hostBusy = currentBlock.hostBusy ?? blockedDay.hostBusy ?? null;
      continue;
    }

    flushCurrentBlock();
    currentBlock = {
      listingId: blockedDay.listingId,
      note: blockedDay.note,
      startDate: blockedDay.day,
      endDate: blockedDay.day,
      dayCount: 1,
      busySubtype: blockedDay.busySubtype || null,
      hostBusy: blockedDay.hostBusy ?? null,
    };
  }

  flushCurrentBlock();
};

const collectAdditionalReservationData = (body: any, payoutByConfirmationCode: Map<string, Record<string, unknown>>) => {
  const resources = body?.data?.patek?.getAdditionalReservationData?.reservationResources || [];

  for (const resource of resources) {
    const confirmationCode = String(resource?.confirmationCode || "").trim();
    if (!confirmationCode) continue;

    const payoutFormatted = resource.hostPayoutFormatted || null;
    payoutByConfirmationCode.set(confirmationCode, {
      payout: parseCurrencyAmount(payoutFormatted),
      payoutFormatted,
      status: resource.hostFacingStatus || null,
    });
  }
};

export const extractPumpReservationsFromSession = (storageDir: string): PumpLatestExtraction => {
  const metadataPath = path.join(storageDir, "metadata.json");
  if (!fs.existsSync(metadataPath)) {
    return {
      reservations: [],
      stats: {
        inspectedResponses: 0,
        matchedResponses: 0,
      },
    };
  }

  const metadata = parseJsonFile<{ responses?: SavedResponseMetadata[] }>(metadataPath);
  const listingById = new Map<string, Record<string, string | null>>();
  const reservationsByKey = new Map<string, PumpLatestReservation>();
  const payoutByConfirmationCode = new Map<string, Record<string, unknown>>();
  const blockedDaysByKey = new Map<string, any>();
  let inspectedResponses = 0;
  let matchedResponses = 0;

  for (const response of metadata.responses || []) {
    if (!response?.filename) continue;

    const responsePath = path.join(storageDir, "responses", response.filename);
    if (!fs.existsSync(responsePath)) continue;

    let fullResponse: any;
    try {
      fullResponse = parseJsonFile(responsePath);
    } catch {
      continue;
    }

    const body = fullResponse?.body;
    if (!body || typeof body !== "object") continue;
    inspectedResponses += 1;

    if (isListingsAndCalendarsResponse(response.url, body)) {
      matchedResponses += 1;
      collectListingDetails(body, listingById);
      collectReservations(body, listingById, reservationsByKey);
      collectBlockedDateNotes(body, blockedDaysByKey);
      continue;
    }

    if (isAdditionalReservationDataResponse(response.url, body)) {
      matchedResponses += 1;
      collectAdditionalReservationData(body, payoutByConfirmationCode);
    }
  }

  for (const [key, reservation] of reservationsByKey.entries()) {
    const payoutData = reservation.confirmationCode ? payoutByConfirmationCode.get(reservation.confirmationCode) : null;
    if (!payoutData) continue;
    reservationsByKey.set(
      key,
      mergeReservation(reservation, {
        ...reservation,
        payout: typeof payoutData.payout === "number" ? payoutData.payout : null,
        payoutFormatted: typeof payoutData.payoutFormatted === "string" ? payoutData.payoutFormatted : null,
        status: typeof payoutData.status === "string" ? payoutData.status : reservation.status,
      })
    );
  }

  finalizeBlockedDateNotes(blockedDaysByKey, listingById, reservationsByKey);

  const reservations = [...reservationsByKey.values()].sort((left, right) => {
    if (left.checkIn !== right.checkIn) {
      return String(left.checkIn || "").localeCompare(String(right.checkIn || ""));
    }
    if (left.listingName !== right.listingName) {
      return String(left.listingName || "").localeCompare(String(right.listingName || ""));
    }
    return String(left.guestName || left.note || "").localeCompare(String(right.guestName || right.note || ""));
  });

  return {
    reservations,
    stats: {
      inspectedResponses,
      matchedResponses,
    },
  };
};

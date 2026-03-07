import { normalizeImportedComment } from "../utils/reservationText.js";

const DAY_MS = 24 * 60 * 60 * 1000;

type HarRecordBase = {
  kind: "additional" | "calendar" | "note";
  listingId: string | null;
};

type HarAdditionalRecord = HarRecordBase & {
  kind: "additional";
  confirmationCode: string | null;
  payout: string | null;
};

type HarCalendarRecord = HarRecordBase & {
  kind: "calendar";
  date: string | null;
  confirmationCode: string | null;
  guestFirstName: string | null;
  guestLastName: string | null;
};

type HarNoteRecord = HarRecordBase & {
  kind: "note";
  date: string | null;
  comment: string;
};

type HarRecord = HarAdditionalRecord | HarCalendarRecord | HarNoteRecord;

export type ParsedHarReservation = {
  id: string;
  listingId: string;
  type: "airbnb" | "personal";
  checkIn: string;
  checkOut: string;
  nights: number;
  name: string | null;
  payout: number | null;
  comment: string | null;
};

const toArray = <T>(value: T | T[] | null | undefined): T[] => {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return [];
  return [value];
};

const safeGet = (obj: unknown, path: string[]) => {
  let cursor: any = obj;
  for (const segment of path) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = cursor[segment];
  }
  return cursor;
};

const addDaysIso = (isoDate: string, days: number) => {
  const base = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(base.getTime())) return isoDate;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
};

const diffDaysIso = (start: string, endExclusive: string) => {
  const startDate = Date.parse(`${start}T00:00:00.000Z`);
  const endDate = Date.parse(`${endExclusive}T00:00:00.000Z`);
  if (Number.isNaN(startDate) || Number.isNaN(endDate)) return 0;
  return Math.max(0, Math.round((endDate - startDate) / DAY_MS));
};

const computeContiguousRanges = (sortedDates: string[]) => {
  if (sortedDates.length === 0) return [] as Array<[string, string]>;

  const ranges: Array<[string, string]> = [];
  let rangeStart = sortedDates[0];
  let previous = sortedDates[0];

  for (let index = 1; index < sortedDates.length; index += 1) {
    const date = sortedDates[index];
    const expected = addDaysIso(previous, 1);
    if (date !== expected) {
      ranges.push([rangeStart, previous]);
      rangeStart = date;
    }
    previous = date;
  }

  ranges.push([rangeStart, previous]);
  return ranges;
};

const toNumberPayout = (rawValue: unknown): number | null => {
  if (rawValue === null || rawValue === undefined) return null;
  const raw = String(rawValue)
    .replace(/\u00A0/g, " ")
    .replace(/[^\d,.-]/g, "")
    .trim();

  if (!raw) return null;

  if (raw.includes(",") && !/\.\d{1,2}$/.test(raw)) {
    const lastComma = raw.lastIndexOf(",");
    const head = raw.slice(0, lastComma).replace(/[.,\s]/g, "");
    const tail = raw.slice(lastComma + 1);
    const parsed = Number(`${head}.${tail}`);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const parsed = Number(raw.replace(/[\s,]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const decodeContentText = (content: any) => {
  if (!content || content.text == null) return null;
  if (content.encoding === "base64") {
    try {
      return Buffer.from(content.text, "base64").toString("utf-8");
    } catch {
      return null;
    }
  }
  return typeof content.text === "string" ? content.text : null;
};

const parseJsonLikeFromContent = (content: any) => {
  const decoded = decodeContentText(content);
  if (!decoded) return null;

  const mimeType = String(content?.mimeType ?? "").toLowerCase();
  const looksJson = mimeType.includes("json") || decoded.trim().startsWith("{") || decoded.trim().startsWith("[");
  if (!looksJson) return null;

  try {
    return JSON.parse(decoded.trim());
  } catch {
    return null;
  }
};

const normalizeIsoDate = (value: unknown) => {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
};

const extractBlocksFromEntry = (entry: any): HarRecord[] => {
  const blocks: HarRecord[] = [];
  const data = parseJsonLikeFromContent(entry?.response?.content);
  if (!data) return blocks;

  const patek = safeGet(data, ["data", "patek"]);
  if (!patek || typeof patek !== "object") return blocks;

  const reservationResources = safeGet(patek, ["getAdditionalReservationData", "reservationResources"]);
  if (Array.isArray(reservationResources)) {
    for (const resource of reservationResources) {
      blocks.push({
        kind: "additional",
        listingId: null,
        confirmationCode:
          resource && typeof resource.confirmationCode === "string" ? resource.confirmationCode : null,
        payout:
          resource && typeof resource.hostPayoutFormatted === "string" ? resource.hostPayoutFormatted : null,
      });
    }
  }

  const calendars = safeGet(patek, ["getMultiCalendarListingsAndCalendars", "hostCalendarsResponse", "calendars"]);
  if (!Array.isArray(calendars)) return blocks;

  for (const calendar of calendars) {
    const listingId = calendar?.listingId != null ? String(calendar.listingId).trim() : "";
    if (!listingId) continue;

    const days = toArray(calendar?.days);
    for (const day of days) {
      const date = normalizeIsoDate(day?.date ?? day?.day);
      const reservation = day?.unavailabilityReasons?.reservation;
      const confirmationCode =
        reservation && typeof reservation.confirmationCode === "string" ? reservation.confirmationCode : null;

      if (date && confirmationCode) {
        blocks.push({
          kind: "calendar",
          listingId,
          date,
          confirmationCode,
          guestFirstName:
            reservation?.guestInfo && typeof reservation.guestInfo.firstName === "string"
              ? reservation.guestInfo.firstName
              : null,
          guestLastName:
            reservation?.guestInfo && typeof reservation.guestInfo.lastName === "string"
              ? reservation.guestInfo.lastName
              : null,
        });
      }

      const noteCandidates = [day?.notes, day?.note, day?.dayNotes, day?.hostNotes];
      const foundNote = noteCandidates.find((candidate) => typeof candidate === "string" && candidate.trim().length > 0);
      if (date && typeof foundNote === "string") {
        blocks.push({
          kind: "note",
          listingId,
          date,
          comment: foundNote,
        });
      }
    }
  }

  return blocks;
};

const fullName = (firstName: unknown, lastName: unknown) => {
  const first = typeof firstName === "string" ? firstName.trim() : "";
  const last = typeof lastName === "string" ? lastName.trim() : "";
  const value = [first, last].filter(Boolean).join(" ").trim();
  return value.length > 0 ? value : null;
};

const cleanComment = (value: unknown) => {
  return normalizeImportedComment(value);
};

const buildStableId = (parts: Array<string | number | null | undefined>) =>
  parts
    .map((part) => String(part ?? ""))
    .join("|")
    .replace(/\s+/g, " ")
    .trim();

const fuseAirbnbByConfirmation = (records: HarRecord[]) => {
  const payoutByConfirmation = new Map<string, string>();
  for (const record of records) {
    if (record.kind !== "additional" || !record.confirmationCode || !record.payout) continue;
    if (!payoutByConfirmation.has(record.confirmationCode)) {
      payoutByConfirmation.set(record.confirmationCode, record.payout);
    }
  }

  const byConfirmation = new Map<
    string,
    {
      listingId: string;
      dates: Set<string>;
      guestFirstName: string | null;
      guestLastName: string | null;
      payoutRaw: string | null;
    }
  >();

  for (const record of records) {
    if (record.kind === "calendar") {
      if (!record.confirmationCode || !record.listingId || !record.date) continue;
      const key = `${record.listingId}|${record.confirmationCode}`;
      const existing =
        byConfirmation.get(key) ??
        {
          listingId: record.listingId,
          dates: new Set<string>(),
          guestFirstName: null,
          guestLastName: null,
          payoutRaw: null,
        };

      existing.dates.add(record.date);
      if (!existing.guestFirstName && record.guestFirstName) existing.guestFirstName = record.guestFirstName;
      if (!existing.guestLastName && record.guestLastName) existing.guestLastName = record.guestLastName;
      byConfirmation.set(key, existing);
      continue;
    }

    if (record.kind !== "additional") continue;
  }

  const reservations: ParsedHarReservation[] = [];
  for (const [key, value] of byConfirmation.entries()) {
    const sortedDates = [...value.dates].sort((left, right) => left.localeCompare(right));
    if (sortedDates.length === 0) continue;

    const checkIn = sortedDates[0];
    const checkOut = addDaysIso(sortedDates[sortedDates.length - 1], 1);
    const nights = diffDaysIso(checkIn, checkOut);
    if (nights <= 0) continue;

    const reservationId = buildStableId(["airbnb", key, checkIn, checkOut]);
    const confirmationCode = key.split("|").at(-1) ?? "";
    const payoutRaw = value.payoutRaw ?? payoutByConfirmation.get(confirmationCode) ?? null;
    reservations.push({
      id: reservationId,
      listingId: value.listingId,
      type: "airbnb",
      checkIn,
      checkOut,
      nights,
      name: fullName(value.guestFirstName, value.guestLastName),
      payout: toNumberPayout(payoutRaw),
      comment: null,
    });
  }

  return reservations;
};

const fusePersonalNotes = (records: HarRecord[]) => {
  const byListingAndComment = new Map<string, { listingId: string; comment: string; dates: Set<string> }>();

  for (const record of records) {
    if (record.kind !== "note") continue;
    if (!record.listingId || !record.date) continue;

    const comment = cleanComment(record.comment);
    if (!comment) continue;

    const key = `${record.listingId}|${comment}`;
    const entry = byListingAndComment.get(key) ?? {
      listingId: record.listingId,
      comment,
      dates: new Set<string>(),
    };

    entry.dates.add(record.date);
    byListingAndComment.set(key, entry);
  }

  const reservations: ParsedHarReservation[] = [];
  for (const entry of byListingAndComment.values()) {
    const sortedDates = [...entry.dates].sort((left, right) => left.localeCompare(right));
    const ranges = computeContiguousRanges(sortedDates);

    for (const [start, end] of ranges) {
      const checkOut = addDaysIso(end, 1);
      const nights = diffDaysIso(start, checkOut);
      if (nights <= 0) continue;

      reservations.push({
        id: buildStableId(["personal", entry.listingId, start, checkOut, entry.comment]),
        listingId: entry.listingId,
        type: "personal",
        checkIn: start,
        checkOut,
        nights,
        name: null,
        payout: null,
        comment: entry.comment,
      });
    }
  }

  return reservations;
};

export const parseHarReservations = (har: unknown): ParsedHarReservation[] => {
  const entries = (har as any)?.log?.entries;
  if (!Array.isArray(entries)) {
    throw new Error('Format HAR invalide: "log.entries" est requis.');
  }

  const blocks: HarRecord[] = [];
  for (const entry of entries) {
    blocks.push(...extractBlocksFromEntry(entry));
  }

  const airbnb = fuseAirbnbByConfirmation(blocks);
  const personal = fusePersonalNotes(blocks);

  return [...airbnb, ...personal].sort((left, right) => {
    const byListing = left.listingId.localeCompare(right.listingId);
    if (byListing !== 0) return byListing;
    const byStart = left.checkIn.localeCompare(right.checkIn);
    if (byStart !== 0) return byStart;
    return left.checkOut.localeCompare(right.checkOut);
  });
};

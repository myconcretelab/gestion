import {
  DEFAULT_AIRBNB_IMPORTED_RESERVATION_SOURCE,
  DEFAULT_IMPORTED_RESERVATION_SOURCE,
} from "./importedReservationSource.js";
import { isUnknownHostName, normalizeImportedHostName } from "./reservationText.js";

export const hasBookedSummaryMarker = (summary: string) => {
  const normalized = summary.toUpperCase();
  return normalized.includes("RESERVED") || normalized.includes("BOOKED");
};

export const resolveIcalReservationSource = ({
  normalizedSourceType,
  hostName,
}: {
  normalizedSourceType: string;
  hostName: string | null | undefined;
}) => {
  if (normalizedSourceType !== DEFAULT_AIRBNB_IMPORTED_RESERVATION_SOURCE) {
    return normalizedSourceType;
  }

  return normalizeImportedHostName(hostName) ? normalizedSourceType : DEFAULT_IMPORTED_RESERVATION_SOURCE;
};

const getIcalReservationSourcePriority = (resolvedSourceType: string) => {
  if (resolvedSourceType === DEFAULT_IMPORTED_RESERVATION_SOURCE) {
    return 0;
  }

  if (resolvedSourceType === DEFAULT_AIRBNB_IMPORTED_RESERVATION_SOURCE) {
    return 1;
  }

  return 2;
};

export const shouldPreferIcalReservation = (
  left: { normalizedSourceType: string; hostName: string | null | undefined; summary: string },
  right: { normalizedSourceType: string; hostName: string | null | undefined; summary: string }
) => {
  const leftResolvedSource = resolveIcalReservationSource(left);
  const rightResolvedSource = resolveIcalReservationSource(right);
  const leftSourcePriority = getIcalReservationSourcePriority(leftResolvedSource);
  const rightSourcePriority = getIcalReservationSourcePriority(rightResolvedSource);

  if (leftSourcePriority !== rightSourcePriority) {
    return leftSourcePriority > rightSourcePriority;
  }

  const leftHasHost = normalizeImportedHostName(left.hostName) !== null;
  const rightHasHost = normalizeImportedHostName(right.hostName) !== null;
  if (leftHasHost !== rightHasHost) {
    return leftHasHost;
  }

  const leftHasBookedMarker = hasBookedSummaryMarker(left.summary);
  const rightHasBookedMarker = hasBookedSummaryMarker(right.summary);
  if (leftHasBookedMarker !== rightHasBookedMarker) {
    return leftHasBookedMarker;
  }

  return true;
};

export const shouldUpdateIcalReservationSource = ({
  currentSource,
  currentHostName,
  nextSource,
}: {
  currentSource: string | null | undefined;
  currentHostName: string | null | undefined;
  nextSource: string;
}) => {
  const normalizedCurrentSource = typeof currentSource === "string" ? currentSource.trim() : "";
  if (!normalizedCurrentSource) {
    return nextSource !== DEFAULT_IMPORTED_RESERVATION_SOURCE;
  }

  if (normalizedCurrentSource === nextSource) {
    return false;
  }

  if (normalizedCurrentSource === DEFAULT_IMPORTED_RESERVATION_SOURCE) {
    return nextSource !== DEFAULT_IMPORTED_RESERVATION_SOURCE;
  }

  if (normalizedCurrentSource === DEFAULT_AIRBNB_IMPORTED_RESERVATION_SOURCE) {
    if (nextSource === DEFAULT_IMPORTED_RESERVATION_SOURCE) {
      return isUnknownHostName(currentHostName);
    }

    return true;
  }

  return false;
};

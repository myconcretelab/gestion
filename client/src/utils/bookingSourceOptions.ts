import { useEffect, useState } from "react";
import {
  BOOKING_SOURCES,
  type TouristTaxCollectionResponse,
} from "@contrats/shared";
import { apiFetch } from "./api";

/** The platform catalog is shared with payment and tourist-tax settings. */
export function useBookingSourceOptions() {
  const [sources, setSources] = useState<string[]>([...BOOKING_SOURCES]);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch<TouristTaxCollectionResponse>(
      "/settings/tourist-tax-collection/defaults",
      { signal: controller.signal },
    )
      .then((value) =>
        setSources([...new Set([...BOOKING_SOURCES, ...value.sources])]),
      )
      .catch(() => {
        /* Keep the built-in origins available. */
      });
    return () => controller.abort();
  }, []);
  return sources;
}

import { useEffect, useState } from "react";
import type { ReservationPaymentTracking } from "@contrats/shared";
import { apiFetch } from "../../../utils/api";
import type { Reservation } from "../../../utils/types";

export default function useReportPaymentReservations(
  reservationIds: string[],
  revision: string,
) {
  const ids = JSON.stringify([...new Set(reservationIds)].sort());
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([revision, ids, attempt]);
  const [loaded, setLoaded] = useState<{
    key: string;
    reservations: Record<string, Reservation>;
    errors: Record<string, string>;
  }>({ key: "", reservations: {}, errors: {} });

  useEffect(() => {
    const controller = new AbortController();
    const pending = JSON.parse(ids) as string[];
    setLoaded({ key: requestKey, reservations: {}, errors: {} });
    // Several report lines can refer to the same stay. Load it only once,
    // with bounded concurrency when a period contains many reviews.
    const load = async () => {
      let id: string | undefined;
      while (!controller.signal.aborted && (id = pending.shift())) {
        const reservationId = id;
        try {
          const reservation = await apiFetch<Reservation>(
            `/reservations/prefill/${encodeURIComponent(reservationId)}`,
            { signal: controller.signal },
          );
          if (!controller.signal.aborted)
            setLoaded((current) => ({
              ...current,
              reservations: {
                ...current.reservations,
                [reservationId]: reservation,
              },
            }));
        } catch (error) {
          if (!controller.signal.aborted)
            setLoaded((current) => ({
              ...current,
              errors: {
                ...current.errors,
                [reservationId]:
                  error instanceof Error
                    ? error.message
                    : "Règlements indisponibles.",
              },
            }));
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(pending.length, 4) }, load));
    return () => controller.abort();
  }, [ids, requestKey]);

  return {
    reservations: loaded.key === requestKey ? loaded.reservations : {},
    errors: loaded.key === requestKey ? loaded.errors : {},
    retry: () => setAttempt((previous) => previous + 1),
    update: (
      reservation: Reservation,
      payment_tracking: ReservationPaymentTracking,
      booking_source?: string,
    ) => {
      setLoaded((current) => ({
        ...current,
        reservations: Object.fromEntries(
          Object.entries(current.reservations).map(([id, row]) => [
            id,
            row.id === reservation.id ||
            (reservation.stay_group_id &&
              row.stay_group_id === reservation.stay_group_id)
              ? {
                  ...row,
                  payment_tracking,
                  ...(booking_source ? { booking_source } : {}),
                }
              : row,
          ]),
        ),
      }));
    },
  };
}

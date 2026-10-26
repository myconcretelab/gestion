import { isReservationPaymentTracking } from "@contrats/shared";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../utils/api";
import { formatDate } from "../utils/format";
import type { Reservation } from "../utils/types";
import ReservationPaymentsEditor from "./shared/ReservationPaymentsEditor";

export default function ReservationPaymentsPage() {
  const { id } = useParams();
  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setReservation(null);
    setError(null);
    void apiFetch<Reservation>(
      `/reservations/prefill/${encodeURIComponent(id || "")}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) setReservation(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Réservation indisponible.",
          );
      });
    return () => controller.abort();
  }, [id]);
  return (
    <main className="reservation-ledger-page">
      <Link to="/reservations">← Réservations</Link>
      <h1>Règlements de la réservation</h1>
      {error ? (
        <p role="alert">{error}</p>
      ) : reservation ? (
        <>
          <h2>{reservation.hote_nom}</h2>
          <p>
            {formatDate(reservation.date_entree)} →{" "}
            {formatDate(reservation.date_sortie)} · {reservation.gite?.nom}
          </p>
          <div className="reservation-ledger-page__card">
            {isReservationPaymentTracking(reservation.payment_tracking) ? (
              <ReservationPaymentsEditor
                key={reservation.id}
                reservation={reservation}
                tracking={reservation.payment_tracking}
                onUpdated={(payment_tracking, booking_source) =>
                  setReservation((current) =>
                    current
                      ? { ...current, payment_tracking, booking_source }
                      : current,
                  )
                }
              />
            ) : (
              <p>Le suivi des règlements est indisponible.</p>
            )}
          </div>
        </>
      ) : (
        <p role="status">Chargement des règlements…</p>
      )}
    </main>
  );
}

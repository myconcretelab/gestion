import { useEffect, useState } from "react";
import { isReservationPaymentTracking } from "@contrats/shared";
import { apiFetch } from "../../utils/api";
import { canCurrentUserAccessPage, canCurrentUserViewAmounts } from "../../utils/auth";
import { formatDate, formatEuro } from "../../utils/format";
import { buildSmsHref, buildTelephoneHref } from "../../utils/sms";
import type { Reservation } from "../../utils/types";
import ReservationDetailsDrawer from "./ReservationDetailsDrawer";
import ReservationOptionDetails from "./ReservationOptionDetails";
import ReservationPaymentsEditor from "./ReservationPaymentsEditor";
import { ReservationPaymentDetails } from "./ReservationPaymentSummary";

export default function TodayReservationDetailsDrawer({ reservations, initialReservationId, onClose, onOpenReservation }: {
  reservations: Array<{ label: string; reservation: Reservation }>;
  initialReservationId: string;
  onClose: () => void;
  onOpenReservation: (reservation: Reservation) => void;
}) {
  const [selectedId, setSelectedId] = useState(initialReservationId);
  const [loaded, setLoaded] = useState<Reservation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const selected = reservations.find((item) => item.reservation.id === selectedId) ?? reservations[0];
  const reservation = loaded?.id === selected.reservation.id ? { ...selected.reservation, ...loaded } : selected.reservation;
  const loading = loaded?.id !== selected.reservation.id;
  const showAmounts = canCurrentUserViewAmounts();
  const canOpenReservation = canCurrentUserAccessPage("reservations");
  const phoneHref = buildTelephoneHref(reservation.telephone);
  const smsHref = buildSmsHref(reservation.telephone ?? "");

  useEffect(() => {
    const controller = new AbortController();
    setLoaded(null);
    setError(null);
    void apiFetch<Reservation>(`/reservations/${encodeURIComponent(selected.reservation.id)}`, { signal: controller.signal })
      .then((details) => { if (!controller.signal.aborted) setLoaded(details); })
      .catch(() => { if (!controller.signal.aborted) setError("Impossible de charger le détail de la réservation."); });
    return () => controller.abort();
  }, [selected.reservation.id, retry]);

  return (
    <ReservationDetailsDrawer
      open
      className="today-reservation-drawer"
      eyebrow="Détail de la réservation"
      title={reservation.hote_nom || "Hôte non renseigné"}
      summary={[
        reservation.gite?.nom ?? "Gîte non renseigné",
        `${formatDate(reservation.date_entree)} → ${formatDate(reservation.date_sortie)}`,
      ]}
      busy={busy}
      onClose={onClose}
      footer={<>
        <button type="button" className="secondary" disabled={busy} onClick={onClose}>Fermer</button>
        {canOpenReservation ? <button type="button" disabled={busy} onClick={() => onOpenReservation(reservation)}>Ouvrir la réservation</button> : null}
      </>}
    >
      {reservations.length > 1 ? (
        <div className="today-reservation-drawer__choices" role="group" aria-label="Réservations de la rotation">
          {reservations.map((item) => (
            <button type="button" key={item.reservation.id} aria-pressed={item.reservation.id === selectedId}
              disabled={busy} onClick={() => setSelectedId(item.reservation.id)}>
              {item.label} · {item.reservation.hote_nom}
            </button>
          ))}
        </div>
      ) : null}
      <dl className="today-reservation-drawer__facts">
        <div><dt>Durée</dt><dd>{reservation.nb_nuits} nuit{reservation.nb_nuits > 1 ? "s" : ""}</dd></div>
        <div><dt>Voyageurs</dt><dd>{reservation.nb_adultes} adulte{reservation.nb_adultes > 1 ? "s" : ""}{reservation.nb_enfants_2_17 > 0 ? ` · ${reservation.nb_enfants_2_17} enfant${reservation.nb_enfants_2_17 > 1 ? "s" : ""}` : ""}</dd></div>
      </dl>
      {(phoneHref || smsHref || reservation.email || reservation.airbnb_url) ? (
        <div className="today-reservation-drawer__contacts">
          {phoneHref ? <a href={phoneHref}>{reservation.telephone}</a> : null}
          {smsHref ? <a href={smsHref}>SMS</a> : null}
          {reservation.email ? <a href={`mailto:${reservation.email}`}>{reservation.email}</a> : null}
          {reservation.airbnb_url ? <a href={reservation.airbnb_url} target="_blank" rel="noreferrer">Airbnb ↗</a> : null}
        </div>
      ) : null}
      {reservation.commentaire?.trim() ? <section className="today-reservation-drawer__section"><h3>Notes</h3><p className="today-reservation-drawer__note">{reservation.commentaire}</p></section> : null}
      {error ? <div role="alert">{error} <button type="button" className="secondary" onClick={() => setRetry((current) => current + 1)}>Réessayer</button></div> : loading ? <p role="status">Chargement du détail…</p> : (
        <>
          <section className="today-reservation-drawer__section"><h3>Options du séjour</h3><ReservationOptionDetails options={reservation.options} /></section>
          {showAmounts ? (
            <section className="today-reservation-drawer__section"><h3>Règlements</h3>
              {isReservationPaymentTracking(reservation.payment_tracking) ? (
                <ReservationPaymentsEditor key={reservation.id} reservation={reservation} tracking={reservation.payment_tracking}
                  onBusyChange={setBusy} onUpdated={(payment_tracking, booking_source) => setLoaded((current) => current ? { ...current, payment_tracking, booking_source } : current)} />
              ) : <ReservationPaymentDetails reservation={reservation} detailsId={`today-payment-${reservation.id}`} onChangeSource={() => onOpenReservation(reservation)} />}
            </section>
          ) : null}
          {showAmounts && (reservation.energy_live_cost_eur || reservation.energy_cost_eur) ? (
            <section className="today-reservation-drawer__section"><h3>Consommation d’énergie</h3><p>{formatEuro(reservation.energy_live_cost_eur || reservation.energy_cost_eur)}</p></section>
          ) : null}
        </>
      )}
    </ReservationDetailsDrawer>
  );
}

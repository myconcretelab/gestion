import { lazy, Suspense, useEffect, useId, useState, type ComponentProps } from "react";
import { getBookingSource } from "@contrats/shared";
import { canCurrentUserViewAmounts, canCurrentUserWritePage } from "../../utils/auth";
import { ReservationPaymentDetails, ReservationPaymentTile } from "./ReservationPaymentSummary";
import { formatEuro } from "../../utils/format";
import { getReservationOptionBadges } from "../../utils/reservationOptionBadges";
import { buildSmsHref, buildTelephoneHref } from "../../utils/sms";
import type { Reservation } from "../../utils/types";
import MobileReservationActionsBar from "./MobileReservationActionsBar";
import { GiteTasksButton, type GiteTaskSummary } from "./GiteTasksDrawer";

const ReservationPaymentLinkDialog = lazy(() => import("./ReservationPaymentLinkDialog"));

type ReservationInfo = Pick<Reservation, "id" | "date_entree" | "date_sortie" | "nb_nuits" | "prix_total" | "source_paiement"> &
  Partial<Pick<Reservation, "options" | "commentaire" | "telephone" | "email" | "airbnb_url" |
    "booking_source" | "payment_tracking" | "online_payment" | "linked_contract" | "remise_montant" | "frais_optionnels_montant" | "nb_adultes" | "nb_enfants_2_17" |
    "energy_consumption_kwh" | "energy_cost_eur" | "energy_live_consumption_kwh" | "energy_live_cost_eur">>;

type Props = Pick<ComponentProps<typeof MobileReservationActionsBar>,
  "open" | "title" | "onClose" | "onEdit" | "highlightedCard" | "sourcePicker"> & {
  reservation: ReservationInfo;
  total?: number;
  paymentLoading?: boolean;
  paymentError?: string | null;
  onToggleSource: () => void;
  giteId?: string | null;
  giteName?: string | null;
  onTasksChanged?: (summary: GiteTaskSummary) => void;
};

const formatShortDate = (value: string) => new Date(value).toLocaleDateString("fr-FR", {
  day: "numeric", month: "short", timeZone: "UTC",
});

const MobileReservationInfoDrawer = ({
  reservation: providedReservation,
  total,
  paymentLoading,
  paymentError,
  onToggleSource,
  giteId,
  giteName,
  onTasksChanged,
  highlightedCard,
  ...props
}: Props) => {
  const [localUpdate, setLocalUpdate] = useState<{ id: string; payment_tracking: Reservation["payment_tracking"]; booking_source?: string } | null>(null);
  const reservation = localUpdate?.id === providedReservation.id ? { ...providedReservation, ...localUpdate } : providedReservation;
  const [paymentExpanded, setPaymentExpanded] = useState(false);
  const [paymentLinkOpen, setPaymentLinkOpen] = useState(false);
  const paymentDetailsId = useId();
  useEffect(() => { setPaymentExpanded(false); setPaymentLinkOpen(false); }, [reservation.id, props.open]);
  const canSharePayment = Boolean(giteId && getBookingSource(reservation) === "Direct" &&
    (buildSmsHref(reservation.telephone ?? "") || reservation.email?.trim()) &&
    canCurrentUserViewAmounts() && canCurrentUserWritePage("reservations"));
  const hasLiveEnergy = (reservation.energy_live_consumption_kwh ?? 0) > 0 || (reservation.energy_live_cost_eur ?? 0) > 0;
  const hasSavedEnergy = (reservation.energy_consumption_kwh ?? 0) > 0 || (reservation.energy_cost_eur ?? 0) > 0;
  const energyCost = hasLiveEnergy ? reservation.energy_live_cost_eur ?? 0
    : hasSavedEnergy ? reservation.energy_cost_eur ?? 0 : null;

  return (
    <>
      <MobileReservationActionsBar
        {...props}
        subtitle={`${formatShortDate(reservation.date_entree)} → ${formatShortDate(reservation.date_sortie)}`}
        optionBadges={getReservationOptionBadges(reservation.options)}
        details={[
          { label: "Durée", value: `${reservation.nb_nuits} nuit${reservation.nb_nuits > 1 ? "s" : ""}` },
          {
            label: "Total",
            value: "",
            content: <ReservationPaymentTile reservation={reservation} expanded={paymentExpanded}
              onToggle={() => setPaymentExpanded((current) => !current)} detailsId={paymentDetailsId}
              statusLabel={paymentLoading ? "Chargement…" : paymentError ? "Indisponible" : undefined} />,
          },
          ...(energyCost !== null ? [{ label: "Conso", value: formatEuro(energyCost) }] : []),
        ]}
        highlightedCard={!reservation.payment_tracking && paymentExpanded && !reservation.online_payment?.refunded_amount && reservation.online_payment?.status !== "requires_review" ? highlightedCard : undefined}
        paymentInfo={paymentExpanded ? paymentLoading || paymentError ? (
          <section id={paymentDetailsId} className="reservation-payment-details" aria-label="Détail du règlement">
            <p role="status">{paymentError || "Chargement des règlements…"}</p>
          </section>
        ) : <ReservationPaymentDetails reservation={reservation}
          detailsId={paymentDetailsId} monthlyTotal={total} onChangeSource={onToggleSource}
          onUpdated={(payment_tracking, booking_source) => setLocalUpdate({ id: reservation.id, payment_tracking, booking_source })} /> : null}
        note={reservation.commentaire}
        paymentAction={canSharePayment ? <button type="button" className="mobile-reservation-actions__payment-link"
          aria-label="Envoyer un lien de paiement Stripe" onClick={() => setPaymentLinkOpen(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 10h18M7 15h3" /></svg>
          <span>Lien de paiement</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
        </button> : null}
        phoneHref={buildTelephoneHref(reservation.telephone)}
        smsHref={buildSmsHref(reservation.telephone ?? "")}
        airbnbUrl={reservation.airbnb_url}
        tasksButton={giteId ? <GiteTasksButton
          giteId={giteId}
          giteName={giteName || "ce gîte"}
          reservationId={reservation.id}
          onChanged={onTasksChanged}
        /> : null}
      />
      {props.open && canSharePayment && paymentLinkOpen ? <Suspense fallback={<p className="mobile-reservation-payment-loading" role="status">Chargement du lien de paiement…</p>}>
        <ReservationPaymentLinkDialog key={reservation.id} reservation={{
          id: reservation.id, hote_nom: props.title, date_entree: reservation.date_entree,
          date_sortie: reservation.date_sortie, telephone: reservation.telephone, email: reservation.email,
          nb_nuits: reservation.nb_nuits, options: reservation.options,
        }} onClose={() => setPaymentLinkOpen(false)} />
      </Suspense> : null}
    </>
  );
};

export default MobileReservationInfoDrawer;
